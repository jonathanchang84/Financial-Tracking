/**
 * Combined wealth across accounts, investments and pensions.
 *
 * The dashboard's headline sums all three, so anything that *describes* that
 * number has to be built from all three too. Comparing a three-part total with a
 * one-part history reads as a real percentage and is not one.
 */

/** A history row's value, or null when it has none to contribute. */
function valueOf(row) {
  const raw = row?.value;
  const parsed = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Sum every supplied history into one `{ date, value }` series, grouped by date.
 *
 * Grouping is the whole point. Concatenating the three histories and sorting by
 * date would interleave unrelated snapshots, so "the previous point" could be one
 * day's investments against the next day's pension pot - producing a percentage
 * that describes nothing. Summing per date first means each point is a genuine
 * like-for-like total and the change between two points is meaningful.
 *
 * Rows with no usable value are skipped rather than counted as zero, so a
 * half-written snapshot cannot drag a date's total down.
 *
 * `convert` is injected so this stays pure and testable; the caller supplies
 * currency conversion.
 */
export function wealthPointsByDate(sources = [], { convert = (value) => value } = {}) {
  const byDate = new Map();
  for (const rows of sources) {
    for (const row of rows || []) {
      const date = String(row?.date || row?.validFrom || '').slice(0, 10);
      const value = valueOf(row);
      if (!date || value === null) continue;
      const converted = Number(convert(value, row));
      if (!Number.isFinite(converted)) continue;
      byDate.set(date, (byDate.get(date) || 0) + converted);
    }
  }
  return Array.from(byDate.entries())
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Percentage change of the two most recent wealth points.
 *
 * Delegates to the shared `growthPercent` so the sign handling is identical to
 * the rest of the app. Returns null when there is not enough data, which callers
 * must render as "not enough data" rather than a misleading 0%.
 */
export { growthPercent } from './runway.js';
