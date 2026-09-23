/**
 * Pure date helpers shared by the runway, cash-flow, budget and SCD Type 2 layers.
 *
 * Date-only strings (`YYYY-MM-DD`, the format IndexedDB and Postgres `date`
 * columns use) are parsed as *local* midnight. `new Date('2026-03-10')` parses
 * as UTC and silently shifts a day in negative UTC offsets, which would move
 * weekend-shifted bill due dates and every runway row.
 */

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})/;

/** Parse Date | ISO string | timestamp into a local Date. */
export function parseDate(value, fallback = new Date()) {
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof value === 'number') return new Date(value);
  if (typeof value === 'string') {
    const match = DATE_ONLY.exec(value.trim());
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date(fallback.getTime()) : parsed;
  }
  return new Date(fallback.getTime());
}

/** True when the value can be turned into a real date. */
export function isValidDate(value) {
  if (value === null || value === undefined || value === '') return false;
  const parsed = parseDate(value, new Date(Number.NaN));
  return !Number.isNaN(parsed.getTime());
}

export function startOfDay(value = new Date()) {
  const date = parseDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** `YYYY-MM-DD` in the user's local calendar — the key used by every store. */
export function dayKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && DATE_ONLY.test(value.trim())) return value.trim().slice(0, 10);
  const date = parseDate(value, new Date(Number.NaN));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const isoDate = dayKey;

export function addDays(value, amount) {
  const date = startOfDay(value);
  date.setDate(date.getDate() + amount);
  return date;
}

export function addDaysKey(value, amount) {
  return dayKey(addDays(value, amount));
}

export function dayBefore(value) {
  return addDaysKey(value, -1);
}

/** Whole days between two dates, ignoring time of day. */
export function daysBetween(start, end) {
  const from = startOfDay(start);
  const to = startOfDay(end);
  return Math.round((to.getTime() - from.getTime()) / 86400000);
}

/** Inclusive day count, matching the historic `Math.ceil(diff) + 1` runway math. */
export function daysBetweenInclusive(start, end) {
  return Math.max(1, daysBetween(start, end) + 1);
}

/** Saturday -> Monday, Sunday -> Monday. Mirrors the Apple `DateRules.shiftedWeekendDate`. */
export function shiftWeekend(value) {
  const date = startOfDay(value);
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() + 2);
  else if (weekday === 0) date.setDate(date.getDate() + 1);
  return date;
}

/**
 * Due date for a recurring bill inside the calendar month of `monthDate`.
 * The stored `dueDay` is clamped to the length of that month, then shifted off
 * the weekend: Saturday and Sunday due dates are paid on Monday.
 */
export function dueDateForBill(bill, monthDate) {
  const base = startOfDay(monthDate);
  const lastDay = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const dueDay = Math.min(Math.max(1, Math.trunc(Number(bill?.dueDay ?? bill?.due_day ?? 1)) || 1), lastDay);
  return shiftWeekend(new Date(base.getFullYear(), base.getMonth(), dueDay));
}

/** Every day from `start` through `end` inclusive, capped at `maxDays`. */
export function datesThrough(start, end, maxDays = 45) {
  const from = startOfDay(start);
  const to = startOfDay(end);
  if (to < from) return [];
  const dates = [];
  const cursor = new Date(from.getTime());
  while (cursor <= to && dates.length < maxDays) {
    dates.push(new Date(cursor.getTime()));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function shortLabel(value) {
  return startOfDay(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function weekdayLabel(value) {
  return startOfDay(value).toLocaleDateString(undefined, { weekday: 'short' });
}

export function longLabel(value) {
  return startOfDay(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/** `Mon 14 Mar` — the runway table's date column. */
export function runwayLabel(value) {
  return startOfDay(value).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
