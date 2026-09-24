/**
 * Daily runway math — the single source of truth for cash-flow projections.
 *
 * Ported from the historic `pwa/app.js` `renderCashflow()`:
 *   - one row per day from today through payday, inclusive
 *   - safeToday = max(0, balance - full-cycle obligations) / inclusive day count
 *   - ending = starting - safeToday - Spend Items(today) - scheduled bills(today)
 *   - Saturday / Sunday bill due dates shift forward to Monday
 *
 * Every function here is pure so it can be unit-tested under `node --test`
 * without a browser (see `tests/runway.test.js`).
 */

import {
  startOfDay,
  dayKey,
  daysBetweenInclusive,
  datesThrough,
  dueDateForBill,
  isValidDate,
  longLabel,
  runwayLabel
} from './dates.js';

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
  return { start, end, dayCount: daysBetweenInclusive(start, end) };
}

/** A weekend shift can move a bill into the following month; check both months. */
function billIsDueOn(bill, date) {
  const key = dayKey(date);
  if (dayKey(dueDateForBill(bill, date)) === key) return true;
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  return dayKey(dueDateForBill(bill, previousMonth)) === key;
}

function obligationTotals({ bills, commitments, currency, start, end, dayCount }) {
  const relevantBills = bills.filter((bill) => inCurrency(bill, currency) && bill.active !== false);
  const relevantCommitments = commitments.filter((item) => inCurrency(item, currency));
  let scheduledBills = 0;
  let scheduledCommitments = 0;

  datesThrough(start, end, dayCount).forEach((date) => {
    const key = dayKey(date);
    relevantBills.forEach((bill) => {
      if (billIsDueOn(bill, date)) scheduledBills += num(bill.amount);
    });
    relevantCommitments.forEach((item) => {
      if (dayKey(item.date) === key) scheduledCommitments += num(item.amount);
    });
  });

  return { scheduledBills, scheduledCommitments, total: scheduledBills + scheduledCommitments };
}

function buildRunwayRows({ start, end, dayCount, amount, safe, bills, commitments, currency, maxDays }) {
  const relevantBills = bills.filter((bill) => inCurrency(bill, currency) && bill.active !== false);
  const relevantCommitments = commitments.filter((item) => inCurrency(item, currency));
  const renderLimit = Number.isFinite(Number(maxDays)) ? Math.max(0, Math.trunc(Number(maxDays))) : MAX_RUNWAY_DAYS;
  let running = amount;
  let cumulative = 0;

  return datesThrough(start, end, renderLimit).map((date, index) => {
    const key = dayKey(date);
    const starting = running;
    const spendItemsToday = relevantCommitments.reduce(
      (sum, item) => (dayKey(item.date) === key ? sum + num(item.amount) : sum),
      0
    );
    const billsToday = relevantBills.reduce(
      (sum, bill) => (billIsDueOn(bill, date) ? sum + num(bill.amount) : sum),
      0
    );

    cumulative += spendItemsToday;
    const ending = starting - safe - spendItemsToday - billsToday;
    running = ending;

    return {
      date: key,
      label: runwayLabel(date),
      shortLabel: longLabel(date),
      dayNumber: index + 1,
      starting,
      safe,
      commitments: spendItemsToday,
      cumulative,
      bills: billsToday,
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
  today = new Date()
}) {
  const amount = num(balance);
  const window = runwayWindow(today, payday);
  if (!(amount > 0) || !window) return [];

  const obligations = obligationTotals({ bills, commitments, currency, ...window });
  const cashAfterPlannedSpend = amount - obligations.total;
  const safe = Math.max(0, cashAfterPlannedSpend) / window.dayCount;
  return buildRunwayRows({ ...window, amount, safe, bills, commitments, currency, maxDays });
}

/** Build the grid and full-cycle summary figures used by the screens. */
export function runwayPlanner({
  balance,
  currency = 'USD',
  payday,
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  today = new Date()
}) {
  const amount = num(balance);
  const hasPayday = isValidDate(payday);
  const window = runwayWindow(today, payday);
  const paydayPast = hasPayday && startOfDay(payday) < startOfDay(today);
  const obligations = window
    ? obligationTotals({ bills, commitments, currency, ...window })
    : { scheduledBills: 0, scheduledCommitments: 0, total: 0 };
  const cashAfterPlannedSpend = window ? amount - obligations.total : amount;
  const safe = window ? Math.max(0, cashAfterPlannedSpend) / window.dayCount : 0;
  const rows = window && amount > 0
    ? buildRunwayRows({ ...window, amount, safe, bills, commitments, currency, maxDays })
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
    renderedDays: rows.length,
    truncated: dayCount > renderLimit,
    safeToday: safe,
    cashAfterPlannedSpend,
    shortfall: Math.max(0, -cashAfterPlannedSpend),
    projectedAtPayday: window ? amount - safe * dayCount - obligations.total : 0,
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
