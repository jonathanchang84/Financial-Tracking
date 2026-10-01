/**
 * Dated balance history — the recorded available balance on a given day.
 *
 * The runway anchors past days on these records rather than inventing a balance
 * for them, so a day with no record on or before it is reported as unknown
 * (`null`) instead of being reconstructed. An invented figure would be
 * indistinguishable from a real one, and a blank is honest.
 *
 * One record per date: recording a balance for a date that already has one
 * replaces it, so a correction never leaves two competing figures for the same
 * day. The id is derived from the date alone, which is what makes that
 * replacement work without a lookup.
 *
 * Pure and framework-free so it can be unit-tested under `node --test`
 * (see `tests/balanceHistory.test.js`).
 */
import { dayKey, isValidDate, startOfDay } from './dates.js';

/** Stable per-day id, so re-recording the same date replaces rather than appends. */
export function balanceRecordId(date) {
  const key = dayKey(date);
  return key ? `balance-${key}` : '';
}

/** Coerce a stored row into the canonical shape, or null when unusable. */
export function normaliseBalanceRecord(row) {
  const date = dayKey(row?.date);
  if (!isValidDate(date)) return null;
  const raw = Number(String(row?.amount ?? '').replace(/,/g, ''));
  if (!Number.isFinite(raw)) return null;
  return {
    id: String(row?.id || '').trim() || balanceRecordId(date),
    date,
    amount: raw,
    currencyCode: String(row?.currencyCode || row?.currency || '').trim()
  };
}

/** Valid records only, oldest first, one per date (the last record for a date wins). */
export function normaliseBalanceHistory(rows = []) {
  if (!Array.isArray(rows)) return [];
  const byDate = new Map();
  for (const row of rows) {
    const record = normaliseBalanceRecord(row);
    if (record) byDate.set(record.date, record);
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The record that seeds `date`: the most recent one on or before it.
 * Null when nothing has been recorded by then, which is the signal the runway
 * uses to leave a day blank rather than guess.
 */
export function anchorForDate(history, date) {
  const key = dayKey(date);
  if (!key) return null;
  const records = normaliseBalanceHistory(history);
  let found = null;
  for (const record of records) {
    if (record.date <= key) found = record;
    else break;
  }
  return found;
}

/** Recorded days within an inclusive `YYYY-MM-DD` window, oldest first. */
export function recordedDatesIn(history, start, end) {
  const from = dayKey(start);
  const to = dayKey(end);
  if (!from || !to || from > to) return [];
  return normaliseBalanceHistory(history)
    .filter((record) => record.date >= from && record.date <= to)
    .map((record) => record.date);
}

/** True when this exact day carries a recorded figure, used for the update marker. */
export function isRecordedDay(history, date) {
  const key = dayKey(date);
  if (!key) return false;
  return normaliseBalanceHistory(history).some((record) => record.date === key);
}

/** Today's key in the user's local calendar. */
export function todayKey(today = new Date()) {
  return dayKey(startOfDay(today));
}
