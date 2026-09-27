import { dayKey } from './dates.js';
import { bucketRange } from './chartScale.js';

/** Stable item key used by the existing name + currency series model. */
function itemKey(row) {
  const name = String(row?.series || row?.name || row?.symbol || 'Item').trim() || 'Item';
  const currency = row?.currencyCode || row?.currency || 'USD';
  return `${name}::${currency}`;
}

/** Bucket key for a snapshot: '2024' by year, '2024-06' by month. */
function bucketOf(row, granularity) {
  const date = effectiveDate(row);
  if (!date) return '';
  return granularity === 'year' ? date.slice(0, 4) : date.slice(0, 7);
}

function numeric(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function effectiveDate(row) {
  return dayKey(row?.validFrom || row?.date);
}

function compareSnapshots(a, b) {
  const byDate = effectiveDate(a).localeCompare(effectiveDate(b));
  if (byDate) return byDate;
  const byUpdated = String(a?.updatedAt || a?.updated_at || '').localeCompare(String(b?.updatedAt || b?.updated_at || ''));
  if (byUpdated) return byUpdated;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Pivot dated snapshots into a bucket-by-item table.
 *
 * `granularity` is 'month' or 'year'. The value shown for a bucket is the LAST
 * snapshot recorded in it, so a year column reads as the position at the end of
 * that year - the same measure the chart draws, which is why both read from this
 * one pivot rather than computing their own.
 *
 * Buckets with no snapshot stay in the output as a null cell rather than being
 * dropped, so the chart and the table keep the same spacing.
 */
export function buildMonthlyHistoryTable({
  rows = [],
  readValue = (row) => row?.value,
  convert = (value) => value,
  granularity = 'month',
  includeMissingBuckets = true
} = {}) {
  const valid = rows
    .map((row) => ({ row, date: effectiveDate(row), bucket: bucketOf(row, granularity) }))
    .filter((item) => item.date && item.bucket);
  if (!valid.length) return { buckets: [], columns: [], rows: [], granularity };

  // Latest snapshot per item per bucket wins, so the cell is the closing value.
  const latest = new Map();
  [...valid].sort((a, b) => compareSnapshots(a.row, b.row)).forEach((item) => {
    latest.set(`${itemKey(item.row)}|${item.bucket}`, item.row);
  });

  const columns = Array.from(
    valid.reduce((map, { row }) => {
      const key = itemKey(row);
      if (!map.has(key)) map.set(key, { key, name: itemKey(row).split('::')[0], currency: itemKey(row).split('::')[1] });
      return map;
    }, new Map()).values()
  ).sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));

  const recorded = [...new Set(valid.map((item) => item.bucket))].sort();
  const buckets = includeMissingBuckets ? bucketRange(recorded, granularity) : recorded;

  const tableRows = buckets.map((bucket) => {
    const index = buckets.indexOf(bucket);
    const cells = {};
    columns.forEach((column) => {
      const current = latest.get(`${column.key}|${bucket}`);
      const previous = index > 0 ? latest.get(`${column.key}|${buckets[index - 1]}`) : null;
      const value = current ? numeric(readValue(current)) : null;
      const previousValue = previous ? numeric(readValue(previous)) : null;
      cells[column.key] = {
        value: value === null ? null : convert(value, current.currencyCode || current.currency || 'USD'),
        change:
          value !== null && previousValue !== null && previousValue !== 0
            ? ((value - previousValue) / Math.abs(previousValue)) * 100
            : null,
        // The date of the closing snapshot, so the chart tooltip can show when
        // the bucket's figure was actually recorded.
        date: current ? effectiveDate(current) : null
      };
    });
    return { bucket, cells };
  });

  return { buckets, columns, rows: tableRows, granularity };
}

