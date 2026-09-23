/**
 * IndexedDB service.
 *
 * Full schema compatibility with the historic `financial-health-local`
 * database (Version 2) created by `pwa/app.js` and the native app's
 * `AppDataStore`, so a device that already ran the prototype keeps its data.
 *
 * Deletes are *tombstoned* rather than dropped: the row stays in IndexedDB with
 * `_deleted: true` + `pending_sync: true` so the sync engine can delete the
 * matching cloud row, then hard-delete locally. Reads filter tombstones out.
 */

export const DB_NAME = 'financial-health-local';
export const DB_VERSION = 2;

/** Exact historic store list (order preserved for readable diagnostics). */
export const STORES = [
  'settings',
  'bills',
  'commitments',
  'netWorthEntries',
  'netWorthHistory',
  'holdings',
  'portfolioHistory',
  'pensions',
  'pensionHistory',
  'transactions',
  'budgets',
  'accounts',
  'snapshots'
];

export const SETTINGS_STORE = 'settings';

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      STORES.forEach((store) => {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' });
      });
    };
    request.onsuccess = () => {
      const db = request.result;
      // A newer tab upgraded the schema: close this handle so it can proceed.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  }).catch((error) => {
    dbPromise = null;
    throw error;
  });
  return dbPromise;
}

/** Close the cached handle (used by tests and by the restore flow). */
export function closeDB() {
  const pending = dbPromise;
  dbPromise = null;
  return pending?.then((db) => db.close()).catch(() => {});
}

/** Await transaction *completion* so a resolved write is durable. */
function run(db, storeNames, mode, work) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let settled = false;
    let result;
    tx.oncomplete = () => {
      settled = true;
      resolve(result);
    };
    tx.onerror = () => {
      if (!settled) reject(tx.error || new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      if (!settled) reject(tx.error || new Error('IndexedDB transaction aborted'));
    };
    try {
      const request = work(tx);
      if (request) request.onsuccess = () => (result = request.result);
    } catch (error) {
      try {
        tx.abort();
      } catch {
        /* ignore */
      }
      reject(error);
    }
  });
}

function visible(row, includeDeleted) {
  return includeDeleted ? true : row?._deleted !== true;
}

/** Create or replace a record locally. Every write is flagged for cloud sync. */
export async function put(store, record) {
  const db = await openDB();
  const payload = {
    ...record,
    pending_sync: true,
    updated_at: new Date().toISOString(),
    _deleted: record._deleted === true
  };
  await run(db, store, 'readwrite', (tx) => tx.objectStore(store).put(payload));
  return payload;
}

export async function putMany(store, records = []) {
  if (!records.length) return [];
  const db = await openDB();
  const stamp = new Date().toISOString();
  const payloads = records.map((record) => ({
    ...record,
    pending_sync: record.pending_sync === false ? false : true,
    updated_at: record.updated_at || stamp,
    _deleted: record._deleted === true
  }));
  await run(db, store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    payloads.forEach((payload) => os.put(payload));
    return null;
  });
  return payloads;
}

/** Write without touching the pending flag — reserved for inbound cloud sync. */
export async function putSynced(store, record) {
  const db = await openDB();
  const payload = {
    ...record,
    pending_sync: false,
    _deleted: false,
    synced_at: new Date().toISOString()
  };
  await run(db, store, 'readwrite', (tx) => tx.objectStore(store).put(payload));
  return payload;
}

export async function get(store, id) {
  const db = await openDB();
  return run(db, store, 'readonly', (tx) => tx.objectStore(store).get(id));
}

export async function getAll(store, { includeDeleted = false } = {}) {
  const db = await openDB();
  const rows = (await run(db, store, 'readonly', (tx) => tx.objectStore(store).getAll())) || [];
  return rows.filter((row) => visible(row, includeDeleted));
}

/** Every store read in one transaction (fastest cold-boot path). */
export async function getAllAcross(storeNames = STORES, { includeDeleted = false } = {}) {
  const db = await openDB();
  const buckets = storeNames.map(() => []);
  await run(db, storeNames, 'readonly', (tx) => {
    storeNames.forEach((name, index) => {
      const request = tx.objectStore(name).getAll();
      request.onsuccess = () => {
        buckets[index] = request.result || [];
      };
    });
    return null;
  });
  const output = {};
  storeNames.forEach((name, index) => {
    output[name] = buckets[index].filter((row) => visible(row, includeDeleted));
  });
  return output;
}

/** Hard delete (post-sync cleanup, or a user clearing their data). */
export async function remove(store, id) {
  const db = await openDB();
  await run(db, store, 'readwrite', (tx) => tx.objectStore(store).delete(id));
}

/** Soft delete: keeps a tombstone so the cloud row can be deleted too. */
export async function softRemove(store, id) {
  const existing = await get(store, id);
  if (!existing) return null;
  return put(store, { ...existing, _deleted: true });
}

export async function clearStore(store) {
  const db = await openDB();
  await run(db, store, 'readwrite', (tx) => tx.objectStore(store).clear());
}

export async function clearAll() {
  for (const store of STORES) await clearStore(store);
}

/** Bulk read of every store, with settings normalised to `{ key: value }`. */
export async function loadAll({ includeDeleted = false } = {}) {
  const raw = await getAllAcross(STORES, { includeDeleted });
  const data = { ...raw };
  data.settings = Object.fromEntries(
    (raw[SETTINGS_STORE] || []).map((item) => [item.key || item.id, item.value])
  );
  return data;
}

export async function readSetting(key, fallback = undefined) {
  const row = await get(SETTINGS_STORE, key);
  return row?.value ?? fallback;
}

export async function writeSetting(key, value) {
  return put(SETTINGS_STORE, { id: key, key, value });
}

export async function pendingRecords(store, { all = false } = {}) {
  const rows = await getAll(store, { includeDeleted: true });
  return all ? rows : rows.filter((row) => row.pending_sync === true);
}

export async function pendingSummary() {
  const summary = {};
  let total = 0;
  for (const store of STORES) {
    const count = (await pendingRecords(store)).length;
    if (count) summary[store] = count;
    total += count;
  }
  return { total, byStore: summary };
}

export async function markSynced(store, id) {
  const db = await openDB();
  await run(db, store, 'readwrite', (tx) => {
    const os = tx.objectStore(store);
    const request = os.get(id);
    request.onsuccess = () => {
      const record = request.result;
      if (record) os.put({ ...record, pending_sync: false, synced_at: new Date().toISOString() });
    };
    return null;
  });
}
