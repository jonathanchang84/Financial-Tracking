/**
 * IndexedDB service — full schema compatibility with the historic
 * 'financial-health-local' database (Version 2).
 *
 * Object stores (historic): settings, transactions, budgets, accounts, snapshots
 * Extended stores for the Svelte app: netWorthEntries, netWorthHistory,
 * holdings, portfolioHistory, pensions, pensionHistory, bills, commitments.
 * The legacy 'snapshots' store is retained for backup restore compatibility.
 */

export const DB_NAME = 'financial-health-local';
export const DB_VERSION = 2;

export const STORES = [
  'settings',
  'transactions',
  'budgets',
  'accounts',
  'snapshots',
  'netWorthEntries',
  'netWorthHistory',
  'holdings',
  'portfolioHistory',
  'pensions',
  'pensionHistory',
  'bills',
  'commitments'
];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      const existing = Array.from(db.objectStoreNames);
      STORES.forEach((store) => {
        if (!existing.includes(store)) db.createObjectStore(store, { keyPath: 'id' });
      });
      // Historic settings store is keyed by key name in v1; keep id keyPath for v2 records.
      if (event.oldVersion < 2) {
        STORES.forEach((store) => {
          if (db.objectStoreNames.contains(store) && store === 'settings') {
            const os = request.transaction.objectStore(store);
            if (!os.indexNames.contains('by_key')) os.createIndex('by_key', 'key', { unique: true });
          }
        });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
  return dbPromise;
}

function tx(db, store, mode = 'readonly') {
  return db.transaction(store, mode).objectStore(store);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function put(store, record) {
  const db = await openDB();
  const payload = { ...record, pending_sync: true, updated_at: new Date().toISOString() };
  await wrap(tx(db, store, 'readwrite').put(payload));
  return payload;
}

export async function get(store, id) {
  const db = await openDB();
  return wrap(tx(db, store).get(id));
}

export async function getAll(store) {
  const db = await openDB();
  return wrap(tx(db, store).getAll());
}

export async function remove(store, id) {
  const db = await openDB();
  await wrap(tx(db, store, 'readwrite').delete(id));
}

export async function clearStore(store) {
  const db = await openDB();
  await wrap(tx(db, store, 'readwrite').clear());
}

export async function loadAll() {
  const data = {};
  for (const store of STORES) {
    data[store] = await getAll(store);
  }
  // Historic shape: settings array -> object keyed by key.
  if (Array.isArray(data.settings)) {
    data.settings = Object.fromEntries(data.settings.map((item) => [item.key, item.value]));
  } else {
    data.settings = {};
  }
  return data;
}

/** Records flagged pending_sync (or all when [all] is true) for the sync engine. */
export async function pendingRecords(store, all = false) {
  const rows = await getAll(store);
  return all ? rows : rows.filter((row) => row.pending_sync === true);
}

export async function markSynced(store, id) {
  const db = await openDB();
  const os = tx(db, store, 'readwrite');
  const record = await wrap(os.get(id));
  if (record) {
    record.pending_sync = false;
    record.synced_at = new Date().toISOString();
    await wrap(os.put(record));
  }
}
