import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDailyRunway, runwayPlanner, growthPercent, monthGrowth, latestBySeries, num, parseNonNegativeNumber, safeSpendPlan } from '../src/services/runway.js';

// The grid is anchored on recorded balance history rather than on a bare
// `balance` figure, so the shared fixture carries one record on the start day.
// `balance` stays as the current available figure the screens read; the record is
// what the rows are built from.
const base = {
  balance: 900,
  currency: 'USD',
  payday: '2026-03-10',
  today: '2026-03-01',
  balanceHistory: [{ id: 'balance-2026-03-01', date: '2026-03-01', amount: 900, currencyCode: 'USD' }],
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

test('safe amount is one flat cycle budget and cumulative is daily times day number', () => {
  const rows = buildDailyRunway(base);
  const second = rows[1];
  const payday = rows.at(-1);
  assert.equal(rows[0].safeDays, 10, 'the inclusive day count is the divisor');
  assert.equal(rows[0].safe, 900 / 10, 'the whole balance spread across every day to payday');
  assert.equal(second.safe, 900 / 10, 'the same daily allowance on every row, not a growing one');
  assert.equal(rows[0].starting, 900);
  assert.equal(rows[0].ending, 900);
  assert.equal(payday.ending, 900, 'hypothetical safe spending never reduces the actual balance');
  assert.equal(rows[0].cumulativeSafeSpend, 90, 'x1');
  assert.equal(second.cumulativeSafeSpend, 180, 'x2 — tomorrow is today safe x2');
  assert.equal(rows[2].cumulativeSafeSpend, 270, 'x3');
  assert.equal(payday.safe, 90, 'payday is an ordinary day in the cycle, not a special case');
  assert.equal(payday.cumulativeSafeSpend, 900, 'x10 lands on exactly the cash available');
});

test('the final row equals cash after bills and spend items', () => {
  const plan = runwayPlanner({
    ...base,
    bills: [{ id: 'energy', name: 'Energy', amount: 100, dueDay: 8, currencyCode: 'USD' }],
    commitments: [{ id: 'food', name: 'Food shop', date: '2026-03-05', amount: 50, currencyCode: 'USD' }]
  });
  // 900 balance - 100 bill - 50 Spend Item = 750 of genuinely free cash.
  assert.equal(plan.cashAfterPlannedSpend, 750);
  assert.equal(plan.safeTotal, 750);
  assert.equal(plan.safeDaily, 75);
  assert.equal(
    plan.rows.at(-1).cumulativeSafeSpend,
    plan.cashAfterPlannedSpend,
    'the closing row is the headline CASH AFTER BILLS & SPEND ITEMS figure'
  );
  assert.equal(plan.rows[0].safe, plan.safeToday, 'the headline card matches the first row');
});

test('cumulative is exactly the daily allowance times the day number on every row', () => {
  for (const scenario of [
    { name: 'no obligations', extra: {} },
    { name: 'bill and Spend Item', extra: { bills: [{ id: 'e', name: 'Energy', amount: 100, dueDay: 8, currencyCode: 'USD' }], commitments: [{ id: 'f', name: 'Food', date: '2026-03-05', amount: 50, currencyCode: 'USD' }] } },
    { name: 'short runway', extra: { payday: '2026-03-03' } },
    { name: 'payday tomorrow', extra: { payday: '2026-03-02' } },
    { name: 'full month', extra: { payday: '2026-03-31' } }
  ]) {
    const plan = runwayPlanner({ ...base, ...scenario.extra });
    for (const row of plan.rows) {
      assert.equal(
        row.cumulativeSafeSpend,
        plan.safeDaily * row.dayNumber,
        `${scenario.name} ${row.date}: cumulative is not safe x ${row.dayNumber}`
      );
    }
    assert.equal(
      plan.rows.at(-1).cumulativeSafeSpend,
      plan.cashAfterPlannedSpend,
      `${scenario.name}: the final row must equal cash after bills and spend items`
    );
  }
});

test('cumulative safe spend can never exceed the cash available', () => {
  // The regression this replaces: recomputing the pot against each row's
  // shrinking day count told every late row it could spend the whole balance,
  // so the column summed the same money once per day (4.72x on this input).
  for (const scenario of [
    { name: 'no obligations', extra: {} },
    { name: 'bill and Spend Item', extra: { bills: [{ id: 'e', name: 'Energy', amount: 100, dueDay: 8, currencyCode: 'USD' }], commitments: [{ id: 'f', name: 'Food', date: '2026-03-05', amount: 50, currencyCode: 'USD' }] } },
    { name: 'short runway', extra: { payday: '2026-03-03' } },
    { name: 'long runway past the 45-day cap', extra: { balance: 9000, payday: '2026-05-01' } },
    { name: 'obligations exceed the balance', extra: { bills: [{ id: 'e', name: 'Energy', amount: 1000, dueDay: 8, currencyCode: 'USD' }] } }
  ]) {
    const plan = runwayPlanner({ ...base, ...scenario.extra });
    for (const row of plan.rows) {
      assert.ok(
        row.cumulativeSafeSpend <= plan.safeTotal + 1e-9,
        `${scenario.name}: ${row.date} overshot the reserve`
      );
    }
    // The ramp is monotonic: a cumulative column that ever fell would be nonsense.
    const cumulative = plan.rows.map((row) => row.cumulativeSafeSpend);
    assert.deepEqual(cumulative, [...cumulative].sort((a, b) => a - b), `${scenario.name}: cumulative is not monotonic`);
  }
});

test('a deficit cycle never offers a negative daily allowance', () => {
  const plan = runwayPlanner({
    ...base,
    bills: [{ id: 'e', name: 'Energy', amount: 1000, dueDay: 8, currencyCode: 'USD' }]
  });
  assert.equal(plan.cashAfterPlannedSpend, -100);
  assert.equal(plan.shortfall, 100);
  assert.equal(plan.safeTotal, 0, 'the reserve is floored at zero; money cannot be spent negatively');
  assert.equal(plan.safeDaily, 0);
  assert.equal(plan.rows.at(-1).cumulativeSafeSpend, 0);
  for (const row of plan.rows) assert.equal(row.safe, 0);
});

test('safeSpendPlan divides the reserve by the inclusive day count', () => {
  assert.deepEqual(safeSpendPlan({ obligationsOnlyCash: 900, dayCount: 10 }), {
    safeTotal: 900,
    safeDaily: 90,
    dayCount: 10
  });
  assert.deepEqual(
    safeSpendPlan({ obligationsOnlyCash: 900, dayCount: 1 }),
    { safeTotal: 900, safeDaily: 900, dayCount: 1 },
    'payday today is a single x1 row, not a divide-by-zero'
  );
  assert.equal(safeSpendPlan({ obligationsOnlyCash: -50, dayCount: 10 }).safeDaily, 0, 'no negative daily target');
  assert.equal(safeSpendPlan({ obligationsOnlyCash: 900, dayCount: 0 }).safeDaily, 900, 'a zero day count floors at 1');
});

test('payday today is a single day reading x1', () => {
  const plan = runwayPlanner({ ...base, payday: '2026-03-01' });
  assert.equal(plan.daysUntilPayday, 0);
  assert.equal(plan.dayCount, 1);
  assert.equal(plan.rows.length, 1);
  assert.equal(plan.safeToday, 900);
  assert.equal(plan.rows[0].safe, 900);
  assert.equal(plan.rows[0].cumulativeSafeSpend, 900, 'x1 equals the whole cash after bills and spend items');
});

test('future obligations are reserved while actual balances change only when charged', () => {
  const rows = buildDailyRunway({
    ...base,
    bills: [{ id: 'energy', name: 'Energy', amount: 100, dueDay: 8, currencyCode: 'USD' }],
    commitments: [{ id: 'food', name: 'Food shop', date: '2026-03-05', amount: 50, currencyCode: 'USD' }]
  });
  const foodDay = rows.find((row) => row.date === '2026-03-05');
  const dayAfterFood = rows.find((row) => row.date === '2026-03-06');
  const energyDay = rows.find((row) => row.date === '2026-03-09');

  assert.equal(rows[0].safe, 750 / 10, 'today reserves the future bill and Spend Item');
  assert.equal(rows[0].starting, 900);
  assert.equal(rows[0].ending, 900);
  assert.equal(foodDay.commitments, 50);
  assert.equal(foodDay.starting, 900);
  assert.equal(foodDay.ending, 850, 'only the actual Spend Item changes Ending');
  assert.equal(dayAfterFood.starting, foodDay.ending);
  assert.equal(dayAfterFood.ending, 850, 'hypothetical safe spending is not deducted');
  assert.equal(energyDay.bills, 100);
  assert.equal(energyDay.ending, 750, 'Ending equals available balance minus actual obligations');
  assert.equal(rows.at(-1).ending, 750);
  assert.equal(rows.at(-1).cumulativeSafeSpend, rows.reduce((sum, row) => sum + row.safe, 0));
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

test('planner summarises obligations while truncating only rendered rows', () => {
  const plan = runwayPlanner(base);
  assert.equal(plan.dayCount, 10);
  assert.equal(plan.daysUntilPayday, 9);
  assert.equal(plan.renderedDays, 10);
  assert.equal(plan.truncated, false);
  assert.equal(plan.safeToday, 900 / 10);
  assert.equal(plan.safeDaily, 900 / 10);
  assert.equal(plan.safeTotal, 900);
  assert.equal(plan.projectedAtPayday, 900);
  assert.equal(plan.scheduledBills, 0);
  assert.equal(plan.scheduledCommitments, 0);

  const longPlan = runwayPlanner({
    ...base,
    balance: 9000,
    payday: '2026-05-01',
    // Re-anchored on the longer window's opening balance.
    balanceHistory: [{ id: 'balance-2026-03-01', date: '2026-03-01', amount: 9000, currencyCode: 'USD' }],
    commitments: [{ name: 'Late repair', date: '2026-04-20', amount: 300, currencyCode: 'USD' }]
  });
  assert.equal(longPlan.dayCount, 62);
  assert.equal(longPlan.daysUntilPayday, 61);
  assert.equal(longPlan.renderedDays, 45);
  assert.equal(longPlan.truncated, true);
  assert.equal(longPlan.scheduledCommitments, 300, 'summary includes an obligation after the rendered cap');
  assert.equal(round(longPlan.safeToday), round((9000 - 300) / 62), 'divided by the inclusive 62-day cycle');
  assert.equal(longPlan.projectedAtPayday, 8700);
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
    // Re-anchored: the scenario's whole point is a 100 opening balance, so the
    // record has to say so rather than inherit the 900 the shared fixture uses.
    balanceHistory: [{ id: 'balance-2026-03-01', date: '2026-03-01', amount: 100, currencyCode: 'USD' }],
    commitments: [{ name: 'Major purchase', date: '2026-03-05', amount: 150, currencyCode: 'USD' }]
  });
  assert.equal(plan.safeToday, 0);
  assert.equal(plan.cashAfterPlannedSpend, -50);
  assert.equal(plan.shortfall, 50);
  assert.equal(plan.projectedAtPayday, -50);
});

test('the grid covers the whole pay cycle when a payday rule is set', () => {
  // Payday on the 15th, today the 20th: the cycle opened on the 15th and closes
  // the day before the next payday, so past days are part of the view.
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    bills: [],
    commitments: []
  });
  assert.equal(plan.isCycle, true);
  assert.equal(plan.cycleStart, '2026-10-15');
  // The next payday is the 15th of November, which is a Sunday, so it is brought
  // back to Friday the 13th and the cycle closes the day before that.
  assert.equal(plan.cycleEnd, '2026-11-12', 'the day before the weekend-shifted payday');
  assert.equal(plan.dayCount, 29, '15 Oct through 12 Nov inclusive');
  assert.equal(plan.rows.length, 29);
  assert.equal(plan.rows[0].date, '2026-10-15');
  assert.equal(plan.rows.at(-1).date, '2026-11-12');
  // "Days until payday" still counts to the real payday, not to the cycle end.
  assert.equal(plan.daysUntilPayday, 11);
});

test('a payday today opens the cycle rather than collapsing it', () => {
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-15',
    paydayDayOfMonth: 15,
    today: '2026-10-15',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    bills: [],
    commitments: []
  });
  assert.equal(plan.cycleStart, '2026-10-15');
  // 15 November 2026 is a Sunday, so that payday lands on Friday the 13th.
  assert.equal(plan.cycleEnd, '2026-11-12');
  assert.equal(plan.dayCount, 29);
  assert.equal(plan.rows.length, 29);
  assert.equal(plan.rows[0].isToday, true, 'payday itself is today, not the past');
});

test('without a payday rule the grid keeps the old today-through-payday window', () => {
  const plan = runwayPlanner(base);
  assert.equal(plan.isCycle, false);
  assert.equal(plan.dayCount, 10, 'today 1 Mar through payday 10 Mar');
  assert.equal(plan.rows[0].date, '2026-03-01');
  assert.equal(plan.rows.at(-1).date, '2026-03-10');
});

test('rows are flagged past, today or upcoming from the grid, not re-derived in the view', () => {
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    bills: [],
    commitments: []
  });
  const flags = plan.rows.map((row) => (row.isPast ? 'past' : row.isToday ? 'today' : 'upcoming'));
  assert.equal(flags.filter((flag) => flag === 'past').length, 5, '15 Oct to 19 Oct');
  assert.equal(flags.filter((flag) => flag === 'today').length, 1, 'exactly one today');
  // 21 Oct through the 12th, the day before the weekend-shifted next payday.
  assert.equal(flags.filter((flag) => flag === 'upcoming').length, 23);
  assert.equal(plan.pastDays, 5);
  assert.equal(plan.todayIndex, 5);
});

test('a day before the first record is left blank rather than given a guessed balance', () => {
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    // First record is the 18th, so the 15th-17th have nothing behind them.
    balanceHistory: [{ id: 'b', date: '2026-10-18', amount: 900, currencyCode: 'USD' }],
    bills: [],
    commitments: []
  });
  const [first, second, third, fourth] = plan.rows;
  assert.equal(first.anchored, false);
  assert.equal(first.starting, null, 'unknown, not zero');
  assert.equal(first.ending, null);
  assert.equal(second.starting, null);
  assert.equal(third.starting, null);
  assert.equal(fourth.date, '2026-10-18');
  assert.equal(fourth.starting, 900, 'the record anchors its own day');
  assert.equal(plan.awaitingHistory, false, 'some history exists');
});

test('an unrecorded day flows forward from the record before it', () => {
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    // A bill charged on the 16th reduces every day after it.
    bills: [{ id: 'rent', amount: 100, dueDay: 16, currencyCode: 'USD' }],
    commitments: []
  });
  const byDate = new Map(plan.rows.map((row) => [row.date, row]));
  assert.equal(byDate.get('2026-10-15').starting, 900, 'the record day');
  assert.equal(byDate.get('2026-10-15').ending, 900, 'nothing due that day');
  assert.equal(byDate.get('2026-10-16').starting, 900, 'the bill is charged during the 16th');
  assert.equal(byDate.get('2026-10-16').ending, 800);
  assert.equal(byDate.get('2026-10-17').starting, 800, 'and carries forward from there');
  assert.equal(byDate.get('2026-10-20').starting, 800);
  assert.equal(byDate.get('2026-10-20').anchorDate, '2026-10-15');
});

test('a recorded day is marked so a measured figure is distinguishable from a flowed one', () => {
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [
      { id: 'b1', date: '2026-10-15', amount: 900, currencyCode: 'USD' },
      { id: 'b2', date: '2026-10-18', amount: 850, currencyCode: 'USD' }
    ],
    bills: [],
    commitments: []
  });
  const byDate = new Map(plan.rows.map((row) => [row.date, row]));
  assert.equal(byDate.get('2026-10-15').isRecorded, true);
  assert.equal(byDate.get('2026-10-18').isRecorded, true);
  assert.equal(byDate.get('2026-10-18').starting, 850, 'the newer record wins from its own day');
  assert.equal(byDate.get('2026-10-17').isRecorded, false, 'flowed from the earlier record');
  assert.equal(plan.recordedDays, 2);
});

test('with no history at all the grid is empty and says so', () => {
  const plan = runwayPlanner({ ...base, balanceHistory: [] });
  assert.equal(plan.rows.length, 0, 'no anchor, so no invented rows');
  assert.equal(plan.awaitingHistory, true);
  assert.equal(plan.safeToday, 0, 'no budget without an anchor to measure from');
});

test('the budget pot is measured from the anchor, not double-counted from today', () => {
  // 1000 recorded on the 15th, with a 100 bill charged on the 16th and nothing
  // else in the cycle. The pot must be 900: 1000 minus the one charge. Reading
  // today's balance and subtracting the whole cycle again would double-count the
  // charge, because today's balance has already had it applied.
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 1000, currencyCode: 'USD' }],
    bills: [{ id: 'rent', amount: 100, dueDay: 16, currencyCode: 'USD' }],
    commitments: []
  });
  assert.equal(plan.cashAfterPlannedSpend, 900, 'the pot after the single charge');
  assert.equal(plan.safeTotal, 900);
  assert.equal(plan.safeDaily, 900 / 29, 'one division by the inclusive cycle length');
  // The closing row's cumulative safe spend and ending balance meet at the pot.
  const last = plan.rows.at(-1);
  assert.equal(last.cumulativeSafeSpend, 900);
  assert.equal(last.ending, 900);
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
