/** Daily runway math ported from the Apple app's DateRules + CashFlowView. */

export function num(value) {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function currencyOf(row, fallback = 'USD') {
  return row?.currencyCode || row?.currency || fallback;
}

export function dayKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function startOfDay(value = new Date()) {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Saturday -> Monday, Sunday -> Monday. Matches DateRules.shiftedWeekendDate. */
export function shiftWeekend(value) {
  const date = startOfDay(value);
  const weekday = date.getDay();
  if (weekday === 6) date.setDate(date.getDate() + 2);
  if (weekday === 0) date.setDate(date.getDate() + 1);
  return date;
}

export function dueDateForBill(bill, monthDate) {
  const base = startOfDay(monthDate);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const day = Math.min(Math.max(1, num(bill?.dueDay || bill?.due_day) || 1), last);
  return shiftWeekend(new Date(base.getFullYear(), base.getMonth(), day));
}

export function datesThrough(start, end, maxDays = 45) {
  const from = startOfDay(start);
  const to = startOfDay(end);
  if (to < from) return [];
  const dates = [];
  const cursor = new Date(from);
  while (cursor <= to && dates.length < maxDays) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

export function settingValue(settings, key, fallback = '') {
  if (settings == null) return fallback;
  if (Array.isArray(settings)) {
    const row = settings.find((item) => item?.key === key || item?.id === key);
    return row?.value ?? fallback;
  }
  return settings[key] ?? fallback;
}

/**
 * One row per day from today through payday.
 * Columns: starting, safe, commitments, cumulative commitments, scheduled bills, ending.
 */
export function buildDailyRunway({ balance, currency, payday, bills = [], commitments = [], maxDays = 45 }) {
  const amount = num(balance);
  if (!(amount > 0) || !payday) return [];
  const dates = datesThrough(new Date(), payday, maxDays);
  if (!dates.length) return [];
  const safe = amount / dates.length;
  let running = amount;
  let cumulative = 0;
  return dates.map((date) => {
    const key = dayKey(date);
    const starting = running;
    const commitmentTotal = commitments.reduce((sum, item) => {
      if (currencyOf(item) !== currency || dayKey(item.date) !== key) return sum;
      return sum + num(item.amount);
    }, 0);
    const billTotal = bills.reduce((sum, bill) => {
      if (currencyOf(bill) !== currency) return sum;
      const due = dueDateForBill(bill, date);
      return dayKey(due) === key ? sum + num(bill.amount) : sum;
    }, 0);
    cumulative += commitmentTotal;
    const ending = starting - commitmentTotal - billTotal;
    running = ending;
    return {
      date: key,
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      starting,
      safe,
      commitments: commitmentTotal,
      cumulative,
      bills: billTotal,
      ending
    };
  });
}
