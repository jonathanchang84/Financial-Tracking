import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { chromium } from 'playwright';

import { startLocalWorker } from '../scripts/localWorker.mjs';

/**
 * Browser smoke tests.
 *
 * These exist for the failures unit tests cannot see by construction. Everything
 * in `services/` is already covered directly, so what is left is the wiring:
 * does the app boot, does each screen render, and do the sign-in and data
 * protection states behave in a real browser. A render check would have caught
 * each of these the moment they were introduced:
 *
 *   - a stray fifth metric card in the cash-flow headline row
 *   - a literal NUL byte that made a module unparseable
 *   - a truncated file that left an orphaned function fragment
 *
 * Uses the `playwright` library under the existing `node --test` runner rather
 * than `@playwright/test`, so the project keeps one test framework.
 */

const port = Number(process.env.FT_BROWSER_PORT || 8790);
let worker = null;
let browser = null;

test.before(async () => {
  worker = await startLocalWorker({ port, source: 'tests/browser.spec.mjs' });
  // `chromium.launch()` throws an opaque "Executable doesn't exist" when the
  // browser was installed to a non-default location, which is exactly what a CI
  // cache path does. Say so plainly, because a bare Playwright stack trace three
  // frames deep is not a diagnosable failure.
  try {
    browser = await chromium.launch();
  } catch (error) {
    throw new Error(
      'Chromium could not be launched. Run `npm run setup` to install it, or set ' +
        'PLAYWRIGHT_BROWSERS_PATH to the directory `npx playwright install` wrote to. ' +
        `Underlying error: ${error.message}`
    );
  }
});

test.after(async () => {
  await browser?.close();
  worker?.stop();
  // The Worker log is the fastest way to tell a boot failure from an assertion
  // failure, and `validate` gives it to nobody on a CI failure. Echoed to stdout
  // so it lands in the step output, which is readable without log access.
  if (process.env.CI && worker?.log) console.log(`\nworker log (tail):\n${worker.log.slice(-2000)}`);
});

/**
 * Expected console noise, filtered out of the assertion.
 *
 * A signed-out app probes `/api/auth/session` on boot and gets a 401, which the
 * browser reports as a console error. That is correct behaviour, not a defect, and
 * treating it as one would make the suite fail for the normal case. Only
 * uncaught exceptions and unexpected console errors are treated as real.
 */
const EXPECTED_NOISE = /Failed to load resource.*(401|Unauthorized)/i;

/** A page that records uncaught exceptions and unexpected console errors. */
async function openPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (EXPECTED_NOISE.test(text)) return;
    errors.push(text);
  });
  // An uncaught exception is always a real defect, whatever it looks like.
  page.on('pageerror', (error) => errors.push(`uncaught: ${String(error?.message || error)}`));
  return { context, page, errors };
}

/** Wait for the app shell, which only renders once stores have hydrated. */
async function gotoApp(page, hash = '') {
  await page.goto(`${worker.origin}/${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.sync-pill', { timeout: 20_000 });
}

const VIEWS = [
  ['#dashboard', 'Overview'],
  ['#cashflow', 'Cash flow'],
  ['#position', 'Position'],
  ['#investments', 'Investments'],
  ['#pensions', 'Pensions'],
  ['#budgets', 'Budgets']
];

test('the app boots and every screen renders without a console error', async () => {
  for (const [hash, label] of VIEWS) {
    const { context, page, errors } = await openPage();
    try {
      await gotoApp(page, hash);
      await page.waitForSelector('main.content', { timeout: 20_000 });
      const body = await page.textContent('main.content');
      assert.ok(body && body.trim().length > 0, `${label} rendered no content`);
      assert.deepEqual(errors, [], `${label} logged console errors`);
    } finally {
      await context.close();
    }
  }
});

test('the cash flow screen shows the income streams panel and its metrics', async () => {
  const { context, page } = await openPage();
  try {
    await gotoApp(page, '#cashflow');
    await page.waitForSelector('.protection-banner, .fh-table, .muted', { timeout: 20_000 });
    // The headline figures are a presentational component; assert the eyebrow
    // labels survive, which is what a duplicated or dropped card would break.
    const labels = await page.locator('.fh-metric .eyebrow').allTextContents();
    for (const expected of ['SAFE TO SPEND EACH DAY', 'DAYS UNTIL PAYDAY', 'BALANCE AT PAYDAY']) {
      assert.ok(labels.includes(expected), `missing metric ${expected} — got ${JSON.stringify(labels)}`);
    }
    // No account yet, so the app must admit the data is local-only rather than
    // implying it is safely stored.
    const pill = await page.textContent('.sync-pill');
    assert.match(pill || '', /This device only|Synced|Offline/);
  } finally {
    await context.close();
  }
});

/** The header button reads "Sign in" signed out and "Profile" signed in. */
function authButton(page) {
  return page.locator('header .secondary-button', { hasText: /^(Sign in|Profile)$/ });
}

/**
 * Record every signed-in / signed-out state the header passes through.
 *
 * Asserting the final state is not enough: the app self-heals. A stale read
 * clears the session, and the next read restores it, so the defect is a visible
 * flash back to signed out rather than a state that persists. The sequence is
 * what shows the user actually saw, and it is deterministic.
 */
async function recordAuthStates(page) {
  await page.evaluate(() => {
    const header = document.querySelector('header');
    window.__authStates = [];
    const read = () => {
      const text = header?.textContent || '';
      const state = text.includes('Profile') ? 'in' : text.includes('Sign in') ? 'out' : 'other';
      if (window.__authStates[window.__authStates.length - 1] !== state) window.__authStates.push(state);
    };
    new MutationObserver(read).observe(header, { childList: true, subtree: true, characterData: true });
    read();
  });
}

function authStates(page) {
  return page.evaluate(() => window.__authStates || []);
}

/** Every state after the first 'in' — the ones the user saw post sign-in. */
function statesAfterSignIn(states) {
  const first = states.indexOf('in');
  return first === -1 ? [] : states.slice(first + 1);
}

/**
 * Hold each `/api/auth/session` response back, so a read started now is answered
 * long after the test has moved on.
 *
 * The request is issued *first* and the response is fulfilled after the delay, so
 * the answer reflects the cookie state at request time. Deferring with
 * `route.continue()` instead would postpone the request itself, which would pick
 * up the new cookie and answer 200 — modelling nothing at all.
 */
async function delaySessionReads(page, ms = 1500) {
  await page.route('**/api/auth/session', async (route) => {
    const response = await route.fetch();
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.fulfill({ response });
  });
}

test('a session read that resolves after sign-in does not undo the sign-in', async () => {
  // Regression: the boot-time session check has no cookie, so it answers 401. If
  // that answer landed after sign-in had stored the user, it set the session back
  // to null and the header flipped to "Sign in" with the protection pill red,
  // which reads as "my account did not save". The delayed read guarantees the
  // ordering instead of hoping for it.
  const email = `race-${randomBytes(5).toString('hex')}@example.invalid`;
  const { context, page, errors } = await openPage();
  try {
    await delaySessionReads(page);
    await gotoApp(page, '#dashboard');
    await recordAuthStates(page);

    await authButton(page).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 20_000 });
    await dialog.getByRole('button', { name: /Need an account\?/ }).click();
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill('smoke-test-password-123');
    await dialog.getByRole('button', { name: /^Sign up$/ }).click();

    await page.waitForFunction(
      () => (document.querySelector('header')?.textContent || '').includes('Profile'),
      undefined,
      { timeout: 20_000 }
    );

    // Outlast the delayed read, which is the whole point: its stale 401 must not
    // clear the session that sign-up just established. The end state is not the
    // signal — the app re-reads and recovers — so the sequence is asserted.
    await page.waitForTimeout(3000);
    const seen = await authStates(page);
    assert.ok(seen.includes('in'), `never reached signed in: ${JSON.stringify(seen)}`);
    assert.deepEqual(
      statesAfterSignIn(seen),
      [],
      `the header fell back to signed out after sign-in: ${JSON.stringify(seen)}`
    );
    assert.equal(await sessionStatus(page), 200, 'the session was undone by a stale read');
    assert.deepEqual(errors, [], 'the race logged console errors');
  } finally {
    await context.close();
  }
});

/**
 * The reverse race — a stale read resurrecting a session just after sign-out — is
 * guarded by the same generation check but is not reachable in this app: once
 * signed in, `getSessionUser` answers from cache, so no session read is ever in
 * flight while the user is able to press "Sign out". It was left untested rather
 * than given a test that passed with the guard removed.
 */
/** Ask the API directly whether a session exists, rather than inferring it. */
function sessionStatus(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/auth/session', { credentials: 'include' });
    return response.status;
  });
}

test('signing up establishes a session and signing out revokes it', async () => {
  const email = `browser-${randomBytes(5).toString('hex')}@example.invalid`;
  const password = 'smoke-test-password-123';
  const { context, page, errors } = await openPage();
  try {
    await gotoApp(page, '#dashboard');

    // Starting state, recorded so the later assertions cannot pass on it by
    // accident. The previous version of this test ended by waiting for exactly
    // this state, so a sign-out that did nothing still passed.
    assert.equal(await sessionStatus(page), 401, 'no session before signing up');
    assert.match(await authButton(page).textContent() || '', /^Sign in$/);
    assert.match(await page.textContent('.sync-pill') || '', /This device only/);

    await authButton(page).click();
    const dialog = page.locator('[role="dialog"]');
    await dialog.waitFor({ timeout: 20_000 });
    // Scoped to the dialog: the page behind it has forms of its own, so a bare
    // `form` selector can bind to the wrong element.
    await dialog.getByRole('button', { name: /Need an account\?/ }).click();
    await dialog.locator('input[type="email"]').fill(email);
    await dialog.locator('input[type="password"]').fill(password);
    await dialog.getByRole('button', { name: /^Sign up$/ }).click();

    // Signed in. The session endpoint is the authority, not the UI copy.
    await page.waitForFunction(
      () => (document.querySelector('header')?.textContent || '').includes('Profile'),
      undefined,
      { timeout: 20_000 }
    );
    assert.equal(await sessionStatus(page), 200, 'sign-up did not create a session');
    // The pill is derived from the same session, but it is a separate reactive
    // binding, so wait for it to settle rather than sampling it the instant the
    // button flips. Sampling once here was flaky: the app re-checks the session
    // after sign-up and briefly reports it as missing.
    await page.waitForFunction(
      () => /Synced|Offline|Not syncing/.test(document.querySelector('.sync-pill')?.textContent || ''),
      undefined,
      { timeout: 20_000 }
    );
    assert.deepEqual(errors, [], 'sign-up logged console errors');

    await authButton(page).click();
    const profile = page.locator('[role="dialog"]');
    await profile.waitFor({ timeout: 20_000 });
    await profile.getByRole('button', { name: /Sign out|Log out/i }).click();

    // Signed out. Asserting the header text is what makes this non-vacuous: the
    // pill reads the same as it did before sign-up, so the pill alone proves
    // nothing here.
    await page.waitForFunction(
      () => (document.querySelector('header')?.textContent || '').includes('Sign in'),
      undefined,
      { timeout: 20_000 }
    );
    assert.equal(await sessionStatus(page), 401, 'sign-out did not revoke the session');
    assert.match(await page.textContent('.sync-pill') || '', /This device only/);
    assert.deepEqual(errors, [], 'sign-out logged console errors');
  } finally {
    await context.close();
  }
});

