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

/** Return the inclusive local-date window for a runway, or null when invalid/past. */
function runwayWindow(today, payday) {
  if (!isValidDate(today) || !isValidDate(payday)) return null;
  const start = startOfDay(today);
  const end = startOfDay(payday);
  if (end < start) return null;
  return { start, end, dayCount: daysBetweenInclusive(start, end), daysUntilPayday: daysBetween(start, end) };
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

function buildRunwayRows({ start, end, dayCount, amount, schedule, currency, maxDays, safeDaily = 0, safeTotal = 0 }) {
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;
  const scheduleByDate = new Map(schedule.map((row) => [row.date, row]));
  let running = amount;
  const renderedDates = datesThrough(start, end, renderLimit);

  return renderedDates.map((date, index) => {
    const key = dayKey(date);
    const starting = running;
    const obligationsToday = scheduleByDate.get(key) || { commitments: 0, bills: 0, total: 0, remainingTotal: 0 };
    const obligationsOnlyCash = starting - obligationsToday.remainingTotal;
    const daysUntilPayday = Math.max(0, daysBetween(date, end));
    const dayNumber = index + 1;
    // Every row carries the same daily allowance, payday included: it is the
    // cycle's budget divided once by the inclusive day count.
    const safe = safeDaily;
    const ending = starting - obligationsToday.total;
    running = ending;
    // Derived from the row's own position, not accumulated, so it cannot drift.
    // The `min` is a float-safety net: `x / n * n` can land a hair under `x`,
    // and the final row must read the pot exactly.
    const cumulativeSafeSpend = Math.min(safeTotal, safeDaily * dayNumber);

    return {
      date: key,
      label: runwayLabel(date),
      shortLabel: longLabel(date),
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
      currency
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
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  paidExpenses = {},
  today = new Date()
}) {
  const amount = num(balance);
  const window = runwayWindow(today, payday);
  if (!(amount > 0) || !window) return [];

  const obligations = runwayObligations({ bills, commitments, currency, paidExpenses, ...window });
  const { safeDaily, safeTotal } = safeSpendPlan({
    obligationsOnlyCash: amount - obligations.total,
    dayCount: window.dayCount
  });
  return buildRunwayRows({ ...window, amount, schedule: obligations.schedule, currency, maxDays, safeDaily, safeTotal });
}

/** Build the grid and full-cycle summary figures used by the screens. */
export function runwayPlanner({
  balance,
  currency = 'USD',
  payday,
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  paidExpenses = {},
  today = new Date()
}) {
  const amount = num(balance);
  const hasPayday = isValidDate(payday);
  const window = runwayWindow(today, payday);
  const paydayPast = hasPayday && startOfDay(payday) < startOfDay(today);
  const obligations = window
    ? runwayObligations({ bills, commitments, currency, paidExpenses, ...window })
    : { scheduledBills: 0, scheduledCommitments: 0, total: 0, schedule: [] };
  const cashAfterPlannedSpend = window ? amount - obligations.total : amount;
  const daysUntilPayday = window?.daysUntilPayday || 0;
  const dayCount = window?.dayCount || 0;
  // One division by the inclusive day count. `safeToday` is therefore exactly the
  // first row's `safe`, which is what keeps the headline card and the table from
  // ever disagreeing.
  const { safeDaily, safeTotal } = window
    ? safeSpendPlan({ obligationsOnlyCash: cashAfterPlannedSpend, dayCount })
    : { safeDaily: 0, safeTotal: Math.max(0, cashAfterPlannedSpend) };
  const safe = safeDaily;
  const rows = window && amount > 0
    ? buildRunwayRows({ ...window, amount, schedule: obligations.schedule, currency, maxDays, safeDaily, safeTotal })
    : [];
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;

  return {
    rows,
    balance: amount,
    currency,
    payday: hasPayday ? dayKey(payday) : '',
    paydayPast,
    dayCount,
    daysUntilPayday,
    renderedDays: rows.length,
    truncated: dayCount > renderLimit,
    safeToday: safe,
    safeDaily,
    safeTotal,
    cashAfterPlannedSpend,
    shortfall: Math.max(0, -cashAfterPlannedSpend),
    projectedAtPayday: window ? amount - obligations.total : 0,
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
