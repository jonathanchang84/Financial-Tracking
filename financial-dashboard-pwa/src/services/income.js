/**
 * Income streams — several named, recurring paydays with exactly one marked as
 * the main payday the runway runs from and to.
 *
 * Pure and framework-free on purpose: this module is imported directly by
 * `node --test` (see `tests/income.test.js`), which `syncEngine.js` cannot be,
 * because that one pulls in `svelte/store` and `import.meta.env`.
 *
 * Storage needs no schema change. Streams live in the `settings` store under the
 * `incomeStreams` key, so the Worker stores them as one JSON array inside
 * `finance_records.data_json` — the same envelope `pensionPotGrowth` and
 * `paidExpenses` already use.
 */
import {
  dayKey,
  longLabel,
  occurrenceInMonth,
  shiftToPreviousFriday,
  startOfDay,
  weekdayLabel
} from './dates.js';

/** Day-of-month input bounds. 31 is allowed; short months clamp when resolving. */
export const MIN_INCOME_DAY = 1;
export const MAX_INCOME_DAY = 31;

/** Keeps a hand-edited backup from producing an unbounded list. */
export const MAX_INCOME_STREAMS = 12;

export const DEFAULT_STREAM_NAME = 'Income';

function newStreamId() {
  return globalThis.crypto?.randomUUID?.() || `income-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Clamp to a usable day-of-month, or null when the value cannot be one. */
export function normaliseIncomeDay(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return null;
  return Math.min(MAX_INCOME_DAY, Math.max(MIN_INCOME_DAY, parsed));
}

/**
 * Coerce stored or imported data into the canonical shape and repair the
 * "exactly one main" invariant. Safe to call on every read, which is why it is
 * tolerant of a missing, malformed, or hand-edited list.
 */
export function normaliseIncomeStreams(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const streams = [];
  for (const item of list) {
    if (streams.length >= MAX_INCOME_STREAMS) break;
    const source = item && typeof item === 'object' ? item : {};
    const dayOfMonth = normaliseIncomeDay(source.dayOfMonth);
    if (dayOfMonth === null) continue;
    let id = String(source.id || '').trim();
    if (!id || seen.has(id)) id = newStreamId();
    seen.add(id);
    const name = String(source.name ?? '').trim() || DEFAULT_STREAM_NAME;
    streams.push({ id, name, dayOfMonth, isMain: source.isMain === true });
  }
  // The invariant: exactly one main, whenever there is at least one stream.
  // A single stream is implicitly the main payday, so a lone "Salary" needs no
  // extra click. Otherwise the first stream marked main wins.
  if (streams.length) {
    const chosen = streams.find((stream) => stream.isMain) || streams[0];
    streams.forEach((stream) => { stream.isMain = stream === chosen; });
  }
  return streams;
}

/**
 * The next payday for one day-of-month on or after `from`, keeping the
 * unshifted date so the UI can explain a weekend adjustment.
 */
export function nextStreamOccurrence(dayOfMonth, from = new Date()) {
  const start = startOfDay(from);
  for (let offset = 0; offset < 14; offset += 1) {
    const month = new Date(start.getFullYear(), start.getMonth() + offset, 1);
    const raw = occurrenceInMonth(dayOfMonth, month);
    const date = shiftToPreviousFriday(raw);
    if (date >= start) return { date, raw };
  }
  return null;
}

function ordinal(day) {
  const suffix = day % 10 === 1 && day !== 11 ? 'st'
    : day % 10 === 2 && day !== 12 ? 'nd'
      : day % 10 === 3 && day !== 13 ? 'rd'
        : 'th';
  return `${day}${suffix}`;
}

/** One stream's next payday, with enough detail to explain it in the UI. */
export function paydayDetail(stream, today = new Date()) {
  const dayOfMonth = normaliseIncomeDay(stream?.dayOfMonth);
  if (dayOfMonth === null) return null;
  const occurrence = nextStreamOccurrence(dayOfMonth, today);
  if (!occurrence) return null;
  const { date, raw } = occurrence;
  const notes = [];
  if (dayKey(raw) !== dayKey(date)) {
    notes.push(`entered ${ordinal(dayOfMonth)}, brought back from ${weekdayLabel(raw)}`);
  } else if (date.getDate() !== dayOfMonth) {
    notes.push(`${ordinal(dayOfMonth)} is longer than this month, so it lands here`);
  }
  return {
    stream,
    dayOfMonth,
    date,
    key: dayKey(date),
    label: longLabel(date),
    weekday: weekdayLabel(date),
    notes,
    adjusted: notes.length > 0
  };
}

/** All streams' next paydays, soonest first. Streams sharing a date are kept. */
export function upcomingPaydays(streams, today = new Date(), limit = 0) {
  const details = normaliseIncomeStreams(streams)
    .map((stream) => paydayDetail(stream, today))
    .filter(Boolean)
    .sort((a, b) => (a.key === b.key ? a.stream.name.localeCompare(b.stream.name) : a.key.localeCompare(b.key)));
  return limit > 0 ? details.slice(0, limit) : details;
}

/**
 * The payday the runway runs from and to. Falls back to the soonest upcoming
 * payday when nothing is marked, so a partially filled list still works.
 * Returns null when there are no streams at all.
 */
export function resolveMainPayday(streams, today = new Date()) {
  const list = normaliseIncomeStreams(streams);
  if (!list.length) return null;
  const main = list.find((stream) => stream.isMain) || list[0];
  const detail = paydayDetail(main, today);
  return detail ? { ...detail, isFallback: !main.isMain } : null;
}

/** Force one stream to be the main payday, keeping the rest valid. */
export function withMainStream(streams, id) {
  return normaliseIncomeStreams(streams).map((stream) => ({ ...stream, isMain: stream.id === id }));
}

/** Replace one stream, matching by id, and keep the list valid. */
export function upsertStream(streams, next) {
  const list = normaliseIncomeStreams(streams).map((stream) => (
    stream.id === next.id ? { ...stream, ...next } : stream
  ));
  return normaliseIncomeStreams(list);
}

/**
 * Remove a stream, promoting another to main when the main one goes so there is
 * never a list with no main payday.
 */
export function removeStream(streams, id) {
  const remaining = normaliseIncomeStreams(streams).filter((stream) => stream.id !== id);
  if (!remaining.length) return [];
  if (!remaining.some((stream) => stream.isMain)) remaining[0].isMain = true;
  return remaining;
}

/** A new stream, seeded sensibly: blank name, day 1, main when it is the only one. */
export function createStream(existing = [], overrides = {}) {
  const list = normaliseIncomeStreams(existing);
  const stream = {
    id: newStreamId(),
    name: '',
    dayOfMonth: 1,
    isMain: list.length === 0,
    ...overrides
  };
  return normaliseIncomeStreams([...list, stream]);
}
