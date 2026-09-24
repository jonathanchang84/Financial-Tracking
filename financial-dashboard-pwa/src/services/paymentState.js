/** Pure payment-state helpers for recurring monthly expenses. */
import { dayKey } from './dates.js';

export function expensePaymentKey(record, date = new Date(), monthKey = '') {
  const id = String(record?.id || record?.name || 'expense');
  const key = monthKey || dayKey(date).slice(0, 7);
  if (record?.dueDay != null || record?.due_day != null) {
    return `bill:${id}:${key}`;
  }
  return `commitment:${id}`;
}

export function isExpensePaid(record, date = new Date(), paidExpenses = {}, monthKey = '') {
  if (record?.paid === true || record?.status === 'paid' || record?.unpaid === false) return true;
  const map = paidExpenses && typeof paidExpenses === 'object' ? paidExpenses : {};
  return map[expensePaymentKey(record, date, monthKey)] === true;
}
