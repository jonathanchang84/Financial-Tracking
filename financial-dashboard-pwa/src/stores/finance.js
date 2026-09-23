/**
 * Global reactive state.
 *
 *  - `displayCurrency` drives every screen's formatting and uses the historic
 *    fixed-rate exchange math (`RATES`), so figures never change between views.
 *  - Unified entity stores mirror the IndexedDB stores 1:1. Reads are synchronous
 *    once hydrated; writes go to IndexedDB first and sync in the background.
 */

import { writable, derived, get } from 'svelte/store';
import {
  loadAll,
  getAll,
  put,
  putMany,
  softRemove,
  clearAll,
  writeSetting,
  readSetting,
  STORES
} from '../services/indexedDB.js';
import { newId } from '../services/recordHelpers.js';
import { num, currencyOf, seriesNameOf } from '../services/runway.js';
import { dayKey, addDaysKey } from '../services/dates.js';
import { syncRecord, setRemoteAppliedHandler, refreshSyncStatus } from '../services/syncEngine.js';

/* ------------------------------------------------------------------ */
/* Currency — historic fixed rates                                     */
/* ------------------------------------------------------------------ */

/** Fixed rates from the prototype's `exchangeRates` table. */
export const RATES = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  CAD: 1.36,
  AUD: 1.53,
  JPY: 149.5,
  CHF: 0.88,
  CNY: 7.24,
  INR: 83.12,
  PLN: 4.0
};

export const CURRENCY_NAMES = {
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  JPY: 'Japanese Yen',
  CHF: 'Swiss Franc',
  CNY: 'Chinese Yuan',
  INR: 'Indian Rupee',
  PLN: 'Polish Złoty'
};

export const CURRENCIES = Object.keys(RATES);

/** `USD 100` -> `92 EUR` style conversion between any two supported codes. */
export function convertCurrency(amount, from = 'USD', to = 'USD') {
  const value = num(amount);
  if (from === to) return value;
  const fromRate = RATES[from] || 1;
  const toRate = RATES[to] || 1;
  return (value / fromRate) * toRate;
}

/** Historic formatter: narrow symbols, whole units shown without decimals. */
export function money(value, currency = 'USD') {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} 0.00`;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Selected display currency for every dashboard. */
export const displayCurrency = writable('USD');

export function setDisplayCurrency(code) {
  if (RATES[code]) displayCurrency.set(code);
}

/** Convert `amount` from `fromCode` into the active display currency. */
export function convertToDisplay(amount, fromCode = 'USD') {
  return convertCurrency(amount, fromCode, get(displayCurrency));
}

/** Convert + format in the active display currency (single UI entry point). */
export function displayMoney(amount, fromCode = 'USD') {
  const to = get(displayCurrency);
  return money(convertCurrency(amount, fromCode, to), to);
}

/** Sum records of mixed currencies into one figure in the display currency. */
export function sumInDisplay(rows = [], valueOf = (row) => num(row.value)) {
  return rows.reduce((sum, row) => sum + convertCurrency(valueOf(row), currencyOf(row), get(displayCurrency)), 0);
}


/* ------------------------------------------------------------------ */
/* Unified reactive entity arrays                                      */
/* ------------------------------------------------------------------ */

const HISTORY_STORES = new Set(['netWorthHistory', 'portfolioHistory', 'pensionHistory', 'snapshots']);

/** Deterministic in-memory ordering so the UI never reshuffles between renders. */
function sortRows(storeName, rows) {
  const list = [...rows];
  if (HISTORY_STORES.has(storeName)) {
    return list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }
  if (storeName === 'bills') {
    return list.sort((a, b) => num(a.dueDay) - num(b.dueDay) || String(a.name || '').localeCompare(String(b.name || '')));
  }
  if (storeName === 'commitments' || storeName === 'transactions') {
    return list.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  }
  return list.sort((a, b) =>
    String(a.name || a.series || a.key || a.id || '').localeCompare(String(b.name || b.series || b.key || b.id || ''))
  );
}

function upsertRow(rows, record) {
  const index = rows.findIndex((row) => row.id === record.id);
  if (index < 0) return [...rows, record];
  const next = [...rows];
  next[index] = record;
  return next;
}

/**
 * Create a store for one IndexedDB object store.
 * `save` writes locally first (instant UI) then fires a background cloud upsert.
 */
function entityStore(name) {
  const { subscribe, set, update } = writable([]);

  return {
    name,
    subscribe,
    set,
    update,
    /** Cold-boot hydrate. */
    async init() {
      const rows = sortRows(name, await getAll(name));
      set(rows);
      return rows;
    },
    /** Alias used by the backup/restore flow. */
    async reload() {
      return this.init();
    },
    async save(record) {
      const next = { ...record, id: record.id || newId() };
      const saved = await put(name, next);
      update((rows) => sortRows(name, upsertRow(rows, saved)));
      syncRecord(name, saved);
      return saved;
    },
    /** Batch write used by SCD Type 2 plans and the backup importer. */
    async saveMany(records = []) {
      if (!records.length) return [];
      const saved = await putMany(
        name,
        records.map((record) => ({ ...record, id: record.id || newId() }))
      );
      update((rows) => sortRows(name, saved.reduce((acc, row) => upsertRow(acc, row), rows)));
      saved.forEach((row) => syncRecord(name, row));
      return saved;
    },
    /** Delete locally + queue the cloud delete (tombstone lives in IndexedDB). */
    async remove(id) {
      const tombstone = await softRemove(name, id);
      update((rows) => rows.filter((row) => row.id !== id));
      if (tombstone) syncRecord(name, tombstone);
      return tombstone;
    },
    /** Patch without a cloud round trip (used to close SCD2 versions). */
    async patch(id, changes) {
      const existing = (await getAll(name)).find((row) => row.id === id);
      if (!existing) return null;
      const saved = await put(name, { ...existing, ...changes });
      update((rows) => sortRows(name, upsertRow(rows, saved)));
      syncRecord(name, saved);
      return saved;
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
export const accounts = entityStore('accounts');
export const snapshots = entityStore('snapshots');

export const ENTITY_STORES = {
  netWorthEntries,
  netWorthHistory,
  holdings,
  portfolioHistory,
  pensions,
  pensionHistory,
  bills,
  commitments,
  transactions,
  budgets,
  accounts,
  snapshots
};

/** Every entity store plus the settings store, keyed by store name. */
export function storesByName() {
  return ENTITY_STORES;
}

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_SETTINGS = {
  balance: 0,
  balanceCurrency: 'USD',
  payday: '',
  portfolioGrowth: 0.05,
  pensionGrowth: 0.05,
  theme: 'light'
};

export const settings = writable({ ...DEFAULT_SETTINGS });

export async function saveSetting(key, value) {
  await writeSetting(key, value);
  settings.update((current) => ({ ...current, [key]: value }));
  syncRecord('settings', { id: key, key, value });
  return value;
}

export async function saveSettings(entries = {}) {
  for (const [key, value] of Object.entries(entries)) {
    await saveSetting(key, value);
  }
  return get(settings);
}

export async function loadSetting(key, fallback = undefined) {
  return readSetting(key, fallback);
}

/** Balance + payday figures shared by Overview and Cash flow. */
export const cashSettings = derived(settings, ($settings) => ({
  balance: num($settings.balance),
  currency: $settings.balanceCurrency || $settings.currentBalanceCurrencyCode || 'USD',
  payday: $settings.payday || $settings.nextPayDate || ''
}));

/* ------------------------------------------------------------------ */
/* Derived views                                                      */
/* ------------------------------------------------------------------ */

/** Liabilities subtract from net worth (historic `currentTotals`). */
export function signedValue(row) {
  return String(row?.kind || '').toLowerCase() === 'liability' ? -num(row.value) : num(row.value);
}

export function holdingValue(holding) {
  return num(holding.quantity) * num(holding.price);
}

export function totalsByCurrency(rows = [], valueOf = (row) => num(row.value)) {
  return rows.reduce((totals, row) => {
    const code = currencyOf(row);
    totals[code] = (totals[code] || 0) + num(valueOf(row));
    return totals;
  }, {});
}

/** `{ USD: 1234, GBP: 500 }` net position per currency (liabilities negative). */
export const positionTotals = derived(netWorthEntries, ($rows) => totalsByCurrency($rows, signedValue));

/** Same shape for holdings (quantity × price) and pension pots. */
export const portfolioTotals = derived(holdings, ($rows) => totalsByCurrency($rows, holdingValue));
export const pensionTotals = derived(pensions, ($rows) => totalsByCurrency($rows, (row) => num(row.value)));

/** Scalar headline figures, already converted into the display currency. */
export const netWorthTotal = derived([netWorthEntries, displayCurrency], ([$rows]) => sumInDisplay($rows, signedValue));
export const investmentsTotal = derived([holdings, displayCurrency], ([$rows]) => sumInDisplay($rows, holdingValue));
export const pensionsTotal = derived([pensions, displayCurrency], ([$rows]) =>
  sumInDisplay($rows, (row) => num(row.value))
);
export const expensesLogged = derived([transactions, displayCurrency], ([$rows]) =>
  sumInDisplay(
    $rows.filter((row) => row.type === 'expense'),
    (row) => num(row.amount)
  )
);
export const availableBalance = derived([settings, displayCurrency], ([$settings]) =>
  convertCurrency(num($settings.balance), $settings.balanceCurrency || 'USD', get(displayCurrency))
);

/* ------------------------------------------------------------------ */
/* Boot + legacy migration                                            */
/* ------------------------------------------------------------------ */

function hydrate(data) {
  Object.entries(ENTITY_STORES).forEach(([name, store]) => {
    store.set(sortRows(name, data[name] || []));
  });
  settings.set({ ...DEFAULT_SETTINGS, ...(data.settings || {}) });
  const code = get(settings).balanceCurrency;
  if (RATES[code]) displayCurrency.set(code);
}

/** Give migrated snapshots a valid SCD Type 2 chain (latest version open). */
function chainLegacyVersions(rows = []) {
  const chains = new Map();
  rows.forEach((row) => {
    const key = `${row.series}::${row.currencyCode}`;
    if (!chains.has(key)) chains.set(key, []);
    chains.get(key).push(row);
  });
  chains.forEach((list) => {
    list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const logicalId = list[0].id;
    list.forEach((row, index) => {
      const isLatest = index === list.length - 1;
      row.logicalId = logicalId;
      row.validFrom = row.date;
      row.validTo = isLatest ? null : dayKey(addDaysKey(list[index + 1].date, -1));
      row.currentFlag = isLatest;
    });
  });
  return rows;
}

/**
 * Move historic flat `snapshots` rows into the iOS-aligned stores.
 *
 * Persisted (the prototype only mutated memory) and idempotent: history rows
 * keep their original ids, account/pot/holding rows are guarded by name +
 * currency, and expense transactions are copied into commitments by id.
 */
export async function migrateLegacy(data) {
  const legacy = (data.snapshots || []).filter((snapshot) => snapshot && snapshot.type);
  const entryWrites = { netWorthEntries: [], holdings: [], pensions: [] };
  const historyWrites = { netWorthHistory: [], portfolioHistory: [], pensionHistory: [] };
  const commitmentWrites = [];

  const seriesOf = (snapshot) => String(snapshot.series || snapshot.symbol || snapshot.name || '').trim();
  const hasEntry = (rows, name, currency) =>
    rows.some((row) => seriesNameOf(row) === name && currencyOf(row) === currency);

  legacy.forEach((snapshot) => {
    const currency = currencyOf(snapshot);
    const value = num(snapshot.value);
    const date = dayKey(snapshot.date) || dayKey(new Date());
    const id = snapshot.id || newId();

    if (snapshot.type === 'networth') {
      const name = seriesOf(snapshot) || 'Account';
      if (!hasEntry(data.netWorthEntries || [], name, currency) && !hasEntry(entryWrites.netWorthEntries, name, currency)) {
        entryWrites.netWorthEntries.push({
          id: newId(),
          name,
          institution: '',
          kind: 'Asset',
          value,
          currencyCode: currency,
          validFrom: date,
          validTo: null,
          currentFlag: true
        });
      }
      historyWrites.netWorthHistory.push({ id, series: name, date, value, currencyCode: currency });
    } else if (snapshot.type === 'portfolio') {
      const name = seriesOf(snapshot) || 'Fund';
      if (!hasEntry(data.holdings || [], name, currency) && !hasEntry(entryWrites.holdings, name, currency)) {
        entryWrites.holdings.push({
          id: newId(),
          name,
          symbol: name,
          type: 'Fund',
          quantity: 1,
          price: value,
          currencyCode: currency
        });
      }
      historyWrites.portfolioHistory.push({ id, series: name, date, value, currencyCode: currency });
    } else if (snapshot.type === 'pension') {
      const name = seriesOf(snapshot) || 'Pension pot';
      if (!hasEntry(data.pensions || [], name, currency) && !hasEntry(entryWrites.pensions, name, currency)) {
        entryWrites.pensions.push({ id: newId(), name, provider: '', value, currencyCode: currency });
      }
      historyWrites.pensionHistory.push({ id, series: name, date, value, currencyCode: currency });
    }
  });

  (data.transactions || [])
    .filter((transaction) => transaction.type === 'expense')
    .forEach((transaction) => {
      if ((data.commitments || []).some((commitment) => commitment.id === transaction.id)) return;
      commitmentWrites.push({
        id: transaction.id || newId(),
        name: transaction.name || transaction.category || 'Commitment',
        date: dayKey(transaction.date) || dayKey(new Date()),
        amount: num(transaction.amount),
        currencyCode: currencyOf(transaction)
      });
    });

  let migrated = 0;

  for (const [store, rows] of Object.entries(historyWrites)) {
    if (!rows.length) continue;
    const gone = new Set((data[store] || []).map((row) => row.id));
    const fresh = chainLegacyVersions(rows.filter((row) => !gone.has(row.id)));
    if (fresh.length) {
      await putMany(store, fresh);
      migrated += fresh.length;
    }
  }

  for (const [store, rows] of Object.entries(entryWrites)) {
    if (!rows.length) continue;
    await putMany(store, rows);
    migrated += rows.length;
  }

  if (commitmentWrites.length) {
    await putMany('commitments', commitmentWrites);
    migrated += commitmentWrites.length;
  }

  return migrated;
}

/** Cold boot: read IndexedDB, migrate legacy rows, hydrate every store. */
export async function initStores() {
  const data = await loadAll();
  const migrated = await migrateLegacy(data);
  hydrate(migrated > 0 ? await loadAll() : data);
  setRemoteAppliedHandler(async () => {
    hydrate(await loadAll());
  });
  await refreshSyncStatus();
  return { migrated };
}

/** Re-read every store from IndexedDB (after a pull, restore, or import). */
export async function reloadStores() {
  hydrate(await loadAll());
  return get(settings);
}

/** Historic alias. */
export const bootstrapStores = initStores;

/** Wipe every local store (used before restoring a backup). */
export async function resetLocalData() {
  await clearAll();
  hydrate({ settings: { ...DEFAULT_SETTINGS } });
}

/** Store names understood by the backup importer. */
export { STORES };
