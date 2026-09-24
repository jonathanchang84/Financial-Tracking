import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyRunway, runwayPlanner, growthPercent, monthGrowth, latestBySeries, num, parseNonNegativeNumber } from '../src/services/runway.js';

const base = {
  balance: 900,
  currency: 'USD',
  payday: '2026-03-10',
  today: '2026-03-01',
  bills: [],
  commitments: []
};

test('one row per day from today through payday, inclusive', () => {
  const rows = buildDailyRunway(base);
  assert.equal(rows.length, 10);
  assert.equal(rows[0].date, '2026-03-01');
  assert.equal(rows[9].date, '2026-03-10');
  assert.equal(rows[0].dayNumber, 1);
  assert.equal(rows[9].dayNumber, 10);
});

test('safe amount spreads the balance across the cycle and ending lands on zero', () => {
  const rows = buildDailyRunway(base);
  assert.equal(rows[0].safe, 90);
  assert.equal(rows[0].starting, 900);
  assert.equal(rows[0].ending, 810);
  assert.equal(rows[9].ending, 0, 'spending the safe amount every day leaves nothing');
});

test('planned Spend Items reduce that day and are carried cumulatively', () => {
  const rows = buildDailyRunway({
    ...base,
    commitments: [{ name: 'Food shop', date: '2026-03-05', amount: 50, currencyCode: 'USD' }]
  });
  const day = rows.find((row) => row.date === '2026-03-05');
  const next = rows.find((row) => row.date === '2026-03-06');
  assert.equal(rows[0].safe, 85, 'the 50-pound Spend Item is reserved before daily spending');
  assert.equal(day.commitments, 50);
  assert.equal(day.cumulative, 50);
  assert.equal(day.ending, 900 - 5 * 85 - 50, 'five safe days plus the Spend Item');
  assert.equal(next.cumulative, 50, 'cumulative persists across days');
  assert.equal(next.starting, day.ending);
});

test('scheduled bills charge on the weekend-shifted Monday, never on the weekend', () => {
  const rows = buildDailyRunway({
    ...base,
    bills: [{ name: 'Rent', amount: 100, dueDay: 8, currencyCode: 'USD' }]
  });
  const saturday = rows.find((row) => row.date === '2026-03-07');
  const sunday = rows.find((row) => row.date === '2026-03-08');
  const monday = rows.find((row) => row.date === '2026-03-09');
  assert.equal(saturday.bills, 0);
  assert.equal(sunday.bills, 0, 'a Sunday due date is not paid on the Sunday');
  assert.equal(monday.bills, 100, 'it moves to Monday');
});

test('only records in the balance currency reach the grid', () => {
  const rows = buildDailyRunway({
    ...base,
    bills: [
      { name: 'USD bill', amount: 30, dueDay: 3, currencyCode: 'USD' },
      { name: 'EUR bill', amount: 999, dueDay: 3, currencyCode: 'EUR' }
    ],
    commitments: [
      { name: 'USD plan', date: '2026-03-03', amount: 20, currencyCode: 'USD' },
      { name: 'JPY plan', date: '2026-03-03', amount: 5000, currencyCode: 'JPY' }
    ]
  });
  const day = rows.find((row) => row.date === '2026-03-03');
  assert.equal(day.bills, 30);
  assert.equal(day.commitments, 20);
});

test('missing balance, missing payday or a payday in the past returns no rows', () => {
  assert.deepEqual(buildDailyRunway({ ...base, balance: 0 }), []);
  assert.deepEqual(buildDailyRunway({ ...base, payday: '' }), []);
  assert.deepEqual(buildDailyRunway({ ...base, payday: '2026-02-01' }), [], 'payday already happened');
});

test('planner summarises the full cycle while truncating only rendered rows', () => {
  const plan = runwayPlanner(base);
  assert.equal(plan.dayCount, 10);
  assert.equal(plan.renderedDays, 10);
  assert.equal(plan.truncated, false);
  assert.equal(plan.safeToday, 90);
  assert.equal(plan.projectedAtPayday, 0);
  assert.equal(plan.scheduledBills, 0);
  assert.equal(plan.scheduledCommitments, 0);

  const longPlan = runwayPlanner({
    ...base,
    balance: 9000,
    payday: '2026-05-01',
    commitments: [{ name: 'Late repair', date: '2026-04-20', amount: 300, currencyCode: 'USD' }]
  });
  assert.equal(longPlan.dayCount, 62);
  assert.equal(longPlan.renderedDays, 45);
  assert.equal(longPlan.truncated, true);
  assert.equal(longPlan.scheduledCommitments, 300, 'summary includes an obligation after the rendered cap');
  assert.equal(round(longPlan.safeToday), round((9000 - 300) / 62));
  assert.equal(longPlan.projectedAtPayday, 0);
});

test('runway handles same-day, malformed and past paydays explicitly', () => {
  const sameDay = runwayPlanner({ ...base, payday: '2026-03-01' });
  assert.equal(sameDay.dayCount, 1);
  assert.equal(sameDay.rows.length, 1);
  assert.equal(sameDay.paydayPast, false);

  const past = runwayPlanner({ ...base, payday: '2026-02-01' });
  assert.equal(past.dayCount, 0);
  assert.equal(past.rows.length, 0);
  assert.equal(past.paydayPast, true);

  const malformed = runwayPlanner({ ...base, payday: 'not-a-date' });
  assert.equal(malformed.payday, '');
  assert.equal(malformed.dayCount, 0);
  assert.equal(malformed.rows.length, 0);
});

test('obligations larger than the balance produce a visible shortfall and no negative safe target', () => {
  const plan = runwayPlanner({
    ...base,
    balance: 100,
    commitments: [{ name: 'Major purchase', date: '2026-03-05', amount: 150, currencyCode: 'USD' }]
  });
  assert.equal(plan.safeToday, 0);
  assert.equal(plan.cashAfterPlannedSpend, -50);
  assert.equal(plan.shortfall, 50);
  assert.equal(plan.projectedAtPayday, -50);
});

test('growth helpers match the historic month-on-month wording', () => {
  assert.equal(growthPercent([{ value: 100 }, { value: 110 }]), 10);
  assert.equal(growthPercent([{ value: 100 }]), null);
  assert.equal(growthPercent([{ value: 0 }, { value: 50 }]), null, 'no divide by zero');
  assert.match(monthGrowth([{ value: 200 }, { value: 150 }]), /^-?\D*Latest change: -25\.00% month-on-month$/);
  assert.equal(monthGrowth([]), 'Not enough data for month-on-month growth');
});

test('latestBySeries keeps one row per series name', () => {
  const rows = latestBySeries([
    { series: 'Fund 1', date: '2026-01-01', value: 10 },
    { series: 'Fund 1', date: '2026-02-01', value: 20 },
    { series: 'Fund 2', date: '2026-02-01', value: 5 }
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows.find((row) => row.series === 'Fund 1').value, 20);
});

test('num coerces formatted strings and rejects nonsense', () => {
  assert.equal(num('1,234.50'), 1234.5);
  assert.equal(num(''), 0);
  assert.equal(num(null), 0);
  assert.equal(num('abc'), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(12), 12);
});

test('parseNonNegativeNumber accepts zero and formatted values but rejects invalid drafts', () => {
  assert.equal(parseNonNegativeNumber(''), null);
  assert.equal(parseNonNegativeNumber('   '), null);
  assert.equal(parseNonNegativeNumber(null), null);
  assert.equal(parseNonNegativeNumber(undefined), null);
  assert.equal(parseNonNegativeNumber('abc'), null);
  assert.equal(parseNonNegativeNumber('-1'), null);
  assert.equal(parseNonNegativeNumber(0), 0);
  assert.equal(parseNonNegativeNumber('1,234.50'), 1234.5);
});

function round(value) {
  return Math.round(value * 100) / 100;
}
