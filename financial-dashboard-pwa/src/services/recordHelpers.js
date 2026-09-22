import { convertCurrency } from '../stores/finance.js';

export function newId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function num(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function codeOf(row, fallback = 'USD') {
  return row?.currencyCode || row?.currency || fallback;
}

export function nameOf(row) {
  return String(row?.name || row?.series || row?.symbol || '').trim();
}

export function todayISO() {
  const d = new Date();
  return iso(d);
}

export function iso(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export async function persist(store, record) {
  const next = { ...record, pending_sync: true };
  if (typeof store?.save === 'function') return store.save(next);
  if (typeof store?.upsert === 'function') return store.upsert(next);
  if (typeof store?.put === 'function') return store.put(next);
  if (typeof store?.add === 'function') return store.add(next);
  throw new Error('Store has no save method');
}

export async function destroy(store, id) {
  if (typeof store?.remove === 'function') return store.remove(id);
  if (typeof store?.delete === 'function') return store.delete(id);
  throw new Error('Store has no delete method');
}

/** Saturday/Sunday due dates shift to Monday, matching DateRules.shiftedWeekendDate. */
export function shiftWeekend(date) {
  const d = new Date(date);
  d.setHours(12, 0, 0, 0);
  const day = d.getDay();
  if (day === 6) d.setDate(d.getDate() + 2);
  else if (day === 0) d.setDate(d.getDate() + 1);
  return d;
}

export function billDueOn(bill, day) {
  const last = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  const dueDay = Math.min(Math.max(1, num(bill?.dueDay) || 1), last);
  return shiftWeekend(new Date(day.getFullYear(), day.getMonth(), dueDay, 12));
}

export function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Daily runway through payday (max 45 days).
 * Columns: starting balance, safe amount, commitments, cumulative commitments, scheduled bills, ending balance.
 */
export function buildDailyRunway({ balance, currency = 'USD', payday, bills = [], commitments = [] }) {
  const start = new Date();
  start.setHours(12, 0, 0, 0);
  const end = new Date(payday);
  if (!(num(balance) > 0) || Number.isNaN(end.getTime())) return [];
  end.setHours(12, 0, 0, 0);
  if (end < start) return [];
  const dates = [];
  for (let d = new Date(start); d <= end && dates.length < 45; d.setDate(d.getDate() + 1)) dates.push(new Date(d));
  const safe = num(balance) / Math.max(1, dates.length);
  let running = num(balance);
  let cumulative = 0;
  return dates.map((date) => {
    const starting = running;
    const commit = commitments.reduce((sum, item) => {
      const when = new Date(item.date);
      if (Number.isNaN(when.getTime()) || !sameDay(when, date)) return sum;
      return sum + convertCurrency(num(item.amount), codeOf(item, currency), currency);
    }, 0);
    const scheduled = bills.reduce((sum, bill) => {
      if (!sameDay(billDueOn(bill, date), date)) return sum;
      return sum + convertCurrency(num(bill.amount), codeOf(bill, currency), currency);
    }, 0);
    cumulative += commit;
    const ending = starting - commit - scheduled;
    running = ending;
    return { date, starting, safe, commitments: commit, cumulative, bills: scheduled, ending };
  });
}
