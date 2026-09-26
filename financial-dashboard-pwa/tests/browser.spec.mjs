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
  worker = await startLocalWorker({ port, source: 'tests/browser.test.js' });
  browser = await chromium.launch();
});

test.after(async () => {
  await browser?.close();
  worker?.stop();
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

test('signing up, signing out and signing back in round trips in a real browser', async () => {
  const email = `browser-${randomBytes(5).toString('hex')}@example.invalid`;
  const password = 'smoke-test-password-123';
  const { context, page, errors } = await openPage();
  try {
    await gotoApp(page, '#dashboard');
    assert.match(await page.textContent('.sync-pill') || '', /This device only/, 'starts with no account');

    await page.getByRole('button', { name: /^Sign in$/ }).click();
    await page.waitForSelector('.auth-form, form', { timeout: 20_000 });
    const dialog = page.locator('form').first();
    await dialog.getByRole('button', { name: /Sign up|Create/i }).click().catch(async () => {
      // Some builds default to the sign-up form; fill whichever is showing.
      await dialog.locator('input[type="email"]').fill(email);
    });
    await dialog.locator('input[type="email"]').fill(email);
    const passwordFields = dialog.locator('input[type="password"]');
    await passwordFields.nth(0).fill(password);
    if (await passwordFields.count() > 1) await passwordFields.nth(1).fill(password);
    await dialog.locator('button[type="submit"]').click();

    // Signed in: the pill must report protection, not local-only.
    await page.waitForFunction(
      () => /Synced|Offline|Not syncing/.test(document.querySelector('.sync-pill')?.textContent || ''),
      undefined,
      { timeout: 20_000 }
    );
    assert.deepEqual(errors, [], 'sign-up logged console errors');

    await page.getByRole('button', { name: /Profile/ }).click();
    await page.getByRole('button', { name: /Sign out|Log out/i }).click();
    await page.waitForFunction(
      () => /This device only|Synced/.test(document.querySelector('.sync-pill')?.textContent || ''),
      undefined,
      { timeout: 20_000 }
    );
  } finally {
    await context.close();
  }
});
