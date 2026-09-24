import test from 'node:test';
import assert from 'node:assert/strict';

import {
  categoryTotals,
  currentMonthExpenses,
  daysUntilPayday,
  monthlyPensionRate,
  projectPensionSeries,
  redundancyProjection
} from '../src/services/financeCalculations.js';
import { runwayPlanner } from '../src/services/runway.js';

test('daysUntilPayday uses the workbook exclusive date difference', () => {
  assert.equal(daysUntilPayday('2026-09-24', '2026-09-25'), 1);
  assert.equal(daysUntilPayday('2026-09-24', '2026-09-24'), 0);
  assert.equal(daysUntilPayday('2026-09-24', '2026-09-23'), 0);
  assert.equal(daysUntilPayday('not-a-date', '2026-09-25'), 0);
});

test('categoryTotals groups the workbook Type values and drops empty groups', () => {
  const rows = categoryTotals([
    { category: 'Housing', amount: 100 },
    { category: 'Utilities', amount: 25 },
    { category: 'Housing', amount: 50 },
    { category: 'Zero', amount: 0 }
  ]);
  assert.deepEqual(rows, [
    { category: 'Housing', value: 150 },
    { category: 'Utilities', value: 25 }
  ]);
});

test('current month remainder subtracts only unpaid rows in workbook order', () => {
  const result = currentMonthExpenses({
    balance: 100,
    currency: 'USD',
    month: '2026-09-15',
    bills: [
      { id: 'rent', name: 'Rent', category: 'Housing', amount: 20, dueDay: 1, currencyCode: 'USD' },
      { id: 'energy', name: 'Energy', category: 'Utilities', amount: 30, dueDay: 5, currencyCode: 'USD' }
    ],
    commitments: [
      { id: 'food', name: 'Food', date: '2026-09-10', amount: 10, currencyCode: 'USD' }
    ],
    paidExpenses: { 'bill:rent:2026-09': true }
  });

  assert.equal(result.total, 60);
  assert.equal(result.unpaidTotal, 40);
  assert.equal(result.remainder, 60);
  assert.deepEqual(result.rows.map((row) => row.remainder), [100, 70, 60]);
  assert.deepEqual(result.rows.map((row) => row.paid), [true, false, false]);
  assert.deepEqual(result.categories, [
    { category: 'Utilities', value: 30 },
    { category: 'Housing', value: 20 },
    { category: 'Spend Items', value: 10 }
  ]);
});

test('recurring bill payment state is scoped to its month', () => {
  const bill = { id: 'rent', amount: 20, dueDay: 1, currencyCode: 'USD' };
  const september = currentMonthExpenses({
    balance: 100,
    currency: 'USD',
    month: '2026-09-15',
    bills: [bill],
    paidExpenses: { 'bill:rent:2026-09': true }
  });
  const october = currentMonthExpenses({
    balance: 100,
    currency: 'USD',
    month: '2026-10-15',
    bills: [bill],
    paidExpenses: { 'bill:rent:2026-09': true }
  });
  assert.equal(september.rows[0].paid, true);
  assert.equal(october.rows[0].paid, false);
});

test('runway excludes paid bills and spend items from safe-to-spend obligations', () => {
  const plan = runwayPlanner({
    balance: 1000,
    currency: 'USD',
    payday: '2026-09-04',
    today: '2026-09-01',
    bills: [{ id: 'rent', amount: 100, dueDay: 2, currencyCode: 'USD' }],
    commitments: [{ id: 'food', date: '2026-09-02', amount: 50, currencyCode: 'USD' }],
    paidExpenses: { 'bill:rent:2026-09': true, 'commitment:food': true }
  });
  assert.equal(plan.obligationTotal, 0);
  assert.equal(plan.safeToday, 250);
  assert.equal(plan.projectedAtPayday, 0);
});

test('pension monthly rate and annual projection match the workbook formulas', () => {
  assert.ok(Math.abs(monthlyPensionRate(0.08) - 0.00643403011000343) < 1e-12);
  const projection = projectPensionSeries({
    history: [
      { series: 'UBS', date: '2026-04-01', value: 110000, currencyCode: 'USD' },
      { series: 'HSBC', date: '2026-04-01', value: 58000, currencyCode: 'USD' }
    ],
    annualRate: 0.08,
    years: 1
  });
  assert.equal(projection.series.length, 2);
  assert.equal(projection.points.length, 2);
  assert.ok(Math.abs(projection.points[1].values[0] - 118800) < 0.0001);
  assert.ok(Math.abs(projection.points[1].values[1] - 62640) < 0.0001);
});

test('redundancy projection matches the workbook tax and runway scenarios', () => {
  const result = redundancyProjection({
    payout: 71855.77,
    taxFreeThreshold: 30000,
    taxRate: 0.4,
    monthlySpends: [5800, 5100, 3800]
  });
  assert.ok(Math.abs(result.taxable - 41855.77) < 0.0001);
  assert.ok(Math.abs(result.netTakeHome - 55113.462) < 0.0001);
  assert.ok(Math.abs(result.scenarios[0].months - 9.5023210345) < 0.0001);
  assert.ok(Math.abs(result.scenarios[1].months - 10.8065611765) < 0.0001);
  assert.ok(Math.abs(result.scenarios[2].months - 14.5035426316) < 0.0001);
});
