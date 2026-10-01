import { dayKey } from './dates.js';
import { bucketRange } from './chartScale.js';

/** The series a history row belongs to. One name is one position. */
function seriesLabel(row) {
  return String(row?.series || row?.name || row?.symbol || '').trim();
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

/**
 * Period-on-period change as a percentage of the previous figure.
 *
 * Sign handling matters now that a liability is stored negative. A mortgage
 * falling from -150,000 to -140,000 is a debt being paid off, and must read as a
 * fall. The naive `(value - previous) / |previous|` gives +6.7% there, because the
 * subtraction of two negatives is positive - so the cell would show the debt
 * shrinking while the column claimed it grew.
 *
 * Both magnitudes are compared instead, and the sign of the result follows the
 * direction the displayed figure actually moved. Assets are unaffected: with two
 * positives the magnitudes and the raw values have the same relationship.
 */
function percentChange(value, previousValue) {
  if (value === null || previousValue === null || previousValue === 0) return null;
  if (!Number.isFinite(value) || !Number.isFinite(previousValue)) return null;
  return ((Math.abs(value) - Math.abs(previousValue)) / Math.abs(previousValue)) * 100;
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
  includeMissingBuckets = true,
  // Supplies the asset/liability kind for a row. History rows written before
  // `kind` was stored carry no kind of their own, so the caller can resolve it
  // from the current entity. Defaulting to the row keeps this module standalone.
  resolveKind = (row) => String(row?.kind || '').trim().toLowerCase()
} = {}) {
  const valid = rows
    .map((row) => ({ row, date: effectiveDate(row), bucket: bucketOf(row, granularity) }))
    .filter((item) => item.date && item.bucket);
  if (!valid.length) return { buckets: [], columns: [], rows: [], granularity };

  // Latest snapshot per item per bucket wins, so the cell is the closing value.
  //
  // Grouped by NAME rather than by id. Adding the same position twice mints a new
  // entity id and so starts a second version chain, and nothing ever closes the
  // first one off - both rows then claim to be current. Keyed on the id, the same
  // position is counted twice, which is what inflated the portfolio total. One
  // name is one position, so the latest row for that name in the bucket wins and
  // the duplicate chain is simply superseded.
  const latest = new Map();
  for (const item of [...valid].sort((a, b) => compareSnapshots(a.row, b.row))) {
    const name = seriesLabel(item.row);
    if (!name) continue;
    latest.set(`${name}|${item.bucket}`, item.row);
  }

  // Columns are described by the NEWEST row per series, so the name and currency
  // in the header are the ones in force now. An older version can carry a
  // different currency after a re-key, and labelling the column with that would
  // misname every figure in it.
  const newest = new Map();
  for (const item of [...valid].sort((a, b) => compareSnapshots(a.row, b.row))) {
    const name = seriesLabel(item.row);
    if (!name) continue;
    newest.set(name, item.row);
  }

  const columns = Array.from(newest, ([name, row]) => ({
    key: name,
    name,
    currency: row?.currencyCode || row?.currency || 'USD',
    // Carried so the chart legend can mark a liability without the component
    // re-deriving it. `resolveKind` lets the caller fall back to the entity store
    // for rows recorded before `kind` was written onto history rows.
    kind: resolveKind(row)
  })).sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));

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
        change: percentChange(value, previousValue),
        // The date of the closing snapshot, so the chart tooltip can show when
        // the bucket's figure was actually recorded.
        date: current ? effectiveDate(current) : null
      };
    });
    return { bucket, cells };
  });

  return { buckets, columns, rows: tableRows, granularity };
}

