import test from 'node:test';
import assert from 'node:assert/strict';

import { wealthPointsByDate } from '../src/services/wealth.js';
import { growthPercent } from '../src/services/runway.js';

const row = (date, value, currencyCode = 'GBP') => ({ date, value, currencyCode });

test('all three histories are summed per date, not concatenated', () => {
  // The bug this prevents: concatenating and sorting by date would interleave
  // unrelated snapshots, so "previous" could be one day's investments against
  // the next day's pension pot. Grouping first makes each point a real total.
  const accounts = [row('2026-09-01', 1000), row('2026-09-30', 1200)];
  const investments = [row('2026-09-30', 500)];
  const pensions = [row('2026-09-30', 300)];

  const points = wealthPointsByDate([accounts, investments, pensions]);
  assert.deepEqual(points, [
    { date: '2026-09-01', value: 1000 },
    { date: '2026-09-30', value: 2000 }
  ]);
  // Growth from 1000 to 2000 is +100%. Interleaving would have produced a
  // different, meaningless number.
  assert.equal(growthPercent(points), 100);
});

test('a date with snapshots from several stores totals them', () => {
  const points = wealthPointsByDate([
    [row('2026-09-30', 1000)],
    [row('2026-09-30', 250), row('2026-10-01', 400)],
    [row('2026-09-30', 50)]
  ]);
  assert.deepEqual(points, [
    { date: '2026-09-30', value: 1300 },
    { date: '2026-10-01', value: 400 }
  ]);
});

test('currency conversion is applied per row before summing', () => {
  // A USD holding must be converted with its own rate, not the row's default.
  const rates = { GBP: 0.75, USD: 1 };
  const points = wealthPointsByDate(
    [[row('2026-09-30', 100, 'GBP'), row('2026-09-30', 200, 'USD')]],
    { convert: (value, r) => value / (rates[r.currencyCode] || 1) }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 100 / 0.75 + 200);
});

test('rows without a usable value or date are skipped, not counted as zero', () => {
  // A half-written snapshot must not silently drag a date's total down.
  const points = wealthPointsByDate([
    [
      row('2026-09-30', 1000),
      { date: '2026-09-30', value: 'not a number', currencyCode: 'GBP' },
      { date: '', value: 500 },
      { date: '2026-09-30', value: null },
      { value: 700 }
    ]
  ]);
  assert.deepEqual(points, [{ date: '2026-09-30', value: 1000 }]);
});

test('an empty or missing history contributes nothing at all', () => {
  assert.deepEqual(wealthPointsByDate([[], null, undefined]), []);
  assert.deepEqual(wealthPointsByDate([]), []);
  assert.deepEqual(wealthPointsByDate(), []);
  // No data means no percentage, not a misleading 0%.
  assert.equal(growthPercent(wealthPointsByDate([[], []])), null);
});

test('the same-day pension and investment snapshots produce one point', () => {
  // Real shape: pensionHistory and portfolioHistory both carry rows for the same
  // date. Those must collapse into one total, not two competing points.
  const points = wealthPointsByDate([[row('2026-09-23', 124644)], [row('2026-09-23', 1000)]]);
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 125644);
});

test('points are ordered by date regardless of input order', () => {
  const points = wealthPointsByDate([[row('2026-10-01', 3), row('2026-09-01', 1), row('2026-11-01', 2)]]);
  assert.deepEqual(points.map((p) => p.date), ['2026-09-01', '2026-10-01', '2026-11-01']);
});

test('a liability in the accounts history reduces the total it contributes', () => {
  // The mortgage arrives unsigned with `kind` on the row, so the caller's
  // converter is responsible for the sign. Here it is applied, and the resulting
  // point must be net, not gross.
  const points = wealthPointsByDate(
    [[{ date: '2026-09-24', value: 506000, kind: 'Asset', currencyCode: 'GBP' },
      { date: '2026-09-24', value: 309216, kind: 'Liability', currencyCode: 'GBP' }]],
    { convert: (value, r) => (String(r.kind).toLowerCase() === 'liability' ? -value : value) }
  );
  assert.equal(points.length, 1);
  assert.equal(points[0].value, 506000 - 309216);
});
