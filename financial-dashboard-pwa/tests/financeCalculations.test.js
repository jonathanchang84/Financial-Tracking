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
import { buildMonthlyHistoryTable } from '../src/services/monthlyHistory.js';
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
    // The grid is anchored on recorded history, so the scenario records the
    // opening balance on the first day of the window.
    balanceHistory: [{ id: 'balance-2026-09-01', date: '2026-09-01', amount: 1000, currencyCode: 'USD' }],
    bills: [{ id: 'rent', amount: 100, dueDay: 2, currencyCode: 'USD' }],
    commitments: [{ id: 'food', date: '2026-09-02', amount: 50, currencyCode: 'USD' }],
    paidExpenses: { 'bill:rent:2026-09': true, 'commitment:food': true }
  });
  assert.equal(plan.obligationTotal, 0);
  // Nothing is reserved, so all 1000 is free, spread across the four days
  // from 1 Sep to payday on 4 Sep inclusive: 1000 / 4.
  assert.equal(plan.safeTotal, 1000);
  assert.equal(plan.safeDaily, 250);
  assert.equal(plan.safeToday, 250);
  assert.equal(plan.projectedAtPayday, 1000);
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

test('pension projection applies different annual rates and compounds monthly', () => {
  const projection = projectPensionSeries({
    pots: [
      { id: 'ubs', name: 'UBS', value: 1000, currencyCode: 'USD' },
      { id: 'hsbc', name: 'HSBC', value: 2000, currencyCode: 'USD' }
    ],
    growthByPot: { ubs: 0.08, hsbc: 0.04 },
    annualRate: 0.05,
    years: 1
  });
  assert.equal(projection.series[0].annualRate, 0.08);
  assert.equal(projection.series[1].annualRate, 0.04);
  assert.ok(Math.abs(projection.monthlyPoints[1].values[0] - 1000 * (1 + monthlyPensionRate(0.08))) < 0.0001);
  assert.ok(Math.abs(projection.points[1].values[0] - 1000 * 1.08) < 0.0001);
  assert.ok(Math.abs(projection.points[1].values[1] - 2000 * 1.04) < 0.0001);
});

test('pension projection uses the global rate only when a pot has no saved rate', () => {
  const projection = projectPensionSeries({
    pots: [{ id: 'ubs', name: 'UBS', value: 1000, currencyCode: 'USD' }],
    growthByPot: { ubs: 0.08 },
    annualRate: 0.05,
    years: 1
  });
  assert.equal(projection.series[0].annualRate, 0.08);
  assert.ok(Math.abs(projection.points[1].values[0] - 1080) < 0.0001);
});

test('pension growth follows a pot stable logical id across snapshot versions', () => {
  const projection = projectPensionSeries({
    history: [
      { logicalId: 'pot-1', series: 'UBS', date: '2026-01-01', value: 900, currencyCode: 'USD' },
      { logicalId: 'pot-1', series: 'UBS', date: '2026-02-01', value: 1000, currencyCode: 'USD' }
    ],
    pots: [{ id: 'pot-1', name: 'UBS', value: 1000, currencyCode: 'USD' }],
    growthByPot: { 'pot-1': 0.08 },
    annualRate: 0.05,
    years: 1
  });
  assert.equal(projection.series.length, 1);
  assert.equal(projection.series[0].id, 'pot-1');
  assert.equal(projection.series[0].annualRate, 0.08);
  assert.ok(Math.abs(projection.points[1].values[0] - 1080) < 0.0001);
});

test('pension projection supports a capped 80-year calendar horizon', () => {
  const projection = projectPensionSeries({
    pots: [{ id: 'ubs', name: 'UBS', value: 1000, currencyCode: 'USD' }],
    annualRate: 0.05,
    years: 999,
    today: '2026-09-24'
  });
  assert.equal(projection.years, 80);
  assert.equal(projection.maxYears, 80);
  assert.equal(projection.baseYear, 2026);
  assert.equal(projection.points.length, 81);
  assert.equal(projection.points[0].calendarYear, 2026);
  assert.equal(projection.points.at(-1).calendarYear, 2106);
  assert.equal(projection.monthlyPoints.length, 961);
});

test('pension projection uses the current year when no valid reference date is supplied', () => {
  const projection = projectPensionSeries({
    pots: [{ id: 'ubs', name: 'UBS', value: 1000, currencyCode: 'USD' }],
    years: 2,
    today: 'not-a-date'
  });
  assert.equal(projection.points[0].calendarYear, new Date().getFullYear());
  assert.equal(projection.points.at(-1).calendarYear, new Date().getFullYear() + 2);
});

test('pension projection uses the latest recorded year for calendar labels', () => {
  const projection = projectPensionSeries({
    history: [
      { logicalId: 'ubs', series: 'UBS', date: '2024-06-30', value: 1000, currencyCode: 'USD' },
      { logicalId: 'ubs', series: 'UBS', date: '2025-06-30', value: 1100, currencyCode: 'USD' }
    ],
    years: 2,
    today: '2026-09-24'
  });
  assert.equal(projection.baseYear, 2025);
  assert.deepEqual(projection.points.map((point) => point.calendarYear), [2025, 2026, 2027]);
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

test('monthly history uses the last snapshot in each month and keeps missing months', () => {
  const table = buildMonthlyHistoryTable({
    rows: [
      { series: 'Savings 1', date: '2026-01-10', value: 100, currencyCode: 'USD' },
      { series: 'Savings 1', date: '2026-01-25', value: 120, currencyCode: 'USD' },
      { series: 'Savings 1', date: '2026-03-02', value: 144, currencyCode: 'USD' },
      { series: 'Savings 2', date: '2026-01-31', value: 50, currencyCode: 'USD' },
      { series: 'Savings 2', date: '2026-03-31', value: 0, currencyCode: 'USD' }
    ]
  });
  assert.deepEqual(table.buckets, ['2026-01', '2026-02', '2026-03']);
  assert.equal(table.granularity, 'month');
  assert.equal(table.columns.length, 2);
  assert.equal(table.rows[0].cells['Savings 1'].value, 120);
  assert.equal(table.rows[0].cells['Savings 1'].change, null);
  assert.equal(table.rows[1].cells['Savings 1'].value, null);
  assert.equal(table.rows[1].cells['Savings 1'].change, null);
  assert.equal(table.rows[2].cells['Savings 1'].value, 144);
  assert.equal(table.rows[2].cells['Savings 1'].change, null);
  // A real zero is a figure, not a gap: null is reserved for "no record".
  assert.equal(table.rows[2].cells['Savings 2'].value, 0);
  assert.equal(table.rows[2].cells['Savings 2'].change, null);
  // The closing snapshot's date travels with the cell so the chart can name it.
  assert.equal(table.rows[0].cells['Savings 1'].date, '2026-01-25');
  assert.equal(table.rows[1].cells['Savings 1'].date, null);
});

test('yearly history buckets by year and takes the last snapshot in the year', () => {
  // The same pivot, a coarser bucket, so the chart and the table can share it and
  // still say "end of the year" rather than "end of March".
  const table = buildMonthlyHistoryTable({
    rows: [
      { series: 'Pension', date: '2024-03-15', value: 10_000, currencyCode: 'USD' },
      { series: 'Pension', date: '2024-08-15', value: 12_000, currencyCode: 'USD' },
      { series: 'Pension', date: '2024-12-20', value: 11_000, currencyCode: 'USD' },
      { series: 'Pension', date: '2025-06-10', value: 13_000, currencyCode: 'USD' }
    ],
    granularity: 'year'
  });
  assert.equal(table.granularity, 'year');
  assert.deepEqual(table.buckets, ['2024', '2025']);
  // December's 11,000, not the August peak of 12,000.
  assert.equal(table.rows[0].cells['Pension'].value, 11_000);
  assert.equal(table.rows[0].cells['Pension'].date, '2024-12-20');
  assert.equal(table.rows[1].cells['Pension'].value, 13_000);
  // Change is measured against the previous bucket, which is a year here.
  assert.equal(table.rows[1].cells['Pension'].change, (13000 - 11000) / 11000 * 100);
});

test('monthly history calculates the adjacent month change', () => {
  const table = buildMonthlyHistoryTable({
    rows: [
      { series: 'Savings', date: '2026-01-15', value: 100, currencyCode: 'USD' },
      { series: 'Savings', date: '2026-02-15', value: 110, currencyCode: 'USD' }
    ]
  });
  assert.deepEqual(table.columns.map((column) => column.key), ['Savings']);
  assert.equal(table.rows[1].cells['Savings'].change, 10);
  assert.equal(table.rows[1].cells['Savings'].value, 110);
});

test('one series recorded in two currencies is one column, in its latest currency', () => {
  // This used to be asserted the other way round, and that assertion is what let
  // a duplicated position inflate the total. One name is one position, so the
  // later snapshot wins rather than producing a column per currency.
  const table = buildMonthlyHistoryTable({
    rows: [
      { id: 'v1', logicalId: 'a', series: 'Savings', date: '2026-01-15', value: 100, currencyCode: 'USD' },
      { id: 'v2', logicalId: 'b', series: 'Savings', date: '2026-02-15', value: 121, currencyCode: 'GBP' }
    ]
  });
  assert.equal(table.columns.length, 1, 'one position, one column');
  assert.equal(table.columns[0].currency, 'GBP', 'the currency now in force');
  assert.equal(table.rows[1].cells['Savings'].value, 121, 'the later snapshot, not both');
});

test('monthly history returns an empty shape without valid dated snapshots', () => {
  assert.deepEqual(buildMonthlyHistoryTable({ rows: [{ series: 'Missing date' }] }), {
    buckets: [], columns: [], rows: [], granularity: 'month'
  });
});

test('monthly history does not invoke the value reader for missing cells', () => {
  let calls = 0;
  const table = buildMonthlyHistoryTable({
    rows: [
      { series: 'Savings', date: '2026-01-10', value: 100, currencyCode: 'USD' },
      { series: 'Savings', date: '2026-03-10', value: 120, currencyCode: 'USD' }
    ],
    readValue: (row) => {
      calls += 1;
      return row.value;
    }
  });
  assert.equal(calls, 3);
  assert.equal(table.rows[1].cells['Savings'].value, null);
  assert.equal(table.rows[1].cells['Savings'].change, null);
});
