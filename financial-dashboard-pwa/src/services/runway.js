/**
 * Daily runway math — the single source of truth for cash-flow projections.
 *
 * Runway rules:
 *   - one row per day from today through payday, inclusive
 *   - safe to spend reserves all unpaid bills and Spend Items remaining in the cycle
 *   - that reserve is divided once by the inclusive day count, so the daily
 *     figure is a flat cycle budget and the cumulative column is exactly
 *     `safeDaily × dayNumber`, finishing on that reserve — it can never exceed
 *     the cash available
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

function scheduledForDate({ date, relevantBills, relevantCommitments, paidExpenses }) {
  const key = dayKey(date);
  const commitments = relevantCommitments.reduce(
    (sum, item) =>
      dayKey(item.date) === key && !isExpensePaid(item, item.date, paidExpenses, dayKey(item.date).slice(0, 7))
        ? sum + num(item.amount)
        : sum,
    0
  );
  const bills = relevantBills.reduce(
    (sum, bill) =>
      billIsDueOn(bill, date) && !isExpensePaid(bill, date, paidExpenses, billOccurrenceMonth(bill, date))
        ? sum + num(bill.amount)
        : sum,
    0
  );
  return { commitments, bills, total: commitments + bills };
}

function runwayObligations({ bills, commitments, currency, start, end, dayCount, paidExpenses = {} }) {
  const relevantBills = bills.filter((bill) => inCurrency(bill, currency) && bill.active !== false);
  const relevantCommitments = commitments.filter((item) => inCurrency(item, currency));
  const schedule = datesThrough(start, end, dayCount).map((date) => ({
    date: dayKey(date),
    ...scheduledForDate({ date, relevantBills, relevantCommitments, paidExpenses })
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
  return {
    ...totals,
    total: totals.scheduledBills + totals.scheduledCommitments,
    schedule: schedule.map((row, index) => ({ ...row, remainingTotal: remainingTotals[index] }))
  };
}

/**
 * Safe to Spend is a *budget* for the whole cycle, not a per-day recomputation.
 *
 * The pot is `cash after every unpaid bill and Spend Item still in the cycle`
 * (the "CASH AFTER BILLS & SPEND ITEMS" figure). It is divided once by the
 * inclusive `dayCount` — today through payday — giving one flat `safeDaily` that
 * every row shows. The cumulative column is then exactly `safeDaily × dayNumber`
 * (tomorrow ×2, the day after ×3), so the final row is
 * `safeDaily × dayCount` = the pot itself, by construction rather than by
 * accumulation. The column therefore can never exceed the cash available.
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
 * `dayCount` is 1 when payday is today, so the division is safe without a
 * special case: a single row reading ×1.
 */
export function safeSpendPlan({ obligationsOnlyCash, dayCount }) {
  const safeTotal = Math.max(0, num(obligationsOnlyCash));
  const days = Math.max(1, Math.trunc(num(dayCount)));
  return { safeTotal, safeDaily: safeTotal / days, dayCount: days };
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
      isRecorded: recordByDate.has(key)
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
    // included: the cycle's budget divided once by the inclusive day count.
    const safe = safeDaily;
    // Derived from the row's own position, not accumulated, so it cannot drift.
    // The `min` is a float-safety net: `x / n * n` can land a hair under `x`,
    // and the final row must read the pot exactly.
    const cumulativeSafeSpend = Math.min(safeTotal, safeDaily * dayNumber);

    return {
      date: key,
      label: runwayLabel(key),
      shortLabel: longLabel(key),
      dayNumber,
      starting,
      safe,
      safeDays: dayCount,
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

  const obligations = runwayObligations({ bills, commitments, currency, paidExpenses, ...window });
  const { safeDaily, safeTotal } = safeSpendPlan({
    obligationsOnlyCash: amount - obligations.total,
    dayCount: window.dayCount
  });
  return buildRunwayRows({
    ...window,
    amount,
    schedule: obligations.schedule,
    currency,
    maxDays,
    safeDaily,
    safeTotal,
    history: balanceHistory,
    today
  });
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
  const obligations = window
    ? runwayObligations({ bills, commitments, currency, paidExpenses, ...window })
    : { scheduledBills: 0, scheduledCommitments: 0, total: 0, schedule: [] };
  const daysUntilPayday = window?.daysUntilPayday || 0;
  const dayCount = window?.dayCount || 0;

  // The grid's opening anchor: the earliest recorded balance at or before the end
  // of the window. The earliest is chosen deliberately, because it carries the
  // furthest back and therefore fills in the most past days.
  const endKey = window ? dayKey(window.end) : '';
  const anchor = normaliseBalanceHistory(balanceHistory)
    .filter((record) => record.date <= endKey)
    .at(0) || null;

  // The budget pot is what remains from that anchor once everything still charged
  // before the end of the cycle is taken out, so the final row's cumulative
  // safe spend and its ending balance meet at the same figure. Deriving it from
  // today's balance instead would be wrong on a cycle view: today's balance has
  // already had the past charges applied to it, so subtracting the whole cycle
  // again would double-count them.
  const scheduleByDate = new Map(obligations.schedule.map((row) => [row.date, row]));
  const chargedBetween = (fromKey, toKey) => {
    let sum = 0;
    for (let day = fromKey; day < toKey; day = addDaysKey(day, 1)) {
      sum += scheduleByDate.get(day)?.total || 0;
    }
    return sum;
  };
  const endExclusive = endKey ? addDaysKey(endKey, 1) : '';
  const pot = anchor && endExclusive ? anchor.amount - chargedBetween(anchor.date, endExclusive) : null;
  const cashAfterPlannedSpend = pot === null ? Math.max(0, amount) : pot;

  // One division by the inclusive day count. `safeToday` is therefore exactly the
  // first anchored row's `safe`, which is what keeps the headline card and the
  // table from ever disagreeing.
  const { safeDaily, safeTotal } = window && pot !== null
    ? safeSpendPlan({ obligationsOnlyCash: cashAfterPlannedSpend, dayCount })
    : { safeDaily: 0, safeTotal: Math.max(0, cashAfterPlannedSpend) };
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
      history: balanceHistory,
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
    dayCount,
    daysUntilPayday,
    renderedDays: rows.length,
    truncated: dayCount > renderLimit,
    // True when no recorded balance backs the grid, so the views can say why it
    // is empty instead of showing a silently blank panel.
    awaitingHistory: Boolean(window) && !anchor,
    pastDays: rows.filter((row) => row.isPast).length,
    todayIndex: rows.findIndex((row) => row.isToday),
    recordedDays: rows.filter((row) => row.isRecorded).length,
    safeToday: safe,
    safeDaily,
    safeTotal,
    cashAfterPlannedSpend,
    shortfall: Math.max(0, -cashAfterPlannedSpend),
    // Summarised over the complete window, not the rendered rows. The old
    // implementation read the last *rendered* row, which silently reported the
    // wrong figure whenever the 45-day cap bit; the pot is computed over the whole
    // cycle and is the same value when nothing is truncated.
    projectedAtPayday: pot === null ? 0 : pot,
    firstStarting: firstAnchored ? firstAnchored.starting : null,
    scheduledBills: obligations.scheduledBills,
    scheduledCommitments: obligations.scheduledCommitments,
    obligationTotal: obligations.total
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
