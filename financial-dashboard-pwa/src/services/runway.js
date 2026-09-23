/**
 * Daily runway math — the single source of truth for cash-flow projections.
 *
 * Ported from the historic `pwa/app.js` `renderCashflow()`:
 *   - one row per day from today through payday, inclusive
 *   - safeToday = saved balance / inclusive day count
 *   - ending = starting - safeToday - commitments(today) - scheduled bills(today)
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
  longLabel,
  runwayLabel
} from './dates.js';

/** Historic cap on the rendered grid (the Apple app uses the same guard). */
export const MAX_RUNWAY_DAYS = 45;

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
 * Build the daily runway grid for one currency.
 *
 * @returns {Array<{
 *   date: string, label: string, dayNumber: number, starting: number,
 *   safe: number, commitments: number, cumulative: number, bills: number,
 *   ending: number, currency: string
 * }>} one row per day, or `[]` when a balance/payday is missing or in the past.
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
  const end = startOfDay(payday);
  if (!(amount > 0) || !payday || Number.isNaN(end.getTime())) return [];

  const start = startOfDay(today);
  if (end < start) return [];

  // The safe amount always spreads across the full pay cycle, even when the
  // rendered grid is truncated by maxDays (historic behaviour).
  const dayCount = daysBetweenInclusive(start, end);
  const safe = amount / dayCount;

  const relevantBills = bills.filter((bill) => inCurrency(bill, currency));
  const relevantCommitments = commitments.filter((item) => inCurrency(item, currency));

  let running = amount;
  let cumulative = 0;

  return datesThrough(start, end, maxDays).map((date, index) => {
    const key = dayKey(date);
    const starting = running;

    const commitmentsToday = relevantCommitments.reduce(
      (sum, item) => (dayKey(item.date) === key ? sum + num(item.amount) : sum),
      0
    );

    const billsToday = relevantBills.reduce((sum, bill) => {
      const due = dueDateForBill(bill, date);
      return dayKey(due) === key ? sum + num(bill.amount) : sum;
    }, 0);

    cumulative += commitmentsToday;
    const ending = starting - safe - commitmentsToday - billsToday;
    running = ending;

    return {
      date: key,
      label: runwayLabel(date),
      shortLabel: longLabel(date),
      dayNumber: index + 1,
      starting,
      safe,
      commitments: commitmentsToday,
      cumulative,
      bills: billsToday,
      ending,
      currency
    };
  });
}

/**
 * Convenience wrapper for the screens: builds the grid once and derives the
 * summary figures the historic UI showed next to it.
 */
export function runwayPlanner({
  balance,
  currency = 'USD',
  payday,
  bills = [],
  commitments = [],
  maxDays = MAX_RUNWAY_DAYS,
  today = new Date()
}) {
  const rows = buildDailyRunway({ balance, currency, payday, bills, commitments, maxDays, today });
  const amount = num(balance);
  const hasPayday = Boolean(payday) && !Number.isNaN(startOfDay(payday).getTime());
  const dayCount = hasPayday ? daysBetweenInclusive(startOfDay(today), startOfDay(payday)) : 0;
  const truncated = dayCount > maxDays;

  return {
    rows,
    balance: amount,
    currency,
    payday: payday ? dayKey(payday) : '',
    dayCount,
    renderedDays: rows.length,
    truncated,
    safeToday: rows.length ? rows[0].safe : dayCount > 0 ? amount / dayCount : 0,
    projectedAtPayday: rows.length ? rows[rows.length - 1].ending : 0,
    scheduledBills: rows.reduce((sum, row) => sum + row.bills, 0),
    scheduledCommitments: rows.reduce((sum, row) => sum + row.commitments, 0)
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
