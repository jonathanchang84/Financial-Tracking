import * as db from './indexedDB.js';
import { syncRecord } from './syncEngine.js';
import * as finance from '../stores/finance.js';

function entity(storeName) {
  return finance[storeName];
}

async function refresh(storeName) {
  const store = entity(storeName);
  if (store) {
    for (const method of ['reload', 'load', 'refresh']) {
      if (typeof store[method] === 'function') return store[method]();
    }
    if (typeof store.set === 'function' && typeof db.getAll === 'function') {
      store.set(await db.getAll(storeName));
      return;
    }
  }
  if (typeof finance.bootstrapStores === 'function') return finance.bootstrapStores();
}

export function newId() {
  return crypto.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** IndexedDB first, then background cloud upsert via the sync engine. */
export async function saveRecord(storeName, record) {
  const next = { ...record, id: record.id || newId() };
  const store = entity(storeName);
  if (store) {
    for (const method of ['upsert', 'save', 'put']) {
      if (typeof store[method] === 'function') return (await store[method](next)) ?? next;
    }
    if (!record.id && typeof store.add === 'function') return (await store.add(next)) ?? next;
    if (record.id && typeof store.update === 'function') return (await store.update(next)) ?? next;
  }
  try {
    const saved = await syncRecord(storeName, { ...next, pending_sync: true });
    await refresh(storeName);
    return saved ?? next;
  } catch {
    if (typeof db.put === 'function') await db.put(storeName, { ...next, pending_sync: true });
    await refresh(storeName);
    return { ...next, pending_sync: true };
  }
}

export async function deleteRecord(storeName, id) {
  const store = entity(storeName);
  if (store) {
    for (const method of ['remove', 'delete', 'destroy']) {
      if (typeof store[method] === 'function') return store[method](id);
    }
  }
  if (typeof db.remove === 'function') await db.remove(storeName, id);
  await refresh(storeName);
}
