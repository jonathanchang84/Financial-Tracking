/**
 * Daily runway math — the single source of truth for cash-flow projections.
 *
 * Runway rules:
 *   - one row per day from today through payday, inclusive
 *   - safe to spend reserves all unpaid bills and Spend Items remaining in the cycle
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

function safeToSpend({ obligationsOnlyCash, daysUntilPayday }) {
  const denominator = Math.max(1, Math.max(0, daysUntilPayday) - 1);
  return Math.max(0, num(obligationsOnlyCash)) / denominator;
}

function buildRunwayRows({ start, end, dayCount, amount, schedule, currency, maxDays }) {
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;
  const scheduleByDate = new Map(schedule.map((row) => [row.date, row]));
  let running = amount;
  let cumulativeSafeSpend = 0;
  const renderedDates = datesThrough(start, end, renderLimit);

  return renderedDates.map((date, index) => {
    const key = dayKey(date);
    const starting = running;
    const obligationsToday = scheduleByDate.get(key) || { commitments: 0, bills: 0, total: 0, remainingTotal: 0 };
    const obligationsOnlyCash = starting - obligationsToday.remainingTotal;
    const daysUntilPayday = Math.max(0, daysBetween(date, end));
    const safe = safeToSpend({ obligationsOnlyCash, daysUntilPayday });
    const ending = starting - obligationsToday.total;
    running = ending;
    cumulativeSafeSpend += safe;

    return {
      date: key,
      label: runwayLabel(date),
      shortLabel: longLabel(date),
      dayNumber: index + 1,
      starting,
      safe,
      safeDays: Math.max(1, daysUntilPayday - 1),
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
  return buildRunwayRows({ ...window, amount, schedule: obligations.schedule, currency, maxDays });
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
  const safe = window ? safeToSpend({ obligationsOnlyCash: cashAfterPlannedSpend, daysUntilPayday }) : 0;
  const rows = window && amount > 0
    ? buildRunwayRows({ ...window, amount, schedule: obligations.schedule, currency, maxDays })
    : [];
  const dayCount = window?.dayCount || 0;
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
