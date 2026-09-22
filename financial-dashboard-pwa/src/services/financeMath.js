/**
 * Ported math from the historic pwa/app.js + shared DateRules:
 * - weekend due-date shifting (Sat -> Mon, Sun -> Mon)
 * - daily runway table with safe-spend, commitments, bills, cumulative spend
 */

/** Saturday/Sunday due dates shift forward to Monday. */
export function shiftedWeekendDate(date) {
  const d = new Date(date);
  const day = d.getDay(); // 0 Sun .. 6 Sat
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

/** Due date for a recurring bill (dueDay 1-31) inside the month of `base`. */
export function billDueDate(bill, base) {
  const year = base.getFullYear();
  const month = base.getMonth();
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(bill.dueDay || 1, lastDay);
  return shiftedWeekendDate(new Date(year, month, day));
}

export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function isoDate(date) {
  const d = startOfDay(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function datesFromThrough(start, end, maxDays = 45) {
  const rows = [];
  let cursor = startOfDay(start);
  const last = startOfDay(end);
  while (cursor <= last && rows.length < maxDays) {
    rows.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return rows;
}

/**
 * Build the daily runway grid:
 * starting balance, safe amount, commitments, cumulative commitments,
 * scheduled bills, ending balance — one row per day until payday.
 *
 * @param {object} opts
 * @param {number} opts.balance        Saved available balance (balance currency).
 * @param {string} opts.currency       Balance currency code.
 * @param {Date|string} opts.payday    Next payday.
 * @param {Array} opts.bills           Recurring bills.
 * @param {Array} opts.commitments     Named dated commitments.
 */
export function buildRunway({ balance, currency, payday, bills = [], commitments = [] }) {
  const start = startOfDay(new Date());
  const end = startOfDay(new Date(payday));
  if (!balance || balance <= 0 || isNaN(end.getTime()) || end < start) return [];

  const dates = datesFromThrough(start, end);
  if (!dates.length) return [];

  const safeToday = balance / dates.length;
  const matchingBills = bills.filter((b) => (b.currencyCode || b.currency) === currency);
  const matchingCommitments = commitments.filter((c) => (c.currencyCode || c.currency) === currency);

  let running = balance;
  let cumulative = 0;

  return dates.map((date, index) => {
    const starting = running;
    const iso = isoDate(date);

    const commitmentsToday = matchingCommitments
      .filter((c) => c.date === iso)
      .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

    const billsToday = matchingBills
      .filter((bill) => isoDate(billDueDate(bill, date)) === iso)
      .reduce((sum, bill) => sum + (Number(bill.amount) || 0), 0);

    cumulative += commitmentsToday;
    running -= safeToday + commitmentsToday + billsToday;

    return {
      day: index + 1,
      date,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      startingBalance: starting,
      safeToday,
      commitments: commitmentsToday,
      cumulative,
      bills: billsToday,
      endingBalance: running,
      currency
    };
  });
}

/** Month-on-month growth string from sorted (date, value) points. */
export function monthGrowth(points) {
  if (!points || points.length < 2) return '—';
  const prev = Number(points[points.length - 2].value) || 0;
  const curr = Number(points[points.length - 1].value) || 0;
  if (prev === 0) return '—';
  const pct = ((curr - prev) / Math.abs(prev)) * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

/** Latest value per series name from a history list. */
export function latestBySeries(history) {
  const map = new Map();
  [...history]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .forEach((row) => {
      map.set(row.series || row.name || 'Unnamed', row);
    });
  return Array.from(map.values());
}
