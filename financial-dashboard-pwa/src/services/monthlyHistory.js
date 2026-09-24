import { dayKey } from './dates.js';

/** Stable item key used by the existing name + currency series model. */
function itemKey(row) {
  const name = String(row?.series || row?.name || row?.symbol || 'Item').trim() || 'Item';
  const currency = row?.currencyCode || row?.currency || 'USD';
  return `${name}::${currency}`;
}

function numeric(value) {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function effectiveDate(row) {
  return dayKey(row?.validFrom || row?.date);
}

function monthKey(row) {
  return effectiveDate(row).slice(0, 7);
}

function compareSnapshots(a, b) {
  const byDate = effectiveDate(a).localeCompare(effectiveDate(b));
  if (byDate) return byDate;
  const byUpdated = String(a?.updatedAt || a?.updated_at || '').localeCompare(String(b?.updatedAt || b?.updated_at || ''));
  if (byUpdated) return byUpdated;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function monthsBetween(first, last) {
  const start = first.split('-').map(Number);
  const end = last.split('-').map(Number);
  const months = [];
  for (let year = start[0], month = start[1]; year < end[0] || (year === end[0] && month <= end[1]);) {
    months.push(`${year}-${String(month).padStart(2, '0')}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/**
 * Pivot dated snapshots into a month-by-item comparison table.
 * The latest record in each month is the value shown for that item/month.
 */
export function buildMonthlyHistoryTable({
  rows = [],
  readValue = (row) => row?.value,
  convert = (value) => value,
  includeMissingMonths = true
} = {}) {
  const valid = rows
    .map((row) => ({ row, date: effectiveDate(row), month: monthKey(row) }))
    .filter((item) => item.date && item.month);
  if (!valid.length) return { months: [], columns: [], rows: [] };

  const recordedMonths = [...new Set(valid.map((item) => item.month))].sort();
  const months = includeMissingMonths ? monthsBetween(recordedMonths[0], recordedMonths.at(-1)) : recordedMonths;
  const latest = new Map();
  [...valid].sort((a, b) => compareSnapshots(a.row, b.row)).forEach((item) => {
    latest.set(`${itemKey(item.row)}|${item.month}`, item.row);
  });

  const columns = Array.from(
    valid.reduce((map, { row }) => {
      const key = itemKey(row);
      if (!map.has(key)) map.set(key, { key, name: itemKey(row).split('::')[0], currency: itemKey(row).split('::')[1] });
      return map;
    }, new Map()).values()
  ).sort((a, b) => a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency));

  const tableRows = months.map((month) => {
    const cells = {};
    columns.forEach((column) => {
      const current = latest.get(`${column.key}|${month}`);
      const previous = months[months.indexOf(month) - 1]
        ? latest.get(`${column.key}|${months[months.indexOf(month) - 1]}`)
        : null;
      const value = current ? numeric(readValue(current)) : null;
      const previousValue = previous ? numeric(readValue(previous)) : null;
      const change = value !== null && previousValue !== null && previousValue !== 0
        ? ((value - previousValue) / Math.abs(previousValue)) * 100
        : null;
      cells[column.key] = {
        value: value === null ? null : convert(value, current.currencyCode || current.currency || 'USD'),
        change
      };
    });
    return { month, cells };
  });

  return { months, columns, rows: tableRows };
}
