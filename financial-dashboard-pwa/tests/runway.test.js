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

test('safeSpendPlan divides the reserve by the day count it is given', () => {
  assert.deepEqual(safeSpendPlan({ obligationsOnlyCash: 900, days: 10 }), {
    safeTotal: 900,
    safeDaily: 90,
    days: 10,
    dayCount: 10
  });
  assert.deepEqual(
    safeSpendPlan({ obligationsOnlyCash: 900, dayCount: 1 }),
    { safeTotal: 900, safeDaily: 900, days: 1, dayCount: 1 },
    'payday today is a single x1 row, not a divide-by-zero'
  );
  assert.equal(safeSpendPlan({ obligationsOnlyCash: -50, days: 10 }).safeDaily, 0, 'no negative daily target');
  assert.equal(safeSpendPlan({ obligationsOnlyCash: 900, days: 0 }).safeDaily, 900, 'a zero day count floors at 1');
  // The divisor is whatever span the caller names, so the same reserve over a
  // shorter remaining cycle gives a larger daily figure. That is the whole point:
  // days already gone are not days the money can be spent on.
  assert.equal(
    safeSpendPlan({ obligationsOnlyCash: 900, days: 9 }).safeDaily,
    100,
    'nine days ahead is a bigger daily budget than the same money over ten'
  );
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
  // back to Friday the 13th. The cycle runs *through* the closing payday, not up to
  // the day before it: a bill due on the payday is still a bill that has to be paid,
  // and stopping short of it silently omitted those bills from "Balance at payday".
  assert.equal(plan.cycleEnd, '2026-11-13', 'the weekend-shifted payday itself');
  assert.equal(plan.dayCount, 30, '15 Oct through 13 Nov inclusive');
  assert.equal(plan.rows.length, 30);
  assert.equal(plan.rows[0].date, '2026-10-15');
  assert.equal(plan.rows.at(-1).date, '2026-11-13');
  // "Days until payday" still counts to the real payday, not to the cycle end.
  assert.equal(plan.daysUntilPayday, 11);
});

test('a bill due on the payday itself is deducted, not tallied and forgotten', async () => {
  // The reported defect: the cycle stopped the day before payday, so a bill due on
  // the payday was counted in "Scheduled bills" but never deducted, leaving "Balance
  // at payday" overstated while every figure still looked self-consistent.
  const plan = runwayPlanner({
    balance: 1758.04,
    currency: 'GBP',
    payday: '2026-10-23',
    paydayDayOfMonth: 23,
    today: '2026-10-01',
    balanceHistory: [{ id: 'b', date: '2026-10-01', amount: 1758.04, currencyCode: 'GBP' }],
    bills: [
      { id: 'council', name: 'Council Tax', amount: 162.31, dueDay: 5, currencyCode: 'GBP' },
      { id: 'payday', name: 'Due on payday', amount: 84.51, dueDay: 23, currencyCode: 'GBP' }
    ],
    commitments: []
  });
  assert.equal(plan.cycleEnd, '2026-10-23', 'the cycle reaches the payday itself');
  // `scheduledBills` is the whole cycle, so the payday bill appears twice — on the
  // cycle's opening payday and on its closing one. What is deducted from today is the
  // second occurrence only, which is `remainingObligations`.
  assert.equal(plan.remainingObligations, 246.82, 'both bills are still to come');
  assert.equal(plan.projectedAtPayday, 1511.22, '1758.04 less both bills, including the payday one');
  assert.equal(plan.rows.at(-1).ending, plan.projectedAtPayday, 'and the closing row agrees');
  assert.equal(plan.excluded.hasExcluded, false, 'nothing is being quietly left out');
  // Every day of the budget, inclusive, so the cumulative still lands on the pot.
  assert.equal(plan.budgetDays, 23, '1 Oct through 23 Oct inclusive');
  assert.equal(plan.rows.at(-1).cumulativeSafeSpend, plan.safeTotal);
});

test('a bill due after payday is left for the next cycle, not counted as missing', () => {
  // Correct scoping rather than a defect: you are paid on the 23rd, so a bill due on
  // the 25th is not part of "balance at payday" and belongs to the next cycle.
  const plan = runwayPlanner({
    balance: 1758.04,
    currency: 'GBP',
    payday: '2026-10-23',
    paydayDayOfMonth: 23,
    today: '2026-10-01',
    balanceHistory: [{ id: 'b', date: '2026-10-01', amount: 1758.04, currencyCode: 'GBP' }],
    bills: [{ id: 'late', name: 'Due later', amount: 100, dueDay: 25, currencyCode: 'GBP' }],
    commitments: []
  });
  assert.equal(plan.projectedAtPayday, 1758.04, 'not due before payday, so not deducted');
  assert.equal(plan.excluded.hasExcluded, false, 'and not reported as missing either');
});

test('bills in another currency are reported rather than silently dropped', () => {
  // A foreign-currency bill can never be summed against this balance, and it never
  // appears in any cycle, so "Scheduled bills" can look complete while omitting it.
  const plan = runwayPlanner({
    balance: 900,
    currency: 'GBP',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-20', amount: 900, currencyCode: 'GBP' }],
    bills: [
      { id: 'home', amount: 100, dueDay: 27, currencyCode: 'GBP' },
      { id: 'us', amount: 60, dueDay: 27, currencyCode: 'USD' }
    ],
    commitments: [{ id: 'fx', date: '2026-10-25', amount: 40, currencyCode: 'EUR' }]
  });
  assert.equal(plan.scheduledBills, 100, 'only the matching currency is summed');
  assert.equal(plan.excluded.billsInOtherCurrencies, 1);
  assert.equal(plan.excluded.billsInOtherCurrenciesAmount, 60);
  assert.equal(plan.excluded.commitmentsInOtherCurrencies, 1);
  assert.equal(plan.excluded.hasExcluded, true, 'so the view can say the figure is partial');
});

test('nothing is reported as excluded when every bill matches the balance currency', () => {
  const plan = runwayPlanner({ ...base, bills: [{ id: 'e', amount: 100, dueDay: 5, currencyCode: 'USD' }] });
  assert.equal(plan.excluded.hasExcluded, false);
  assert.equal(plan.excluded.billsInOtherCurrencies, 0);
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
  // 15 November 2026 is a Sunday, so that payday lands on Friday the 13th, and the
  // cycle now runs through it.
  assert.equal(plan.cycleEnd, '2026-11-13');
  assert.equal(plan.dayCount, 30);
  assert.equal(plan.rows.length, 30);
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
  // 21 Oct through the 13th, the weekend-shifted next payday, which the cycle now
  // includes so a bill due that day is deducted rather than missed.
  assert.equal(flags.filter((flag) => flag === 'upcoming').length, 24);
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
    balanceHistory: [
      { id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' },
      { id: 'today', date: '2026-10-20', amount: 800, currencyCode: 'USD' }
    ],
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
  assert.equal(byDate.get('2026-10-18').starting, 800, 'an unrecorded day is not re-anchored');
  assert.equal(byDate.get('2026-10-18').anchorDate, '2026-10-15', 'it still reports the record it flows from');
  // Today has its own record, so it re-anchors rather than flowing forward. Without
  // one, the undated balance takes its place and these would read 900 and 900.
  assert.equal(byDate.get('2026-10-20').starting, 800);
  assert.equal(byDate.get('2026-10-20').anchorDate, '2026-10-20');
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
      { id: 'b2', date: '2026-10-18', amount: 850, currencyCode: 'USD' },
      { id: 'b3', date: '2026-10-20', amount: 830, currencyCode: 'USD' }
    ],
    bills: [],
    commitments: []
  });
  const byDate = new Map(plan.rows.map((row) => [row.date, row]));
  assert.equal(byDate.get('2026-10-15').isRecorded, true);
  assert.equal(byDate.get('2026-10-18').isRecorded, true);
  assert.equal(byDate.get('2026-10-18').starting, 850, 'the newer record wins from its own day');
  assert.equal(byDate.get('2026-10-17').isRecorded, false, 'flowed from the earlier record');
  assert.equal(plan.recordedDays, 3, 'only real dated records are counted');
});

test('with no dated history the undated balance still anchors today', () => {
  // The upgrade path. A user who set a balance but never opened the backfill form
  // has no dated records at all, and the grid used to come back empty and tell them
  // to record a balance they had already entered.
  const plan = runwayPlanner({ ...base, balanceHistory: [] });
  assert.equal(plan.rows.length, 10, 'the window still renders');
  assert.equal(plan.awaitingHistory, false, 'a balance is present, so this is not an empty-history state');
  // `base` has no payday rule, so the window is today through payday and today is
  // the first row. With a rule it is the whole cycle and today sits further in.
  assert.equal(plan.rows[0].isToday, true);
  assert.equal(plan.rows[0].date, '2026-03-01');
  assert.equal(plan.rows[0].starting, 900, "today is anchored on the balance the user actually has");
  assert.equal(plan.safeToday, 900 / 10, 'and the budget is real rather than a zero');
  // It is an anchor, not a claim that a dated figure was entered.
  assert.equal(plan.rows[0].isRecorded, false, 'not badged "Balance recorded" for an undated balance');
  assert.equal(plan.recordedDays, 0);
  // With no payday rule there is no window at all, and the grid honestly says so.
  const noPayday = runwayPlanner({ ...base, balanceHistory: [], payday: '' });
  assert.deepEqual(noPayday.rows, []);
  assert.equal(noPayday.awaitingHistory, false, 'no window means nothing to wait for history to fill');
});

test('on a cycle view the undated balance anchors today and leaves earlier days blank', () => {
  // The upgrade path as a user with a payday rule actually meets it: the grid spans
  // a cycle that opened before today, and only today can be known for certain.
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: []
  });
  const byDate = new Map(plan.rows.map((row) => [row.date, row]));
  assert.equal(plan.cycleStart, '2026-10-15', 'the cycle opened five days ago');
  assert.equal(plan.pastDays, 5, 'those five days are shown, shaded');
  for (const row of plan.rows.filter((r) => r.isPast)) {
    assert.equal(row.anchored, false, `${row.date} has no record and is not invented`);
    assert.equal(row.starting, null, `${row.date} reads as a blank rather than a guess`);
  }
  assert.equal(byDate.get('2026-10-20').starting, 900, 'today carries the real balance');
  assert.equal(byDate.get('2026-10-20').isRecorded, false, 'but is not badged as a dated record');
  assert.equal(plan.safeDaily, 900 / plan.budgetDays, 'the budget runs from today forward');
  assert.equal(plan.budgetDays, 25, '20 Oct to 13 Nov inclusive');
});

test('an explicit record for today wins over the undated balance', () => {
  // The implicit record is a fallback, not an override: a user who did record
  // today's balance has a dated figure that must be what the grid anchors on.
  const plan = runwayPlanner({
    ...base,
    balance: 900,
    balanceHistory: [{ id: 'b', date: '2026-03-01', amount: 875, currencyCode: 'USD' }]
  });
  assert.equal(plan.rows[0].starting, 875, 'the dated figure is used, not the scalar');
  assert.equal(plan.rows[0].isRecorded, true, 'a real dated record is badged as one');
  assert.equal(plan.safeDaily, 875 / 10, 'the budget is measured from the dated figure');
});

test('the budget pot is measured from today, never double-counting a past charge', () => {
  // 1000 recorded on the 15th, a 100 bill charged on the 16th, and today is the
  // 20th. The pot must be 900: 1000 minus the one charge, which today's balance has
  // already absorbed. Subtracting the charge a second time from the 15th anchor gave
  // 800, so the headline read less than the table's own closing row.
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
  // Divided by the days still ahead, not by the whole cycle.
  assert.equal(plan.budgetDays, 25, 'the budget covers today onward, not the full cycle');
  assert.equal(plan.dayCount, 30, 'the grid still spans the whole cycle');
  assert.equal(plan.safeDaily, 900 / 25, 'one division by the remaining day count');
  // The closing row's cumulative safe spend and ending balance meet at the pot.
  const last = plan.rows.at(-1);
  assert.equal(last.cumulativeSafeSpend, 900);
  assert.equal(last.ending, 900);
});

test('the payday headline and the closing table row are the same figure', () => {
  // The regression that made the two disagree: the headline subtracted the whole
  // cycle from the *earliest* record while the grid re-anchored on a later one, so
  // the same money was charged twice and the cards read 50.02 below the table.
  const plan = runwayPlanner({
    balance: 1758.04,
    currency: 'GBP',
    payday: '2026-10-23',
    paydayDayOfMonth: 23,
    today: '2026-10-01',
    balanceHistory: [
      { id: 'b1', date: '2026-09-25', amount: 1808.06, currencyCode: 'GBP' },
      { id: 'b2', date: '2026-10-01', amount: 1758.04, currencyCode: 'GBP' }
    ],
    bills: [
      { id: 'council', name: 'Council Tax', amount: 162.31, dueDay: 5, currencyCode: 'GBP' },
      { id: 'payday', name: 'Due on payday', amount: 84.51, dueDay: 23, currencyCode: 'GBP' }
    ],
    commitments: [{ id: 'food', name: 'Food', date: '2026-09-30', amount: 50.02, currencyCode: 'GBP' }]
  });
  const last = plan.rows.at(-1);
  assert.equal(plan.projectedAtPayday, last.ending, 'the cards and the table cannot disagree');
  assert.equal(plan.cashAfterPlannedSpend, last.ending, 'nor can the two cash cards');
  assert.equal(plan.projectedAtPayday, 1511.22, '1758.04 less both bills, including the one due on payday');
  // The 50.02 already spent on 30 Sep is inside today's balance, so it is not
  // subtracted from it a second time. Reading it as 1545.71 is what the old
  // earliest-anchor pot produced.
  assert.notEqual(plan.projectedAtPayday, 1545.71);
  assert.equal(plan.budgetDays, 23, 'divided across the days still ahead, through payday itself');
  assert.equal(plan.dayCount, 31, 'the grid spans the whole cycle, including the payday');
  assert.equal(Math.round(plan.safeDaily * 100) / 100, 65.71);
  assert.equal(Math.round(plan.safeDaily * plan.budgetDays * 100) / 100, 1511.22, 'daily x days lands on the pot');
});

test('a past bill is still shown and still steps the balance down', () => {
  // Marking a bill paid meant it vanished from the shaded past rows entirely, so
  // history showed no bills at all and the balances above them never moved.
  const args = {
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    // Due on the 18th, a Sunday, so it charges on Monday the 19th.
    bills: [{ id: 'energy', amount: 126.32, dueDay: 18, currencyCode: 'USD' }],
    commitments: []
  };
  const rowOn = (plan, date) => new Map(plan.rows.map((r) => [r.date, r])).get(date);
  const unpaid = runwayPlanner(args);
  const paid = runwayPlanner({ ...args, paidExpenses: { 'bill:energy:2026-10': true } });

  assert.equal(rowOn(unpaid, '2026-10-19').isPast, true, 'the 19th is in the past');
  assert.equal(rowOn(unpaid, '2026-10-19').bills, 126.32);
  assert.equal(rowOn(paid, '2026-10-19').bills, 126.32, 'a paid bill still belongs in history: the money left');
  assert.equal(rowOn(paid, '2026-10-19').ending, rowOn(unpaid, '2026-10-19').ending, 'the balance steps down identically');
  assert.equal(paid.rows.filter((r) => r.bills > 0).length, 1, 'the shaded row is not left empty');
  // It must not be reserved as still owed: the pot is measured from today, and the
  // charge on the 18th is behind that anchor.
  assert.equal(paid.cashAfterPlannedSpend, unpaid.cashAfterPlannedSpend, 'a past charge is not reserved again');
  assert.equal(paid.safeDaily, unpaid.safeDaily, 'nor does it shrink the budget');
  assert.equal(paid.remainingObligations, 0, 'nothing is still ahead of today');
  // A bill that is still ahead is excluded when paid, so it is not reserved twice.
  const future = runwayPlanner({
    ...args,
    bills: [{ id: 'energy', amount: 126.32, dueDay: 27, currencyCode: 'USD' }],
    paidExpenses: { 'bill:energy:2026-10': true }
  });
  assert.equal(rowOn(future, '2026-10-27').bills, 0, 'a bill due later is excluded when already paid');
  assert.equal(future.cashAfterPlannedSpend, 900, 'so it is not reserved against a settled balance');
});

test('past days carry no cumulative spend figure, only days still ahead do', () => {
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
  const rowOn = (date) => new Map(plan.rows.map((row) => [row.date, row])).get(date);
  for (const row of plan.rows.filter((r) => r.isPast)) {
    assert.equal(row.cumulativeSafeSpend, null, `${row.date} has no forward budget to accumulate`);
    assert.equal(row.daysFromToday, 0);
  }
  assert.equal(rowOn('2026-10-20').cumulativeSafeSpend, plan.safeDaily, 'today reads x1');
  assert.equal(rowOn('2026-10-21').cumulativeSafeSpend, plan.safeDaily * 2, 'tomorrow reads x2');
  assert.equal(plan.rows.at(-1).cumulativeSafeSpend, plan.safeTotal, 'the closing row is the whole pot');
  // A null renders as an em-dash rather than a zero, so a blank past cell never
  // reads as "you spent nothing".
  assert.notEqual(plan.rows[0].cumulativeSafeSpend, 0);
});

test('the remaining-obligation figure counts only what is still ahead', () => {
  // The Safe to Spend copy quotes this, so quoting the whole-cycle total made it
  // read as though already-paid bills were still reserved.
  const plan = runwayPlanner({
    balance: 900,
    currency: 'USD',
    payday: '2026-10-31',
    paydayDayOfMonth: 15,
    today: '2026-10-20',
    balanceHistory: [{ id: 'b', date: '2026-10-15', amount: 900, currencyCode: 'USD' }],
    bills: [
      { id: 'past', amount: 126.32, dueDay: 18, currencyCode: 'USD' },
      { id: 'future', amount: 200, dueDay: 27, currencyCode: 'USD' }
    ],
    commitments: [{ id: 'food', date: '2026-10-17', amount: 50, currencyCode: 'USD' }]
  });
  assert.equal(plan.obligationTotal, 376.32, 'the whole cycle, for the runway breakdown');
  assert.equal(plan.remainingObligations, 200, 'only the bill still to come');
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
