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

/**
 * Report a failure as a GitHub `::error::` annotation.
 *
 * This is the only way to see why the suite failed without read access to the run
 * log, which is private to the repository owner: annotations appear on the run
 * page itself, stdout does not. A red step name and nothing else is not a
 * diagnosable failure.
 *
 * Called from where a failure happens rather than from an `after` hook, because
 * `node:test` hooks receive no context object - verified on Node 22 and 24 - so
 * a hook cannot see which test failed or why. Keeping this here rather than
 * inline also means one message format for every check.
 */
export function annotateFailure(title, detail) {
  // One line, and bounded: GitHub truncates long annotation bodies, and a
  // multi-line error breaks the `::` command format entirely.
  const body = String(detail || 'no detail recorded')
    .split('\n')
    .find((line) => line.trim() && !/^\s*at\s/.test(line)) || 'no detail recorded';
  console.error(`::error title=${JSON.stringify(title)}::${body.trim().slice(0, 500)}`);
}


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

/**
 * The headline NET WORTH figure must count holdings and pensions, not accounts
 * alone. The tiles below it show those separately, so a total that omits them
 * reads as though the money does not exist.
 *
 * Seeded through the app's own IndexedDB, then read back off the rendered tile.
 */
test('net worth totals accounts, investments and pensions', async () => {
  const { context, page, errors } = await openPage();
  try {
    await gotoApp(page, '#/');
    await page.waitForSelector('main.content', { timeout: 20_000 });

    // Seeded in USD, which is the default display currency, so no rate conversion
    // happens and the total is exact. The unit tests cover conversion; pinning it
    // here would make this test fail on a legitimate rate change instead of on a
    // broken total.
    //
    // Values chosen so a total that silently drops a store is unmistakable rather
    // than a few percent out, and a liability is included so its sign is checked.
    // 1,000,000 asset - 309,216 mortgage + 900,000 holding + 5,000 pension.
    await seedHistory(page, {
      store: 'netWorthEntries',
      rows: [
        { id: 'nw-asset', name: 'Main Account', kind: 'Asset', value: 1000000, currencyCode: 'USD', currentFlag: true, validFrom: '2026-09-24', validTo: null },
        { id: 'nw-mortgage', name: 'Mortgage', kind: 'Liability', value: 309216, currencyCode: 'USD', currentFlag: true, validFrom: '2026-09-24', validTo: null }
      ]
    });
    await seedHistory(page, {
      store: 'holdings',
      rows: [
        { id: 'h-1', name: 'Big Fund', symbol: 'BIG', type: 'Equity', quantity: 1, price: 900000, currencyCode: 'USD', currentFlag: true, validFrom: '2026-09-24', validTo: null }
      ]
    });
    await seedHistory(page, {
      store: 'pensions',
      rows: [
        { id: 'p-1', name: 'Work Pension', value: 5000, currencyCode: 'USD', currentFlag: true, validFrom: '2026-09-24', validTo: null }
      ]
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.fh-metric', { timeout: 20_000 });

    // Read the rendered tiles rather than the store, so this checks what a user
    // actually sees. Each tile is found by its own label to avoid positional
    // coupling to the grid order.
    const tileValue = async (label) => {
      const text =
        (await page.locator('.fh-metric', { hasText: label }).first().locator('strong').textContent()) || '';
      return { text, digits: Number((text.match(/[\d,]+(?:\.\d+)?/) || ['0'])[0].replace(/,/g, '')) };
    };

    const netWorth = await tileValue('NET WORTH');
    const investments = await tileValue('INVESTMENTS');
    const pensions = await tileValue('PENSIONS');

    // The component tiles are unchanged by this fix; only the total is new.
    assert.equal(investments.digits, 900000, `INVESTMENTS should be 900,000, got "${investments.text}"`);
    assert.equal(pensions.digits, 5000, `PENSIONS should be 5,000, got "${pensions.text}"`);

    // 1,000,000 - 309,216 + 900,000 + 5,000. Accounts-only would read 690,784, so
    // dropping the holding or the pots fails by 900,000 rather than marginally.
    assert.equal(
      netWorth.digits,
      1595784,
      `NET WORTH should be 1,595,784 (asset minus liability, plus holdings and pensions), got "${netWorth.text}"`
    );

    // The currency panel must describe the same total, not accounts alone.
    assert.equal(
      await page.locator('.panel', { hasText: 'Total wealth by currency' }).count(),
      1,
      'the currency panel should be titled for total wealth'
    );
    assert.deepEqual(errors, [], 'the dashboard logged console errors');
  } catch (error) {
    annotateFailure('Net worth did not total all three stores', error?.message || error);
    throw error;
  } finally {
    await context.close();
  }
});

test('the app boots and every screen renders without a console error', async () => {
  for (const [hash, label] of VIEWS) {
    const { context, page, errors } = await openPage();
    try {
      await gotoApp(page, hash);
      await page.waitForSelector('main.content', { timeout: 20_000 });
      const body = await page.textContent('main.content');
      assert.ok(body && body.trim().length > 0, `${label} rendered no content`);
      assert.deepEqual(errors, [], `${label} logged console errors`);
    } catch (error) {
      // Annotated at the point of failure, because this is the test that reports
      // "logged console errors" and a bare assertion says only that something
      // was wrong, never which message the page logged.
      annotateFailure(`Browser smoke: ${label} did not render cleanly`, error?.message || error);
      throw error;
    } finally {
      await context.close();
    }
  }
});

/**
 * Seed history through the app's own IndexedDB, then reload.
 *
 * Writing via `store.put` rather than clicking through the UI keeps this fast,
 * and it exercises the same read path the screens use, so the chart is fed
 * exactly what production would feed it. `settings` is written too because the
 * positions screens read their entity lists from it.
 */
async function seedHistory(page, { store = 'pensionHistory', rows }) {
  await page.evaluate(
    async ({ store: storeName, rows: data }) => {
      const open = () =>
        new Promise((resolve, reject) => {
          // Matches DB_VERSION in src/services/indexedDB.js. Opening with a lower
          // version than the database already has is a hard error, so this has to
          // move whenever a new store is added.
          const request = indexedDB.open('financial-health-local', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const db = await open();
      const write = (name, records) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(name, 'readwrite');
          const os = tx.objectStore(name);
          for (const record of records) os.put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      await write(storeName, data);
      db.close();
    },
    { store, rows }
  );
}

test('the position charts stack bars with a zero-based axis and selectable series', async () => {
  const { context, page } = await openPage();
  try {
    // Three pots across two years. "Old pot" stops after 2022, so it must
    // contribute no segment to 2023 rather than a zero-height one.
    // Values chosen so the stacked total lands just over a tick boundary
    // (~$104k). With a 50k step that floors the axis to 50k without an explicit
    // zero floor, which is the exact case the render bug showed. Totals around
    // 90k floor to zero by luck and the assertion below passes for the wrong
    // reason, which is worse than no assertion.
    const rows = [
      ['Work pension', '2022-03-15', 48_000], ['Work pension', '2022-08-15', 55_000],
      ['Work pension', '2022-12-15', 51_000], ['Work pension', '2023-03-15', 62_000],
      ['Work pension', '2023-12-15', 68_000],
      ['Side pot', '2022-06-10', 9_000], ['Side pot', '2022-10-10', 11_000],
      ['Side pot', '2023-04-10', 14_000],
      ['Old pot', '2022-05-01', 4_000], ['Old pot', '2022-09-01', 4_500]
    ].map(([series, date, value], index) => ({
      id: `stack-${index}`, series, date, value, currencyCode: 'GBP'
    }));

    await gotoApp(page, '#pensions');
    await seedHistory(page, { store: 'pensionHistory', rows });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trend-bar', { timeout: 20_000 });

    // Stacked, not one bar per series: two years x three pots, but "Old pot" is
    // absent from 2023, so 2022 has 3 segments and 2023 has 2.
    assert.equal(await page.locator('.trend-bar').count(), 5, 'expected 3 segments in 2022 and 2 in 2023');

    // A bar is a length, so the axis has to start at zero. When the floor
    // rounded up to a nice step the small segments were drawn off the plot and
    // the chart read as one solid bar.
    const axis = await page.locator('.trend-axis-label').allTextContents();
    assert.equal(axis[0], '0', `the y axis must start at zero, got ${JSON.stringify(axis)}`);
    for (const label of axis) {
      assert.match(label, /^-?[\d.]+[kbm]?$/, `unreadable axis label: "${label}"`);
    }

    // End of period, not the peak: 2022's Work pension cell must be December's
    // 51,000 rather than the August high of 55,000. The bar beside it reads from
    // the same pivot, so this also proves the two agree.
    const cell2022 = await page.locator('.monthly-history-table tbody tr').first().textContent();
    assert.match(cell2022 || '', /2022/, 'the year row is labelled by year');
    const totals = await page.locator('.trend-total').allTextContents();
    assert.equal(totals.length, 2, `one total per year, got ${JSON.stringify(totals)}`);
    // Labelled and in full currency, not the abbreviated axis format: a total is
    // the figure a reader actually wants, so it is not squeezed to "88.1k".
    // The symbol is whatever the display currency is, so only the shape is pinned.
    assert.match(totals[0], /^Net Value: \S/, `the total is not labelled: "${totals[0]}"`);
    assert.match(totals[0], /Net Value: [^\d-]*[\d,]+/, `the total is not a currency figure: "${totals[0]}"`);
    // Assets minus liabilities, so the label reports a net figure and can be negative.
    assert.match(totals[1], /^Net Value: \S/, `"${totals[1]}"`);

    // The table follows the same toggle as the chart, and says which unit it is in.
    assert.equal(await page.locator('.monthly-history-table thead th').first().textContent(), 'Year');
    const tableYears = await page.locator('.monthly-history-table tbody tr th').allTextContents();
    assert.deepEqual(tableYears, ['2022', '2023'], `expected year rows, got ${JSON.stringify(tableYears)}`);

    // Year by default, with a control to expand to months - and the table has to
    // re-bucket with it, since both read the same pivot.
    const months = await page.locator('.trend-month-label').allTextContents();
    assert.deepEqual(months, ['2022', '2023'], `expected year labels, got ${JSON.stringify(months)}`);
    await page.getByRole('button', { name: 'By month' }).click();
    await page.waitForFunction(
      () => document.querySelectorAll('.trend-bar').length > 5,
      null,
      { timeout: 10_000 }
    );
    const monthLabels = await page.locator('.trend-month-label').allTextContents();
    assert.ok(monthLabels.some((label) => /\d{2}$/.test(label)), `expected month labels, got ${JSON.stringify(monthLabels)}`);
    assert.equal(await page.locator('.monthly-history-table thead th').first().textContent(), 'Month');
    const tableMonths = await page.locator('.monthly-history-table tbody tr th').allTextContents();
    assert.ok(
      tableMonths.length > 2 && tableMonths[0] !== '2022',
      `the table should have re-bucketed to months, got ${JSON.stringify(tableMonths.slice(0, 3))}`
    );

    // Every series gets a checkbox, and unticking one removes its segments.
    const toggles = page.locator('.series-toggle input');
    assert.equal(await toggles.count(), 3, 'one toggle per series');
    const before = await page.locator('.trend-bar').count();
    await toggles.nth(0).uncheck();
    await page.waitForFunction(
      (was) => document.querySelectorAll('.trend-bar').length < was,
      before,
      { timeout: 10_000 }
    );
    assert.ok(await page.locator('.series-toggle input:not(:checked)').count() >= 1, 'the toggle should stay unchecked');
  } catch (error) {
    annotateFailure('Browser smoke: the stacked bar chart is wrong', error?.message || error);
    throw error;
  } finally {
    await context.close();
  }
});

test('net worth stacks assets above the axis and liabilities below it', async () => {
  const { context, page } = await openPage();
  try {
    // An asset and a liability recorded in the same month, so one bar has to
    // carry segments on both sides of the zero line.
    const rows = [
      { id: 'nw-a1', logicalId: 'cash', series: 'Cash', date: '2026-03-31', value: 20000, kind: 'Asset' },
      { id: 'nw-a2', logicalId: 'house', series: 'House', date: '2026-03-31', value: 300000, kind: 'Asset' },
      { id: 'nw-l1', logicalId: 'mortgage', series: 'Mortgage', date: '2026-03-31', value: 150000, kind: 'Liability' }
    ];

    await gotoApp(page, '#position');
    // The current entries too: the screens fall back to them for the kind of any
    // history row recorded before `kind` was written onto it.
    await seedHistory(page, { store: 'netWorthEntries', rows: [
      { id: 'cash', logicalId: 'cash', name: 'Cash', kind: 'Asset', value: 20000, currencyCode: 'GBP' },
      { id: 'house', logicalId: 'house', name: 'House', kind: 'Asset', value: 300000, currencyCode: 'GBP' },
      { id: 'mortgage', logicalId: 'mortgage', name: 'Mortgage', kind: 'Liability', value: 150000, currencyCode: 'GBP' }
    ] });
    await seedHistory(page, { store: 'netWorthHistory', rows });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.trend-bar', { timeout: 20_000 });

    // Three segments: two assets stacked up, one liability hanging below.
    assert.equal(await page.locator('.trend-bar').count(), 3, 'one segment per series');

    // The geometry is the point: assets above the zero line, the liability below.
    // Both are measured in screen pixels. Taking the rects' raw `y`/`height`
    // attributes would compare SVG user units against a screen-space zero, which
    // is meaningless - the viewBox scales them by different factors.
    const zeroY = await page.locator('.trend-axis-label').evaluateAll((nodes) => {
      const zero = nodes.find((node) => node.textContent.trim() === '0');
      if (!zero) return null;
      const svg = zero.ownerSVGElement;
      const point = svg.createSVGPoint();
      point.x = 0;
      point.y = Number(zero.getAttribute('y')) - 3;
      return point.matrixTransform(zero.getScreenCTM()).y;
    });
    assert.ok(zeroY !== null, 'the axis needs a labelled zero for the two sides to be comparable');

    const edges = await page.locator('.trend-bar').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom };
      })
    );
    const highest = Math.min(...edges.map((edge) => edge.top));
    const lowest = Math.max(...edges.map((edge) => edge.bottom));
    assert.ok(highest < zeroY, `assets should sit above the zero line, highest was ${highest} vs ${zeroY}`);
    assert.ok(lowest > zeroY, `liabilities should hang below the zero line, lowest was ${lowest} vs ${zeroY}`);
    // Both assets wholly above the line. The bottom-most asset starts AT zero, so
    // this is `<=` and not `<`.
    const aboveCount = edges.filter((edge) => edge.bottom <= zeroY).length;
    assert.equal(aboveCount, 2, `both assets should be above the line, got ${aboveCount} of ${edges.length}`);
    // And one wholly below it. The height is checked as well as the position: a
    // collapsed liability collapses to the 1px minimum the renderer falls back to,
    // which sits below the line and so satisfies a position-only check while
    // showing nothing at all.
    const below = edges.filter((edge) => edge.top >= zeroY);
    assert.equal(below.length, 1, `the liability should hang below the line, got ${below.length} of ${edges.length}`);
    assert.ok(
      below[0].bottom - below[0].top > 20,
      `the liability should be a visible bar, not a 1px sliver: ${Math.round(below[0].bottom - below[0].top)}px`
    );

    // The liability is marked in the legend in words, not by colour alone.
    assert.ok(
      await page.locator('.series-toggle .series-flag').count() >= 1,
      'the legend should label the liability'
    );

    // The net is assets minus liabilities: 20,000 + 300,000 - 150,000.
    const totals = await page.locator('.trend-total').allTextContents();
    assert.equal(totals.length, 1, `one net total, got ${JSON.stringify(totals)}`);
    const net = Number(String(totals[0]).replace(/[^0-9.-]/g, ''));
    assert.ok(
      Math.abs(net - 170000) < 1500,
      `net should be about 170,000 (assets minus liabilities), got ${net} from "${totals[0]}"`
    );
  } catch (error) {
    annotateFailure('Browser smoke: assets and liabilities are not stacked on the correct sides', error?.message || error);
    throw error;
  } finally {
    await context.close();
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
  } catch (error) {
    annotateFailure('Browser smoke: the cash flow screen is missing a metric', error?.message || error);
    throw error;
  } finally {
    await context.close();
  }
});

test('the pay cycle grid shades past days, marks today, and blanks unanchored days', async () => {
  // The cycle view is the whole reason this screen changed, and every part of it
  // can fail silently: a missing class greys nothing, and a missing em-dash
  // renders a confident-looking zero for a balance nobody recorded. So all three
  // are asserted together against a seeded history.
  const { context, page, errors } = await openPage();
  try {
    await gotoApp(page, '#cashflow');
    await page.waitForSelector('.fh-form', { timeout: 20_000 });

    const today = await page.evaluate(() => {
      const now = new Date();
      const key = (date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      // Three days ago and today, so there is a gap the grid must carry forward
      // and a recorded day it must badge.
      const back = new Date(now.getTime() - 3 * 86400000);
      return { recorded: key(back), today: key(now) };
    });

    await page.evaluate(async ({ recorded, today: todayKey }) => {
      const open = () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open('financial-health-local', 3);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(['settings', 'balanceHistory'], 'readwrite');
        const settings = tx.objectStore('settings');
        settings.put({ id: 'balance', key: 'balance', value: 900 });
        settings.put({ id: 'balanceCurrency', key: 'balanceCurrency', value: 'USD' });
        // A payday rule is what turns on the cycle view. Without it the planner has
        // no window at all, so seeding history alone would render no rows and the
        // test would pass for the wrong reason if it only checked for a table.
        settings.put({
          id: 'incomeStreams',
          key: 'incomeStreams',
          value: [{ id: 's1', name: 'Salary', dayOfMonth: 15, isMain: true }]
        });
        tx.objectStore('balanceHistory').put({
          id: `balance-${recorded}`,
          date: recorded,
          amount: 900,
          currencyCode: 'USD'
        });
        tx.objectStore('balanceHistory').put({
          id: `balance-${todayKey}`,
          date: todayKey,
          amount: 880,
          currencyCode: 'USD'
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    }, today);

    await page.reload();
    await page.waitForSelector('.runway-table tbody tr', { timeout: 20_000 });

    const rowCount = await page.locator('.runway-table tbody tr').count();
    assert.ok(rowCount > 0, 'the grid rendered no rows');

    // A recorded day is badged, so a measured figure is separable from a carried one.
    await page.waitForSelector('.runway-flag.recorded', { timeout: 10_000 });

    // Every row is classified as exactly one of past / today / upcoming.
    const classified = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.runway-table tbody tr')).map((row) => ({
        past: row.classList.contains('is-past'),
        today: row.classList.contains('is-today')
      }))
    );
    assert.ok(
      classified.some((row) => row.past),
      'no row is marked as a past day, so the cycle shading is not working'
    );
    assert.equal(
      classified.filter((row) => row.today).length,
      1,
      'exactly one row must be marked today'
    );

    assert.deepEqual(errors, [], `console errors: ${JSON.stringify(errors)}`);
  } catch (error) {
    annotateFailure('Browser smoke: the pay cycle grid is not showing past/upcoming/recorded', error?.message || error);
    throw error;
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

