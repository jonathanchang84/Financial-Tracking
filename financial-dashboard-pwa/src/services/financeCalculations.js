/**
 * Pure finance calculations used by the spreadsheet-inspired dashboard views.
 * No DOM, Svelte or database dependencies live in this module.
 */
import { dayKey, startOfDay, daysBetween, dueDateForBill, isValidDate } from './dates.js';
import { currencyOf, num, seriesNameOf } from './runway.js';
import { expensePaymentKey, isExpensePaid } from './paymentState.js';

const DEFAULT_CATEGORY = 'Other';

export function daysUntilPayday(today, payday) {
  if (!isValidDate(today) || !isValidDate(payday)) return 0;
  const from = startOfDay(today);
  const to = startOfDay(payday);
  if (to < from) return 0;
  return daysBetween(from, to);
}

function monthKey(value) {
  return dayKey(value).slice(0, 7);
}

function monthDate(value) {
  const key = monthKey(value);
  if (!key) return new Date(Number.NaN);
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1);
}

function billForMonth(bill, value) {
  return dueDateForBill(bill, monthDate(value));
}

function isInCurrency(record, currency) {
  return !currency || currencyOf(record) === currency;
}

function activeExpense(record) {
  return record?.active !== false;
}

/** Group a set of monthly expenses by the workbook's Type/category column. */
export function categoryTotals(rows = []) {
  const totals = new Map();
  rows.forEach((row) => {
    const category = String(row.category || row.type || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
    totals.set(category, (totals.get(category) || 0) + num(row.amount ?? row.value));
  });
  return Array.from(totals, ([category, value]) => ({ category, value }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

/** Build the current-month expense table, totals and unpaid remainder. */
export function currentMonthExpenses({
  balance = 0,
  currency = 'USD',
  month = new Date(),
  bills = [],
  commitments = [],
  paidExpenses = {}
} = {}) {
  const key = monthKey(month);
  const rows = [];
  bills.filter((row) => activeExpense(row) && isInCurrency(row, currency)).forEach((bill) => {
    const due = billForMonth(bill, month);
    const date = Number.isNaN(due.getTime()) ? monthDate(month) : due;
    rows.push({
      id: bill.id,
      kind: 'bill',
      name: bill.name || 'Bill',
      category: bill.category || 'Other',
      amount: num(bill.amount),
      date,
      paid: isExpensePaid(bill, date, paidExpenses, key),
      paymentKey: expensePaymentKey(bill, date, key)
    });
  });
  commitments
    .filter((row) => isInCurrency(row, currency) && monthKey(row.date) === key)
    .forEach((item) => {
      rows.push({
        id: item.id,
        kind: 'commitment',
        name: item.name || 'Spend item',
        category: item.category || 'Spend Items',
        amount: num(item.amount),
        date: item.date,
        paid: isExpensePaid(item, item.date, paidExpenses, key),
        paymentKey: expensePaymentKey(item, item.date, key)
      });
    });
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  let running = num(balance);
  rows.forEach((row) => {
    if (!row.paid) running -= row.amount;
    row.remainder = running;
  });
  const unpaidTotal = rows.filter((row) => !row.paid).reduce((sum, row) => sum + row.amount, 0);
  return {
    month: key,
    rows,
    categories: categoryTotals(rows),
    total,
    unpaidTotal,
    remainder: num(balance) - unpaidTotal
  };
}

/** Workbook pension formula: (1 + annual rate)^(1/12) - 1. */
export function monthlyPensionRate(annualRate) {
  const rate = num(annualRate);
  return Math.pow(1 + rate, 1 / 12) - 1;
}

/** Project one annual point per year from the latest value for each series. */
export function projectPensionSeries({ history = [], pots = [], annualRate = 0.05, years = 10 } = {}) {
  const baselines = new Map();
  [...history].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).forEach((row) => {
    const key = `${seriesNameOf(row)}::${currencyOf(row)}`;
    baselines.set(key, {
      name: seriesNameOf(row),
      currency: currencyOf(row),
      value: num(row.value),
      annualRate: row.growth != null ? num(row.growth) : null
    });
  });
  pots.forEach((row) => {
    const key = `${seriesNameOf(row)}::${currencyOf(row)}`;
      if (!baselines.has(key)) {
        baselines.set(key, {
          name: seriesNameOf(row),
          currency: currencyOf(row),
          value: num(row.value),
          annualRate: row.growth != null ? num(row.growth) : null
        });
      }
  });
  const series = Array.from(baselines.values()).filter((row) => row.value >= 0);
  const safeAnnualRate = Math.max(-0.99, num(annualRate));
  const points = Array.from({ length: Math.max(0, Math.trunc(years) + 1) }, (_, index) => ({
    year: index,
    values: series.map((row) => {
      const rate = row.annualRate == null ? safeAnnualRate : Math.max(-0.99, row.annualRate);
      return row.value * Math.pow(1 + rate, index);
    })
  }));
  return { series, points, annualRate: num(annualRate) };
}

/** Redundancy formulas, with safe handling for below-threshold/zero inputs. */
export function redundancyProjection({
  payout = 0,
  taxFreeThreshold = 30000,
  taxRate = 0.4,
  monthlySpends = [5800, 5100, 3800]
} = {}) {
  const gross = Math.max(0, num(payout));
  const threshold = Math.max(0, num(taxFreeThreshold));
  const rate = Math.min(1, Math.max(0, num(taxRate)));
  const taxable = Math.max(0, gross - threshold);
  const taxableTakeHome = taxable * (1 - rate);
  const netTakeHome = Math.min(gross, threshold) + taxableTakeHome;
  const scenarios = monthlySpends.map((value) => {
    const spend = Math.max(0, num(value));
    return { spend, months: spend > 0 ? netTakeHome / spend : null };
  });
  return { gross, threshold, taxable, taxableTakeHome, netTakeHome, scenarios };
}
