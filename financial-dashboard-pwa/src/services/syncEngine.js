/** Offline-first sync through the application Worker. IndexedDB remains the
 * local source of truth; the Worker stores owner-scoped JSON rows in D1. */
import { writable, get } from 'svelte/store';
import {
  apiRequest,
  cloudEnabled,
  getSessionUser,
  restoreSession,
  onAuthChange
} from './appClient.js';
import {
  STORES,
  pendingRecords,
  pendingSummary,
  markSynced,
  remove as hardRemove,
  putSynced,
  get as getRow,
  clearAll
} from './indexedDB.js';
import { chunkRows, createCoalescingQueue } from './commitQueue.js';
import { createLocalOwner } from './localOwner.js';
import { requestPersistentStorage } from './dataSafety.js';

export const TABLE_MAP = Object.fromEntries(STORES.map((store) => [store, store]));
const LAST_PULL_KEY = 'fh-app-last-pull';
const localOwner = createLocalOwner();
const CLIENT_ONLY = new Set(['pending_sync', 'synced_at', '_deleted', 'table', 'owner_id', 'ownerID']);

export const syncStatus = writable(cloudEnabled ? 'Saved locally' : 'Local only');
export const syncDetail = writable('');
export const pendingCount = writable(0);
export const lastSyncedAt = writable('');
export const syncing = writable(false);

/** One request per burst instead of one per record, which keeps a burst of edits
 *  from consuming the Worker's daily request allowance. */
const COMMIT_DELAY_MS = 1_200;
/** Matches the Worker's MAX_PUSH_ROWS: a larger batch is rejected outright. */
const MAX_BATCH_ROWS = 100;

let remoteAppliedHandler = null;
let teardown = null;

export function setRemoteAppliedHandler(handler) { remoteAppliedHandler = handler; }

function queueKey(store, id) { return `${store} ${id}`; }

function cleanData(record) {
  const data = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (CLIENT_ONLY.has(key) || key === 'id' || key === 'updated_at') continue;
    data[key] = value;
  }
  return data;
}

export function toCloudRow(store, record) {
  if (!TABLE_MAP[store] || !record?.id) return null;
  return {
    store,
    id: record.id,
    updated_at: record.updated_at || new Date().toISOString(),
    deleted: record._deleted === true,
    data: cleanData(record)
  };
}

export function fromCloudRow(row) {
  return { ...(row.data || {}), id: row.id, updated_at: row.updated_at, _deleted: row.deleted === true };
}

async function refreshPending() {
  try { pendingCount.set((await pendingSummary()).total); } catch { /* preserve last count */ }
}

function setStatus(text, detail = '') { syncStatus.set(text); syncDetail.set(detail); }

export async function refreshSyncStatus() {
  const pending = (await refreshPending(), get(pendingCount));
  if (!cloudEnabled) { setStatus('Local only', 'Configure the application API to sync across devices.'); return pending; }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setStatus(pending ? `Offline · ${pending} queued` : 'Offline', 'Writes stay local and push when you are back online.');
    return pending;
  }
  const user = await getSessionUser();
  if (!user) { setStatus(pending ? `Saved locally · ${pending} pending` : 'Saved locally', 'Sign in to sync across devices.'); return pending; }
  setStatus(pending ? `Syncing ${pending}…` : 'Synced', pending ? 'Pushing queued writes in the background.' : 'All local changes are in the cloud.');
  return pending;
}

/** Reconcile one record against what the server said about it. Returns whether the
 *  local copy is now known to match the cloud. */
async function applyOutcome(store, record, outcome) {
  if (!outcome?.accepted) return false;
  if (outcome.superseded && outcome.current) {
    // The server already holds a newer version of this record. Adopt it locally
    // instead of leaving a permanently pending local write behind.
    if (outcome.current.deleted) await hardRemove(store, outcome.current.id);
    else await putSynced(store, fromCloudRow(outcome.current));
    return true;
  }
  if (record._deleted === true) await hardRemove(store, record.id);
  else await markSynced(store, record.id);
  return true;
}

/** Push a batch of rows for one store in a single request. */
async function pushStoreRows(store, entries) {
  const rows = entries.map((entry) => entry.row).filter(Boolean);
  if (!rows.length) return 0;
  const result = await apiRequest('/api/sync/push', { method: 'POST', body: { rows } });
  const outcomes = result.results || [];
  let accepted = 0;
  for (const [index, entry] of entries.entries()) {
    // The Worker answers in request order, so index lines up with the row sent.
    if (await applyOutcome(store, entry.record, outcomes[index])) accepted += 1;
    entry.resolve?.(outcomes[index]?.accepted === true);
  }
  return accepted;
}

/**
 * Send one coalesced batch. Returns a per-entry boolean aligned with `batch` so
 * the queue can settle each caller. A failure leaves pending_sync set in
 * IndexedDB, so the reconnect flush and the periodic safety net both retry it.
 */
async function flushCommitBatch(batch) {
  // Signed out means the push could only ever 401, so do not spend a request on
  // it. The rows keep pending_sync in IndexedDB and go out on the next sign-in.
  if (!(await getSessionUser())) {
    await refreshSyncStatus();
    return batch.map(() => false);
  }
  const byStore = new Map();
  batch.forEach((entry, index) => {
    if (!byStore.has(entry.store)) byStore.set(entry.store, []);
    byStore.get(entry.store).push({ entry, index });
  });
  setStatus('Syncing…', 'Uploading your latest change.');
  const settled = batch.map(() => false);
  for (const [store, group] of byStore) {
    const rows = group.map((item) => item.entry.row).filter(Boolean);
    if (!rows.length) continue;
    try {
      const result = await apiRequest('/api/sync/push', { method: 'POST', body: { rows } });
      const outcomes = result.results || [];
      // The Worker answers in request order, so the index lines up with the row sent.
      for (const [position, item] of group.entries()) {
        if (await applyOutcome(store, item.entry.record, outcomes[position])) settled[item.index] = true;
      }
    } catch { /* leave these rows pending for the next attempt */ }
  }
  await refreshSyncStatus();
  return settled;
}

const commitQueue = createCoalescingQueue({ delay: COMMIT_DELAY_MS, onFlush: flushCommitBatch });

/** Flush anything still sitting in the coalescing queue right now. */
export async function commitNow() {
  commitQueue.cancel();
  return commitQueue.drain();
}

export function syncRecord(store, record) {
  if (!cloudEnabled) return Promise.resolve(false);
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    // The row is already durable in IndexedDB with pending_sync set, so the
    // reconnect flush picks it up. Holding it in memory as well would only
    // grow without bound while the tab sits offline.
    refreshSyncStatus();
    return Promise.resolve(false);
  }
  const row = toCloudRow(store, record);
  if (!row) return Promise.resolve(false);
  return new Promise((resolve) => {
    // A newer edit for the same record replaces the queued one; the queue settles
    // the superseded promise as not-committed so nobody is left awaiting it.
    commitQueue.set(queueKey(store, row.id), { store, record, row, resolve });
  });
}

export async function flushPending({ all = false } = {}) {
  if (!cloudEnabled) return { pushed: 0, failed: 0, skipped: true };
  if (typeof navigator !== 'undefined' && !navigator.onLine) { await refreshSyncStatus(); return { pushed: 0, failed: 0, skipped: true }; }
  const user = await getSessionUser();
  if (!user) { await refreshSyncStatus(); return { pushed: 0, failed: 0, skipped: true }; }
  // Anything already queued in memory is newer than the local pending flag, so
  // commit it first and let the queue below carry only what IndexedDB still
  // reports as unsynced.
  await commitNow();
  syncing.set(true);
  let pushed = 0;
  let failed = 0;
  try {
    for (const store of STORES) {
      const queue = await pendingRecords(store, { all });
      if (!queue.length) continue;
      const entries = queue
        .map((record) => ({ store, record, row: toCloudRow(store, record) }))
        .filter((entry) => entry.row);
      for (const batch of chunkRows(entries, MAX_BATCH_ROWS)) {
        try {
          pushed += await pushStoreRows(store, batch);
        } catch {
          failed += batch.length;
        }
      }
      failed += Math.max(0, queue.length - entries.length);
    }
  } finally {
    syncing.set(false);
  }
  lastSyncedAt.set(new Date().toISOString());
  await refreshSyncStatus();
  return { pushed, failed };
}

/* ------------------------------------------------------------------ */
/* Local data ownership                                                */
/* ------------------------------------------------------------------ */

/** Empty the device when it turns out to hold a different account's rows. */
async function clearLocalStores() {
  await commitNow();
  commitQueue.cancel();
  await clearAll();
  resetPullCursor();
}

function readPullCursor() {
  try {
    const raw = localStorage.getItem(LAST_PULL_KEY);
    if (!raw) return { cursor: null, until: '' };
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { cursor: null, until: '' };
    return { cursor: parsed.cursor || null, until: String(parsed.until || '') };
  } catch {
    return { cursor: null, until: '' };
  }
}

function writePullCursor(cursor, until) {
  try { localStorage.setItem(LAST_PULL_KEY, JSON.stringify({ cursor, until })); } catch { /* storage may be disabled */ }
}

export function resetPullCursor() {
  try { localStorage.removeItem(LAST_PULL_KEY); } catch { /* ignore */ }
}

async function pullPage(cursor, until) {
  const params = new URLSearchParams();
  if (until) params.set('until', until);
  if (cursor) {
    params.set('after', cursor.updatedAt);
    params.set('afterStore', cursor.store);
    params.set('afterId', cursor.id);
  }
  const query = params.toString();
  return apiRequest(`/api/sync/pull${query ? `?${query}` : ''}`);
}

export async function pullRemote({ full = false, apply = true } = {}) {
  if (!cloudEnabled) return { pulled: 0, skipped: true, errors: [] };
  if (typeof navigator !== 'undefined' && !navigator.onLine) return { pulled: 0, skipped: true, errors: [] };
  const user = await getSessionUser();
  if (!user) return { pulled: 0, skipped: true, errors: [] };
  const errors = [];
  let pulled = 0;
  let { cursor, until } = full ? { cursor: null, until: '' } : readPullCursor();
  syncing.set(true);
  setStatus('Syncing…', 'Checking for cloud changes.');
  try {
    for (let page = 0; page < 200; page += 1) {
      const result = await pullPage(cursor, until);
      until = result.serverTime || until;
      for (const row of result.rows || []) {
        const local = await getRow(row.store, row.id);
        if (local?.pending_sync) continue;
        if (local && String(local.updated_at || '') > String(row.updated_at || '')) continue;
        if (row.deleted) await hardRemove(row.store, row.id);
        else await putSynced(row.store, fromCloudRow(row));
        pulled += 1;
      }
      cursor = result.nextCursor || cursor;
      if (!result.hasMore) break;
    }
  } catch (error) {
    errors.push(error.message);
    setStatus('Sync error', error.message);
  } finally {
    syncing.set(false);
  }
  if (!errors.length) writePullCursor(cursor, until);
  if (apply && pulled && remoteAppliedHandler) await remoteAppliedHandler();
  await refreshPending();
  return { pulled, errors };
}

export async function syncNow() {
  const push = await flushPending({ all: true });
  const pull = await pullRemote();
  if (remoteAppliedHandler) await remoteAppliedHandler();
  await refreshSyncStatus();
  return { ...push, pulled: pull.pulled };
}

export async function initSyncEngine() {
  if (teardown) return teardown;
  await restoreSession();
  // Best effort, and deliberately not awaited into the boot path: this is a hint
  // to the browser, not something the user is waiting on, and a refusal is normal.
  requestPersistentStorage().catch(() => {});
  await refreshPending();
  if (!cloudEnabled) {
    setStatus('Local only', 'Configure the application API to sync across devices.');
    return () => {};
  }
  const onlineHandler = () => { refreshSyncStatus(); flushPending().then(() => pullRemote()).catch(() => {}); };
  const offlineHandler = () => refreshSyncStatus();
  // A tab that is closed or backgrounded may never run its debounce timer, so
  // commit whatever is outstanding at that moment instead of losing the window.
  const pageHideHandler = () => { commitNow().catch(() => {}); };
  const visibilityHandler = () => { if (document.visibilityState === 'hidden') pageHideHandler(); };
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
    window.addEventListener('pagehide', pageHideHandler);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', visibilityHandler);
  }
  const unsubscribe = onAuthChange(async (_event, user) => {
    if (!user) {
      // The local-owner marker is deliberately kept across sign-out. Forgetting
      // it here is precisely the bug that let one account's rows reach another:
      // the next sign-in would find an empty marker, conclude the local data was
      // unowned, keep it, and flush the previous account's pending rows into
      // whichever account arrived. Keep the marker, and let the comparison below
      // decide. Same account signing back in matches, so nothing is cleared.
      refreshSyncStatus();
      return;
    }
    if (!localOwner.claim(user.id)) {
      // Must happen before the flush: clearing afterwards still pushes the old
      // rows up on this session, where the server cannot tell them apart.
      console.warn('Local data belonged to a different account; clearing it before syncing');
      await clearLocalStores();
    }
    await flushPending();
    await pullRemote();
  });
  // Safety net only. It costs nothing while idle because the flush below bails
  // out before any request when no row is pending.
  const interval = setInterval(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) flushPending().catch(() => {});
  }, 60_000);
  teardown = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
      window.removeEventListener('pagehide', pageHideHandler);
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler);
    }
    unsubscribe?.();
    clearInterval(interval);
    commitQueue.cancel();
    teardown = null;
  };
  const user = await getSessionUser();
  if (user) flushPending().then(() => pullRemote()).catch(() => {});
  else await refreshSyncStatus();
  return teardown;
}

export function teardownSyncEngine() { teardown?.(); }

