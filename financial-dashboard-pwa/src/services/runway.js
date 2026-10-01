/**
 * Daily runway math — the single source of truth for cash-flow projections.
 *
 * Runway rules:
 *   - one row per day across the pay cycle that contains today, inclusive
 *   - safe to spend reserves every bill and Spend Item due today or later
 *   - that reserve is divided once by the *remaining* day count — today through
 *     payday — so the daily figure is a budget for the days still spendable, and
 *     the cumulative column is exactly `safeDaily × daysFromToday`, finishing on
 *     that reserve, so it can never exceed the cash available
 *   - a day that is today or already gone is committed: its charges always apply,
 *     so the shaded rows show the bills that really left the account, today's row
 *     shows what is committed today, and the balances above them step down. Only
 *     occurrences strictly *ahead* of today are dropped by a paid marker, so what
 *     the day costs never depends on whether it has been ticked off
 *   - safe to spend is hypothetical and never reduces Starting or Ending
 *   - Ending changes only for actual Spend Items and bills on that day
 *   - Saturday / Sunday bill due dates shift forward to Monday
 *
 * Every function here is pure so it can be unit-tested under `node --test`
 * without a browser (see `tests/runway.test.js`).
 */

import {
  startOfDay,
  addDaysKey,
  dayKey,
  daysBetween,
  daysBetweenInclusive,
  datesThrough,
  dueDateForBill,
  isValidDate,
  longLabel,
  runwayLabel
} from './dates.js';
import { isExpensePaid } from './paymentState.js';
import { normaliseBalanceHistory } from './balanceHistory.js';
import { payCycle } from './income.js';

/** Historic cap on the rendered grid (the Apple app uses the same guard). */
export const MAX_RUNWAY_DAYS = 45;

export function parseNonNegativeNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function num(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Records store currency as either `currencyCode` (newer) or `currency` (legacy). */
export function currencyOf(row, fallback = 'USD') {
  return row?.currencyCode || row?.currency || fallback;
}

export function inCurrency(row, currency) {
  return currencyOf(row) === currency;
}

export function seriesNameOf(row) {
  return String(row?.series || row?.name || row?.symbol || 'Item').trim() || 'Item';
}

/**
 * The inclusive local-date window the grid covers, or null when invalid.
 *
 * With a `paydayDayOfMonth` the window is the whole pay cycle that contains
 * today: the payday that opened it through the day before the next one. That is
 * what makes past days part of the view rather than something to scroll past.
 *
 * Without one — a legacy single payday date, or no payday at all — it falls back
 * to today through payday, which is the behaviour that existed before the cycle
 * view. The fallback matters because a bare date carries no cadence, and
 * inventing a payday rule from it would show a cycle the user never set.
 *
 * `daysUntilPayday` always counts to the real next payday, so the headline
 * figure stays "days until you get paid" even though the grid now ends the day
 * before it.
 */
function runwayWindow(today, payday, paydayDayOfMonth = null) {
  if (!isValidDate(today)) return null;
  const cycle = payCycle(paydayDayOfMonth, today);
  if (cycle) {
    return {
      start: cycle.start,
      end: cycle.end,
      dayCount: cycle.dayCount,
      daysUntilPayday: isValidDate(payday) ? Math.max(0, daysBetween(today, payday)) : cycle.dayCount,
      isCycle: true
    };
  }
  if (!isValidDate(payday)) return null;
  const start = startOfDay(today);
  const end = startOfDay(payday);
  if (end < start) return null;
  return { start, end, dayCount: daysBetweenInclusive(start, end), daysUntilPayday: daysBetween(start, end), isCycle: false };
}

/** A weekend shift can move a bill into the following month; check both months. */
function billIsDueOn(bill, date) {
  const key = dayKey(date);
  if (dayKey(dueDateForBill(bill, date)) === key) return true;
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return dayKey(dueDateForBill(bill, previousMonth)) === key;
}

function billOccurrenceMonth(bill, date) {
  if (dayKey(dueDateForBill(bill, date)) === dayKey(date)) return dayKey(date).slice(0, 7);
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return dayKey(previousMonth).slice(0, 7);
}

/**
 * What is charged on one day of the window.
 *
 * `todayKey` splits the two cases that were previously collapsed into one. A day
 * that is today or already gone is *committed*: the charge belongs to that day
 * whether or not the bill was ever ticked off, so the shaded rows keep the bills
 * that really went out and today's row shows what is committed today. Only
 * occurrences strictly *ahead* of today are the ones still being reserved, so a
 * paid marker drops them there and only there.
 *
 * Applying `isExpensePaid` to past days was what emptied the shaded rows: a bill
 * marked paid vanished from history, and because `ending` is built from the
 * charges on the day, the balances above it never stepped down either. The
 * grid then contradicted the same bill still being listed in the month view.
 *
 * Leaving today inside the paid-marker case was the same mistake one day later:
 * the day's own row reported `£0` for two bills that are plainly still committed
 * today, which quietly inflated Safe to spend by the amount that went missing.
 * "Paid" is a note that the money has moved, not proof of the day it moved on,
 * so it decides which *future* occurrences to stop reserving — never whether a
 * day that has already arrived costs what it costs.
 */
function scheduledForDate({ date, relevantBills, relevantCommitments, paidExpenses, todayKey = '' }) {
  const key = dayKey(date);
  // Committed on or before today. Strictly-future days are the only ones a paid
  // marker is allowed to clear.
  const isCommitted = Boolean(todayKey) && key <= todayKey;
  const commitments = relevantCommitments.reduce(
    (sum, item) =>
      dayKey(item.date) === key && (isCommitted || !isExpensePaid(item, item.date, paidExpenses, dayKey(item.date).slice(0, 7)))
        ? sum + num(item.amount)
        : sum,
    0
  );
  const bills = relevantBills.reduce(
    (sum, bill) =>
      billIsDueOn(bill, date) && (isCommitted || !isExpensePaid(bill, date, paidExpenses, billOccurrenceMonth(bill, date)))
        ? sum + num(bill.amount)
        : sum,
    0
  );
  return { commitments, bills, total: commitments + bills };
}

function runwayObligations({ bills, commitments, currency, start, end, dayCount, paidExpenses = {}, todayKey = '' }) {
  const relevantBills = bills.filter((bill) => inCurrency(bill, currency) && bill.active !== false);
  const relevantCommitments = commitments.filter((item) => inCurrency(item, currency));
  const schedule = datesThrough(start, end, dayCount).map((date) => ({
    date: dayKey(date),
    ...scheduledForDate({ date, relevantBills, relevantCommitments, paidExpenses, todayKey })
  }));
  const totals = schedule.reduce(
    (result, row) => ({
      scheduledBills: result.scheduledBills + row.bills,
      scheduledCommitments: result.scheduledCommitments + row.commitments
    }),
    { scheduledBills: 0, scheduledCommitments: 0 }
  );
  const remainingTotals = [];
  let remainingTotal = 0;
  for (let index = schedule.length - 1; index >= 0; index -= 1) {
    remainingTotal += schedule[index].total;
    remainingTotals[index] = remainingTotal;
  }
  // The reserve that is still ahead of today. The cycle-wide `total` stays
  // untouched because the "where the runway goes" panel is about the whole cycle,
  // but the Safe to Spend copy must quote the money that is actually still owed —
  // quoting a figure that includes charges already paid reads as if they were
  // still ahead, and made the two panels contradict each other.
  const remainingFromToday = todayKey
    ? schedule.reduce((sum, row) => (row.date >= todayKey ? sum + row.total : sum), 0)
    : remainingTotals[remainingTotals.length - 1] || 0;
  return {
    ...totals,
    total: totals.scheduledBills + totals.scheduledCommitments,
    remainingTotal: remainingFromToday,
    schedule: schedule.map((row, index) => ({ ...row, remainingTotal: remainingTotals[index] }))
  };
}

/**
 * The history the grid runs on, with an implicit record for today when needed.
 *
 * `settings.balance` is a real, current figure that carries no date, and a user who
 * has never opened the backfill form has no dated record at all. Without an anchor
 * on today the entire grid returned no rows and the screen reported
 * `awaitingHistory` — for a user who plainly had a balance. So when nothing is
 * recorded for today, the scalar balance is adopted as today's record.
 *
 * The record is flagged `implicit` so the table can anchor the row and step the
 * running balance from it without badging it "Balance recorded": the user never
 * entered a dated figure, and claiming they did would be a small lie in the one
 * column whose whole job is telling a measured figure from a carried one. Days
 * *before* today are deliberately left alone — an undated balance says nothing
 * about last Tuesday, so those rows stay blank.
 */
function anchoredHistory(balanceHistory, { todayIso, balance, currency, endKey }) {
  const records = normaliseBalanceHistory(balanceHistory).filter((record) => !endKey || record.date <= endKey);
  if (records.some((record) => record.date === todayIso)) return records;
  const amount = num(balance);
  if (!(amount > 0)) return records;
  return [...records, { id: `balance-${todayIso}`, date: todayIso, amount, currencyCode: currency, implicit: true }];
}

/**
 * Safe to Spend is a *budget for the days still ahead*, not a whole-cycle average.
 *
 * The pot is `cash after every bill and Spend Item still to come` (the "CASH AFTER
 * BILLS & SPEND ITEMS" figure). It is divided once by `days` — today through payday
 * inclusive — giving one flat `safeDaily` that every row shows. The cumulative
 * column is then exactly `safeDaily × daysFromToday` (tomorrow ×2, the day after
 * ×3), so the final row is `safeDaily × days` = the pot itself, by construction
 * rather than by accumulation, and the column can never exceed the cash available.
 *
 * The divisor is the *remaining* days, not the cycle length. The grid spans the
 * whole pay cycle, so dividing by the full cycle spread the budget across days
 * that had already gone: the daily figure silently shrank the longer the cycle ran
 * on, and the days a user could actually still spend on got a fraction of the money
 * available. Because the pot is measured from today's anchor and the divisor counts
 * the same span, `projectedAtPayday` and the table's closing `ending` are the same
 * figure by construction and cannot drift apart.
 *
 * The two defects this replaces, which were the same bug seen from two sides:
 *   - dividing the pot by `daysUntilPayday - 1` inflated the daily figure, and
 *     the clamped denominator let both the day before payday *and* payday itself
 *     claim the entire balance
 *   - dividing the pot again by each row's shrinking day count meant every row
 *     was computed as though it were the first day. The numerator stayed pinned
 *     at the full balance (safe spend is hypothetical, so it is never deducted)
 *     while the divisor fell to 1, so the last rows each advised spending the
 *     whole balance. Summing those independent hypotheticals counted the same
 *     money once per day and the cumulative ran several times over the real
 *     figure
 *
 * `days` is 1 when payday is today, so the division is safe without a
 * special case: a single row reading ×1.
 */
export function safeSpendPlan({ obligationsOnlyCash, days = 0, dayCount = null }) {
  const safeTotal = Math.max(0, num(obligationsOnlyCash));
  // `dayCount` is the old positional name for the same argument and is still
  // accepted so existing callers and tests describe the divisor honestly.
  const divisor = dayCount === null ? days : dayCount;
  const divisorDays = Math.max(1, Math.trunc(num(divisor)));
  return { safeTotal, safeDaily: safeTotal / divisorDays, days: divisorDays, dayCount: divisorDays };
}

/**
 * One row per day across the pay cycle, anchored on recorded balance history.
 *
 * The cycle is anchored on the payday rule (`start` to `end`), not on "today",
 * so the grid shows the whole cycle: days already gone as well as days to come.
 *
 * Each day's starting balance comes from the nearest recorded balance on or
 * before that day, then steps forward by the bills and Spend Items charged since.
 * A day with no record behind it reports `starting: null` rather than an invented
 * figure, because a plausible-looking wrong number is far harder to notice than
 * a blank. `anchored` says which case a row is, so the table can render the
 * difference instead of guessing.
 *
 * The rows are split into three groups the views need to tell apart:
 *   - `isPast`   strictly before today, so it can be greyed
 *   - `isToday`  today, marked rather than greyed
 *   - neither, so it is upcoming
 * `isRecorded` marks a day the balance was actually updated on, which is the
 * difference between a measured figure and one flowed forward from an earlier
 * record.
 */
function buildRunwayRows({
  start,
  end,
  dayCount,
  amount,
  schedule,
  currency,
  maxDays,
  safeDaily = 0,
  safeTotal = 0,
  safeDays = null,
  history = [],
  today = new Date()
}) {
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;
  const scheduleByDate = new Map(schedule.map((row) => [row.date, row]));
  const renderedDates = datesThrough(start, end, renderLimit);
  const todayIso = dayKey(today);
  const records = normaliseBalanceHistory(history);
  // Index the records by date so the anchor lookup is a single map read per row
  // rather than a scan of the whole history.
  const recordByDate = new Map(records.map((record) => [record.date, record]));

  // Anchor the whole grid in one pass. `carry` is the last record seen at or
  // before the current day, so it persists across days with no record of their
  // own, and `running` is that anchor carried forward through everything already
  // charged since. Days before the first record have no anchor and stay null.
  const prepared = [];
  let carry = null;
  let running = null;
  for (const [index, date] of renderedDates.entries()) {
    const key = dayKey(date);
    if (recordByDate.has(key)) {
      carry = recordByDate.get(key);
      running = carry.amount;
    }
    prepared.push({
      key,
      index,
      anchor: carry,
      running: running === null ? null : Math.round(running * 1e6) / 1e6,
      isPast: key < todayIso,
      isToday: key === todayIso,
      // An implicit record adopts the undated balance to anchor the grid, but the
      // user never entered a dated figure for the day, so it is not badged as one.
      isRecorded: Boolean(recordByDate.get(key)) && recordByDate.get(key).implicit !== true
    });
    if (running !== null) {
      const step = scheduleByDate.get(key);
      if (step) running -= step.total;
    }
  }

  return prepared.map((row) => {
    const { key, index, anchor, isPast, isToday, isRecorded } = row;
    const obligationsToday = scheduleByDate.get(key) || { commitments: 0, bills: 0, total: 0, remainingTotal: 0 };

    const dayNumber = index + 1;
    const starting = row.running;
    const ending = starting === null ? null : starting - obligationsToday.total;
    const obligationsOnlyCash = starting === null ? null : starting - obligationsToday.remainingTotal;
    // Every anchored row carries the same daily allowance, the closing day
    // included: the remaining-cycle budget divided once by the remaining day count.
    const safe = safeDaily;
    // Counted from today, not from the top of the cycle. `dayNumber` is the day
    // within the pay cycle, so on a cycle that opened six days ago it would start
    // the cumulative at ×7 and finish at ×28 — overrunning the pot and showing a
    // spend target for days that are already gone. Days before today have no
    // place in a forward budget at all, so they read as an em-dash instead of a
    // number the user could act on.
    const daysFromToday = key < todayIso ? 0 : daysBetween(todayIso, key) + 1;
    // Derived from the row's own position, not accumulated, so it cannot drift.
    // The `min` is a float-safety net: `x / n * n` can land a hair under `x`,
    // and the final row must read the pot exactly.
    const cumulativeSafeSpend = daysFromToday > 0 ? Math.min(safeTotal, safeDaily * daysFromToday) : null;

    return {
      date: key,
      label: runwayLabel(key),
      shortLabel: longLabel(key),
      dayNumber,
      daysFromToday,
      starting,
      safe,
      safeDays: safeDays ?? dayCount,
      safeTotal,
      obligationsOnlyCash,
      commitments: obligationsToday.commitments,
      cumulativeSafeSpend,
      bills: obligationsToday.bills,
      ending,
      currency,
      anchored: starting !== null,
      anchorDate: anchor ? anchor.date : '',
      isPast,
      isToday,
      isRecorded
    };
  });
}

/**
 * Build the daily runway grid for one currency. The 45-day cap applies to
 * rendered rows only; summary calculations use the complete payday window.
 */
export function buildDailyRunway({
  balance,
  currency = 'USD',
  payday,
  paydayDayOfMonth = null,
  balanceHistory = [],
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  paidExpenses = {},
  today = new Date()
}) {
  const amount = num(balance);
  const window = runwayWindow(today, payday, paydayDayOfMonth);
  if (!(amount > 0) || !window) return [];

  const todayIso = dayKey(today);
  const endKey = dayKey(window.end);
  const history = anchoredHistory(balanceHistory, { todayIso, balance: amount, currency, endKey });
  const obligations = runwayObligations({ bills, commitments, currency, paidExpenses, todayKey: todayIso, ...window });
  // One shared budget path, so this entry point and `runwayPlanner` cannot drift
  // into reporting different daily figures for the same inputs.
  const budget = runwayBudget({ history, amount, schedule: obligations.schedule, todayIso, endKey });
  return buildRunwayRows({
    ...window,
    amount,
    schedule: obligations.schedule,
    currency,
    maxDays,
    safeDaily: budget.safeDaily,
    safeTotal: budget.safeTotal,
    safeDays: budget.days,
    history,
    today
  });
}

/**
 * Bills and Spend Items this grid can never count, and why.
 *
 * Anything merely falling due after the window is not reported: a monthly bill's next
 * occurrence always lands beyond payday, and that is correct scoping rather than a
 * gap — it is captured in the next cycle, and you are paid before it falls due.
 *
 * What genuinely vanishes is anything in another currency. It is filtered out of the
 * balance-currency runway and never appears in any cycle, so "Scheduled bills" can
 * read as complete while omitting it entirely. Saying so is the difference between a
 * complete figure and a quietly partial one.
 */
function runwayExcluded({ bills, commitments, currency }) {
  const foreignBills = bills.filter((bill) => bill.active !== false && !inCurrency(bill, currency));
  const foreignCommitments = commitments.filter((item) => !inCurrency(item, currency));
  return {
    billsInOtherCurrencies: foreignBills.length,
    billsInOtherCurrenciesAmount: foreignBills.reduce((sum, bill) => sum + num(bill.amount), 0),
    commitmentsInOtherCurrencies: foreignCommitments.length,
    commitmentsInOtherCurrenciesAmount: foreignCommitments.reduce((sum, item) => sum + num(item.amount), 0),
    // Only worth surfacing when something is actually missing.
    hasExcluded: foreignBills.length > 0 || foreignCommitments.length > 0
  };
}

/**
 * The one place the Safe to Spend budget is derived.
 *
 * `pot` is measured from today's anchor: the balance on or before today, minus every
 * charge from that anchor through the end of the window. Measuring it from the
 * *earliest* record in the cycle (which is what filled in the most past days) is
 * wrong for a budget, because the charges between that record and today have already
 * been applied to the balance actually held today — subtracting them again charged
 * for the same money twice, and produced a headline that disagreed with the table's
 * own closing row.
 *
 * `days` counts today through the end of the window inclusive, so `safeDaily × days`
 * is exactly `pot` on the closing row. Both the headline and the final grid row read
 * from these same values, which is what makes the two impossible to disagree.
 */
function runwayBudget({ history, amount, schedule, todayIso, endKey }) {
  const scheduleByDate = new Map(schedule.map((row) => [row.date, row]));
  const endExclusive = endKey ? addDaysKey(endKey, 1) : '';
  const anchor = normaliseBalanceHistory(history).filter((record) => !todayIso || record.date <= todayIso).at(-1) || null;
  const chargedBetween = (fromKey, toKey) => {
    let sum = 0;
    for (let day = fromKey; day < toKey; day = addDaysKey(day, 1)) {
      sum += scheduleByDate.get(day)?.total || 0;
    }
    return sum;
  };
  const pot = anchor && endExclusive ? anchor.amount - chargedBetween(anchor.date, endExclusive) : null;
  // The days a user can still spend on. `anchorDate` is normally today, so this is
  // today through the end of the cycle; it is computed from the anchor rather than
  // from today so the two can never describe different spans.
  const from = anchor ? anchor.date : todayIso;
  const days = from && endKey ? Math.max(1, daysBetweenInclusive(from, endKey)) : 1;
  const { safeDaily, safeTotal } = safeSpendPlan({ obligationsOnlyCash: pot === null ? amount : pot, days });
  return { anchor, pot, days, safeDaily, safeTotal };
}

/** Build the grid and full-cycle summary figures used by the screens. */
export function runwayPlanner({
  balance,
  currency = 'USD',
  payday,
  paydayDayOfMonth = null,
  balanceHistory = [],
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  paidExpenses = {},
  today = new Date()
}) {
  const amount = num(balance);
  const hasPayday = isValidDate(payday);
  const window = runwayWindow(today, payday, paydayDayOfMonth);
  const paydayPast = hasPayday && startOfDay(payday) < startOfDay(today);
  const todayIso = dayKey(today);
  const endKey = window ? dayKey(window.end) : '';
  // The grid's opening anchor, plus today's record when the balance has never been
  // dated. Without that implicit record a user with a perfectly good balance saw an
  // empty grid and a prompt to record one they had already entered.
  const history = anchoredHistory(balanceHistory, { todayIso, balance: amount, currency, endKey });
  const obligations = window
    ? runwayObligations({ bills, commitments, currency, paidExpenses, todayKey: todayIso, ...window })
    : { scheduledBills: 0, scheduledCommitments: 0, total: 0, remainingTotal: 0, schedule: [] };
  const daysUntilPayday = window?.daysUntilPayday || 0;
  const dayCount = window?.dayCount || 0;

  // One budget, derived once and read by both the headline cards and the grid, so
  // the two can never report different figures for the same inputs.
  const budget = window
    ? runwayBudget({ history, amount, schedule: obligations.schedule, todayIso, endKey })
    : { anchor: null, pot: null, days: 1, safeDaily: 0, safeTotal: Math.max(0, amount) };
  const { anchor, pot, safeDaily, safeTotal } = budget;
  const cashAfterPlannedSpend = pot === null ? Math.max(0, amount) : pot;
  const safe = safeDaily;
  const rows = window && anchor
    ? buildRunwayRows({
      ...window,
      amount,
      schedule: obligations.schedule,
      currency,
      maxDays,
      safeDaily,
      safeTotal,
      safeDays: budget.days,
      history,
      today
    })
    : [];
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;
  const firstAnchored = rows.find((row) => row.anchored) || null;

  return {
    rows,
    balance: amount,
    currency,
    payday: hasPayday ? dayKey(payday) : '',
    paydayPast,
    // A cycle view deliberately spans days already gone, so the old "payday has
    // passed, choose a future day" reading no longer applies when a payday rule
    // is set: a payday in the past is what opens the current cycle.
    isCycle: Boolean(window?.isCycle),
    cycleStart: window ? dayKey(window.start) : '',
    cycleEnd: window ? dayKey(window.end) : '',
    anchorDate: anchor ? anchor.date : '',
    // The day the budget is measured from, which is the day the daily figure covers
    // forward. Distinct from `anchorDate` only in the rare case where a record exists
    // after today, which the grid still badges but the budget does not measure from.
    budgetFromDate: anchor ? anchor.date : '',
    budgetDays: budget.days,
    dayCount,
    daysUntilPayday,
    renderedDays: rows.length,
    truncated: dayCount > renderLimit,
    // True when there is a window but nothing to measure the runway from at all —
    // a payday rule with no balance. A dated record is no longer required, because an
    // undated balance is adopted as today's, so this now means "no balance", not
    // "no history".
    awaitingHistory: Boolean(window) && !anchor,
    pastDays: rows.filter((row) => row.isPast).length,
    todayIndex: rows.findIndex((row) => row.isToday),
    recordedDays: rows.filter((row) => row.isRecorded).length,
    safeToday: safe,
    safeDaily,
    safeTotal,
    cashAfterPlannedSpend,
    shortfall: Math.max(0, -cashAfterPlannedSpend),
    // The closing row's own `ending` and this headline are now the same number by
    // construction: both come from `pot`, which is measured from the same anchor and
    // walked with the same schedule. Previously the headline subtracted the whole
    // cycle from the earliest record while the grid re-anchored on later ones, so the
    // two silently disagreed by exactly the charges between those records.
    projectedAtPayday: pot === null ? 0 : pot,
    firstStarting: firstAnchored ? firstAnchored.starting : null,
    scheduledBills: obligations.scheduledBills,
    scheduledCommitments: obligations.scheduledCommitments,
    obligationTotal: obligations.total,
    // Only what is still ahead of today, so the Safe to Spend copy does not quote
    // charges that have already been paid as if they were still reserved.
    remainingObligations: obligations.remainingTotal,
    // What this grid deliberately does not count, so a view can say so rather than
    // presenting an incomplete total as if it were complete.
    excluded: runwayExcluded({ bills, commitments, currency })
  };
}

/**
 * Month-on-month change between the last two dated points.
 * @returns {number|null} percentage change, or `null` when it cannot be computed.
 */
export function growthPercent(points = []) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const previous = num(points[points.length - 2]?.value);
  const latest = num(points[points.length - 1]?.value);
  if (!previous) return null;
  return ((latest - previous) / Math.abs(previous)) * 100;
}

/** Historic wording so existing copy stays familiar. */
export function monthGrowth(points = []) {
  const percent = growthPercent(points);
  if (percent === null) return 'Not enough data for month-on-month growth';
  return `Latest change: ${percent >= 0 ? '+' : ''}${percent.toFixed(2)}% month-on-month`;
}

/** Latest record per series name (historic `snapshotSeries` grouping). */
export function latestBySeries(history = [], currency = null) {
  const map = new Map();
  [...history]
    .filter((row) => (currency ? currencyOf(row) === currency : true))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((row) => map.set(seriesNameOf(row), row));
  return Array.from(map.values());
}
