/**
 * Non-blocking Sync Engine.
 *
 * Guarantees:
 *  1. Every write commits to IndexedDB first — the UI never waits on a network
 *     round trip, and `navigator.onLine === false` is a normal state.
 *  2. When online *and* signed in, the row is upserted to Supabase in the
 *     background with `owner_id = auth.uid()`.
 *  3. Offline writes keep `pending_sync: true` and are flushed automatically on
 *     `online`, on sign-in, and on a slow interval.
 *  4. Remote rows are pulled back (last-write-wins by `updated_at`) without ever
 *     clobbering a local row that still has unpushed changes.
 *
 * Mutable assets keep SCD Type 2 columns (`valid_from`, `valid_to`,
 * `current_flag`, `logical_id`) so historical valuations are append-only.
 */

import { writable, get } from 'svelte/store';
import {
  supabase,
  cloudEnabled,
  getSessionUser,
  hasConfirmedSession,
  restoreSession,
  onAuthChange
} from './supabaseClient.js';
import {
  STORES,
  pendingRecords,
  pendingSummary,
  markSynced,
  remove as hardRemove,
  putSynced,
  get as getRow
} from './indexedDB.js';

/** Local store name -> Supabase table. */
export const TABLE_MAP = {
  settings: 'settings',
  bills: 'bills',
  commitments: 'commitments',
  netWorthEntries: 'net_worth_entries',
  netWorthHistory: 'net_worth_history',
  holdings: 'holdings',
  portfolioHistory: 'portfolio_history',
  pensions: 'pensions',
  pensionHistory: 'pension_history',
  transactions: 'transactions',
  budgets: 'budgets',
  accounts: 'accounts',
  snapshots: 'snapshots'
};

/** Tables whose primary key is not just `id` (settings is per-owner). */
const CONFLICT_TARGET = { settings: 'owner_id,id' };

/** camelCase local field -> snake_case Postgres column. */
const COLUMN_MAP = {
  ownerID: 'owner_id',
  currencyCode: 'currency_code',
  currency: 'currency_code',
  dueDay: 'due_day',
  validFrom: 'valid_from',
  validTo: 'valid_to',
  currentFlag: 'current_flag',
  logicalId: 'logical_id'
};

const CLOUD_TO_LOCAL = Object.entries(COLUMN_MAP).reduce((acc, [local, cloud]) => {
  if (!acc[cloud]) acc[cloud] = local;
  return acc;
}, {});

/** Never sent to Postgres. */
const CLIENT_ONLY = new Set(['pending_sync', 'synced_at', '_deleted', 'table']);

const LAST_PULL_KEY = 'fh-cloud-last-pull';

/** 'Local only' | 'Offline · saving locally' | 'Saved locally' | 'Syncing…' | 'Synced' | 'Sync error' */
export const syncStatus = writable(cloudEnabled ? 'Saved locally' : 'Local only');
export const syncDetail = writable('');
export const pendingCount = writable(0);
export const lastSyncedAt = writable('');
export const syncing = writable(false);

let flushing = false;
let remoteAppliedHandler = null;
let teardown = null;

/** Register the callback the stores use to reload after an inbound sync. */
export function setRemoteAppliedHandler(handler) {
  remoteAppliedHandler = handler;
}

export function toCloudRow(store, record, ownerId) {
  const table = TABLE_MAP[store];
  if (!table || !record?.id || !ownerId) return null;
  const row = {
    id: record.id,
    owner_id: ownerId,
    updated_at: record.updated_at || new Date().toISOString()
  };
  Object.entries(record).forEach(([key, value]) => {
    if (CLIENT_ONLY.has(key)) return;
    if (key === 'id' || key === 'owner_id' || key === 'ownerID' || key === 'updated_at') return;
    const column = COLUMN_MAP[key] || key;
    row[column] = value === '' ? null : value;
  });
  return row;
}

export function fromCloudRow(row) {
  const local = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (key === 'owner_id') return;
    local[CLOUD_TO_LOCAL[key] || key] = value;
  });
  local.pending_sync = false;
  local.updated_at = row?.updated_at || new Date().toISOString();
  return local;
}


/* ---------------------------------------------------------------- */
/* Status bookkeeping                                               */
/* ---------------------------------------------------------------- */

async function refreshPending() {
  try {
    const { total } = await pendingSummary();
    pendingCount.set(total);
    return total;
  } catch {
    return get(pendingCount);
  }
}

function setStatus(text, detail = '') {
  syncStatus.set(text);
  syncDetail.set(detail);
}

/** Recompute the header badge from device connectivity + session state. */
export async function refreshSyncStatus() {
  const pending = await refreshPending();
  if (!cloudEnabled) {
    setStatus('Local only', 'Add Supabase keys to sync across devices.');
    return pending;
  }
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  const user = await getSessionUser();
  if (!user) {
    setStatus(pending ? `Saved locally · ${pending} pending` : 'Saved locally', 'Sign in to sync across devices.');
    return pending;
  }
  if (!online) {
    setStatus(pending ? `Offline · ${pending} queued` : 'Offline', 'Writes stay local and push when you are back online.');
    return pending;
  }
  setStatus(
    pending ? `Syncing ${pending}…` : 'Synced',
    pending ? 'Pushing queued writes in the background.' : 'All local changes are in the cloud.'
  );
  return pending;
}

/* ---------------------------------------------------------------- */
/* Push                                                             */
/* ---------------------------------------------------------------- */

async function pushRecord(store, record, ownerId) {
  const table = TABLE_MAP[store];
  if (!table) return false;

  if (record._deleted === true) {
    const { error } = await supabase.from(table).delete().eq('id', record.id).eq('owner_id', ownerId);
    if (error) {
      setStatus('Sync error', error.message);
      return false;
    }
    await hardRemove(store, record.id);
    return true;
  }

  const row = toCloudRow(store, record, ownerId);
  if (!row) return false;
  const { error } = await supabase.from(table).upsert(row, { onConflict: CONFLICT_TARGET[table] || 'id' });
  if (error) {
    setStatus('Sync error', error.message);
    return false;
  }
  await markSynced(store, record.id);
  return true;
}

/** Fire-and-forget background push for one just-written record. */
export function syncRecord(store, record) {
  if (!cloudEnabled || !supabase) return Promise.resolve(false);
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!online) {
    refreshPending();
    setStatus('Offline · saving locally', 'This change will sync when you are back online.');
    return Promise.resolve(false);
  }
  return getSessionUser()
    .then((user) => {
      if (!user || !hasConfirmedSession()) {
        refreshPending();
        return false;
      }
      setStatus('Syncing…', 'Uploading your latest change.');
      return pushRecord(store, record, user.id).then(async (ok) => {
        await refreshSyncStatus();
        return ok;
      });
    })
    .catch(() => false);
}

/**
 * Push every queued record.
 * @param {{ all?: boolean, notify?: boolean }} options
 *   `all: true` re-pushes everything (used by "Sync now" in Backup).
 *   `notify: true` reloads the stores once finished.
 */
export async function flushPending({ all = false, notify = false } = {}) {
  if (flushing || !cloudEnabled || !supabase) return { pushed: 0, failed: 0, skipped: true };
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!online) {
    await refreshSyncStatus();
    return { pushed: 0, failed: 0, skipped: true };
  }
    const user = await getSessionUser();
  if (!user || !hasConfirmedSession()) {
    await refreshSyncStatus();
    setStatus('Saved locally', 'Confirm your email to sync with the cloud.');
    return { pushed: 0, failed: 0, skipped: true };
  }

  flushing = true;
  syncing.set(true);
  let pushed = 0;
  let failed = 0;
  try {
    for (const store of STORES) {
      const queue = await pendingRecords(store, { all });
      if (!queue.length) continue;
      setStatus(`Syncing ${store}…`, `Pushing ${queue.length} record(s).`);
      for (const record of queue) {
        const stillOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
        if (!stillOnline) {
          failed += 1;
          break;
        }
        const ok = await pushRecord(store, record, user.id);
        if (ok) pushed += 1;
        else failed += 1;
      }
    }
  } finally {
    flushing = false;
    syncing.set(false);
  }

  lastSyncedAt.set(new Date().toISOString());
  if (notify && remoteAppliedHandler) await remoteAppliedHandler();
  await refreshSyncStatus();
  return { pushed, failed };
}

/* ---------------------------------------------------------------- */
/* Pull                                                             */
/* ---------------------------------------------------------------- */

function lastPullAt() {
  try {
    return localStorage.getItem(LAST_PULL_KEY) || '';
  } catch {
    return '';
  }
}

function setLastPullAt(value) {
  try {
    localStorage.setItem(LAST_PULL_KEY, value);
  } catch {
    /* storage disabled — pull will simply be full each time */
  }
}

/** Force the next pull to fetch everything (used by "Pull from cloud"). */
export function resetPullCursor() {
  try {
    localStorage.removeItem(LAST_PULL_KEY);
  } catch {
    /* ignore */
  }
}

async function pullTable(store, ownerId, since) {
  const table = TABLE_MAP[store];
  if (!table) return [];
  let query = supabase
    .from(table)
    .select('*')
    .eq('owner_id', ownerId)
    .order('updated_at', { ascending: true })
    .limit(1000);
  if (since) query = query.gt('updated_at', since);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Merge cloud rows into IndexedDB (last-write-wins by `updated_at`).
 * Local rows with unpushed changes always win — they are queued for upload.
 */
export async function pullRemote({ full = false, apply = true } = {}) {
  if (!cloudEnabled || !supabase) return { pulled: 0, skipped: true, errors: [] };
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  if (!online) return { pulled: 0, skipped: true, errors: [] };
  const user = await getSessionUser();
  if (!user) return { pulled: 0, skipped: true, errors: [] };

  const since = full ? '' : lastPullAt();
  const errors = [];
  let pulled = 0;

  syncing.set(true);
  setStatus('Syncing…', 'Checking for cloud changes.');
  try {
    for (const store of STORES) {
      let rows = [];
      try {
        rows = await pullTable(store, user.id, since);
      } catch (error) {
        errors.push(`${store}: ${error.message}`);
        continue;
      }
      for (const row of rows) {
        const local = await getRow(store, row.id);
        if (local?.pending_sync) continue;
        if (local && String(local.updated_at || '') > String(row.updated_at || '')) continue;
        await putSynced(store, fromCloudRow(row));
        pulled += 1;
      }
    }
  } finally {
    syncing.set(false);
  }

  if (errors.length) setStatus('Sync error', errors[0]);
  else if (pulled) setLastPullAt(new Date().toISOString());

  if (apply && pulled && remoteAppliedHandler) await remoteAppliedHandler();
  await refreshPending();
  return { pulled, errors };
}

/** Push every local row, then pull newer remote rows. */
export async function syncNow() {
  const push = await flushPending({ all: true });
  const pull = await pullRemote();
  if (remoteAppliedHandler) await remoteAppliedHandler();
  await refreshSyncStatus();
  return { ...push, pulled: pull.pulled };
}

/* ---------------------------------------------------------------- */
/* Lifecycle                                                        */
/* ---------------------------------------------------------------- */

/**
 * Wire connectivity + auth listeners so queued writes push themselves.
 * Safe to call when Supabase is not configured (returns a no-op teardown).
 */
export async function initSyncEngine() {
  if (teardown) return teardown;
  await restoreSession();
  await refreshPending();

  if (!cloudEnabled) {
    setStatus('Local only', 'Add Supabase keys to sync across devices.');
    return () => {};
  }

  const onlineHandler = () => {
    refreshSyncStatus();
    flushPending()
      .then(() => pullRemote())
      .catch(() => {});
  };
  const offlineHandler = () => refreshSyncStatus();

  if (typeof window !== 'undefined') {
    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);
  }

  const unsubscribe = onAuthChange((_event, user) => {
    if (user) {
      flushPending()
        .then(() => pullRemote())
        .catch(() => {});
    } else {
      refreshSyncStatus();
    }
  });

  const interval = setInterval(() => {
    const online = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (online) flushPending().catch(() => {});
  }, 60_000);

  teardown = () => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    }
    unsubscribe?.();
    clearInterval(interval);
    teardown = null;
  };

  const user = await getSessionUser();
  if (user) {
    flushPending()
      .then(() => pullRemote())
      .catch(() => {});
  } else {
    await refreshSyncStatus();
  }
  return teardown;
}

export function teardownSyncEngine() {
  teardown?.();
}

