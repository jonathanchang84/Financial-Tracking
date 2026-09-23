/**
 * SCD Type 2 temporal bookkeeping for mutable financial records.
 *
 * Mirrors `Sources/FinancialTrackingCore` and the historic browser app:
 *
 *   - Mutable records carry `validFrom`, `validTo` and `currentFlag`.
 *   - `validTo === null/'' && currentFlag !== false` means "the current version".
 *   - Stable logical IDs (`logicalId`) connect versions of the same business
 *     record, so historical valuations are never overwritten.
 *   - Updating a value closes the open version (`validTo = newDate - 1`) and
 *     inserts a new version. Intervals are half-open: `[validFrom, validTo]`.
 *
 * Everything in this module is pure and returns *plans* (patches + inserts).
 * `src/services/positions.js` applies those plans to IndexedDB.
 */

import { dayKey, dayBefore } from './dates.js';

export function isCurrentVersion(row) {
  if (!row) return false;
  if (row.currentFlag === false) return false;
  if (row.validTo) return false;
  return true;
}

/** Series names keep separate series apart, per currency. */
export function seriesKey(row) {
  const name = String(row?.series || row?.name || 'Item').trim() || 'Item';
  return `${name}::${row?.currencyCode || row?.currency || 'USD'}`;
}

export function sortByValidFrom(rows = []) {
  return [...rows].sort((a, b) => {
    const left = dayKey(a.validFrom || a.date);
    const right = dayKey(b.validFrom || b.date);
    if (left === right) return String(a.id).localeCompare(String(b.id));
    return left.localeCompare(right);
  });
}

export function versionsForSeries(rows = [], series, currency = 'USD') {
  const name = String(series || '').trim();
  return sortByValidFrom(
    rows.filter((row) => seriesKey(row) === `${name}::${currency}`)
  );
}

/** All open versions, one per series/currency pair (latest wins). */
export function currentVersions(rows = []) {
  const map = new Map();
  sortByValidFrom(rows).forEach((row) => {
    if (!isCurrentVersion(row)) return;
    const key = seriesKey(row);
    map.set(key, row);
  });
  return Array.from(map.values());
}

/** Historical (closed) versions, newest first — what the UI lists under "History". */
export function closedVersions(rows = []) {
  return sortByValidFrom(rows).filter((row) => !isCurrentVersion(row)).reverse();
}

/** Stable logical id for a series, reusing the existing chain when present. */
export function resolveLogicalId({ rows = [], series, currency = 'USD', fallback }) {
  const existing = versionsForSeries(rows, series, currency);
  const open = existing.filter(isCurrentVersion).at(-1);
  return open?.logicalId || existing.at(-1)?.logicalId || fallback;
}

/**
 * Plan the SCD Type 2 write for a new valuation.
 *
 * @returns {{
 *   logicalId: string,
 *   logicalIdCreated: boolean,
 *   insert: object,
 *   close: Array<{ id: string, validTo: string, currentFlag: false }>,
 *   previousValue: number|null,
 *   previousVersionId: string|null,
 *   replacedSameDayId: string|null,
 *   effectiveDate: string
 * }}
 */
export function planValuation({
  rows = [],
  id,
  series,
  date,
  value,
  currency = 'USD',
  logicalId = null,
  notes = ''
}) {
  const effectiveDate = dayKey(date) || dayKey(new Date());
  const name = String(series || '').trim() || 'Item';
  const existing = versionsForSeries(rows, name, currency);
  const open = existing.filter(isCurrentVersion).at(-1) || null;
  const plannedLogicalId = logicalId || open?.logicalId || existing.at(-1)?.logicalId || id;

  const close = [];
  const from = dayKey(open?.validFrom || open?.date);

  // A same-day re-key replaces the open version instead of creating a zero-length interval.
  const replacedSameDayId = open && from && from === effectiveDate ? open.id : null;
  if (open && !replacedSameDayId) {
    const closedOn = dayBefore(effectiveDate);
    close.push({
      id: open.id,
      validTo: closedOn < (from || closedOn) ? from || closedOn : closedOn,
      currentFlag: false
    });
  }

  return {
    logicalId: plannedLogicalId,
    logicalIdCreated: !open && existing.length === 0,
    insert: {
      id: replacedSameDayId || id,
      logicalId: plannedLogicalId,
      series: name,
      date: effectiveDate,
      value: Number(value) || 0,
      currencyCode: currency,
      notes: notes || '',
      validFrom: effectiveDate,
      validTo: null,
      currentFlag: true
    },
    close,
    previousValue: open ? Number(open.value) || 0 : null,
    previousVersionId: open?.id ?? null,
    replacedSameDayId,
    effectiveDate
  };
}

/**
 * Group every version by logical id so the UI can show one row per series with
 * its full audit trail underneath.
 */
export function groupByLogicalId(rows = []) {
  const groups = new Map();
  sortByValidFrom(rows).forEach((row) => {
    const key = row.logicalId || seriesKey(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return groups;
}

/** Attach SCD Type 2 metadata to a freshly created current record. */
export function withVersionMeta(record, date) {
  const effectiveDate = dayKey(date) || dayKey(new Date());
  return { ...record, validFrom: effectiveDate, validTo: null, currentFlag: true };
}
