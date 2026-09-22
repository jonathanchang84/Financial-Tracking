import { writable, derived, get } from 'svelte/store';
import { getAll, put, remove, loadAll } from '../services/indexedDB.js';
import { syncRecord, flushPending } from '../services/syncEngine.js';

/* ------------------------------------------------------------------ */
/* Global currency store — fixed-rate display conversion (historic).  */
/* ------------------------------------------------------------------ */

export const RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 149.5,
  CHF: 0.88,
  CNY: 7.24,
  INR: 83.2
};

export const CURRENCIES = Object.keys(RATES);

/** Convert amount from one currency to another using historic fixed rates. */
export function convertCurrency(amount, from, to) {
  if (from === to) return Number(amount) || 0;
  const inUSD = (Number(amount) || 0) / (RATES[from] || 1);
  return inUSD * (RATES[to] || 1);
}

/** Selected display currency for every dashboard. */
export const displayCurrency = writable('USD');
export function setDisplayCurrency(code) {
  if (RATES[code]) displayCurrency.set(code);
}

export function money(value, code) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: code || 'USD'
    }).format(Number(value) || 0);
  } catch {
    return `${code || 'USD'} ${(Number(value) || 0).toFixed(2)}`;
  }
}

/** Convert then format — the single entry point used by all components. */
export function displayMoney(value, fromCode) {
  const to = get(displayCurrency);
  return money(convertCurrency(value, fromCode, to), to);
}

/* ------------------------------------------------------------------ */
/* Unified reactive entity arrays                                     */
/* ------------------------------------------------------------------ */

function entityStore(name) {
  const { subscribe, set, update } = writable([]);
  return {
    subscribe,
    set,
    async init() {
      set(await getAll(name));
    },
    async save(record) {
      const saved = await put(name, record);
      update((rows) => {
        const idx = rows.findIndex((r) => r.id === saved.id);
        if (idx >= 0) {
          const next = [...rows];
          next[idx] = saved;
          return next;
        }
        return [...rows, saved];
      });
      syncRecord(name, saved);
      return saved;
    },
    async remove(id) {
      await remove(name, id);
      update((rows) => rows.filter((r) => r.id !== id));
      flushPending();
    }
  };
}

export const netWorthEntries = entityStore('netWorthEntries');
export const netWorthHistory = entityStore('netWorthHistory');
export const holdings = entityStore('holdings');
export const portfolioHistory = entityStore('portfolioHistory');
export const pensions = entityStore('pensions');
export const pensionHistory = entityStore('pensionHistory');
export const bills = entityStore('bills');
export const commitments = entityStore('commitments');
export const transactions = entityStore('transactions');
export const budgets = entityStore('budgets');

/** Settings as a plain object (historic shape: { key: value }). */
export const settings = writable({
  balance: 0,
  balanceCurrency: 'USD',
  payday: '',
  portfolioGrowth: 0.05,
  pensionGrowth: 0.05
});

export async function saveSetting(key, value) {
  await put('settings', { id: key, key, value });
  settings.update((s) => ({ ...s, [key]: value }));
  flushPending();
}

/** Load everything from IndexedDB at boot. */
export async function bootstrapStores() {
  const data = await loadAll();
  netWorthEntries.set(data.netWorthEntries || []);
  netWorthHistory.set(data.netWorthHistory || []);
  holdings.set(data.holdings || []);
  portfolioHistory.set(data.portfolioHistory || []);
  pensions.set(data.pensions || []);
  pensionHistory.set(data.pensionHistory || []);
  bills.set(data.bills || []);
  commitments.set(data.commitments || []);
  transactions.set(data.transactions || []);
  budgets.set(data.budgets || []);
  settings.set({ ...get(settings), ...(data.settings || {}) });
  if (data.settings?.balanceCurrency) setDisplayCurrency(data.settings.balanceCurrency);
  migrateLegacy(data);
}

/** Move historic flat 'snapshots' records into the new store layout. */
function migrateLegacy(data) {
  const legacy = data.snapshots || [];
  if (!legacy.length) return;
  legacy.forEach((snap) => {
    const { type, ...rest } = snap;
    if (type === 'networth') netWorthHistory.save({ ...rest, series: rest.series || 'Net worth' });
    else if (type === 'portfolio') portfolioHistory.save({ ...rest, series: rest.series || 'Portfolio' });
    else if (type === 'pension') pensionHistory.save({ ...rest, series: rest.series || 'Pension' });
    else netWorthHistory.save(rest);
  });
}

/* ------------------------------------------------------------------ */
/* Derived views                                                      */
/* ------------------------------------------------------------------ */

/** Aggregate totals per currency across position entries. */
export const positionTotals = derived(netWorthEntries, ($entries) => {
  const totals = {};
  $entries.forEach((e) => {
    const code = e.currencyCode || 'USD';
    totals[code] = (totals[code] || 0) + (Number(e.value) || 0);
  });
  return totals;
});

export const holdingValue = (h) => (Number(h.quantity) || 0) * (Number(h.price) || 0);

export const portfolioTotal = derived(holdings, ($holdings) => {
  const totals = {};
  $holdings.forEach((h) => {
    const code = h.currencyCode || 'USD';
    totals[code] = (totals[code] || 0) + holdingValue(h);
  });
  return totals;
});
