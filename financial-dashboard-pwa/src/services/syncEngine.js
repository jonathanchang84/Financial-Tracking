/**
 * Non-blocking Sync Engine.
 *
 * - Every write commits instantly to IndexedDB (UI stays immediate).
 * - If navigator.onLine and a Supabase session exists, fire a background
 *   .upsert() carrying owner_id = auth.uid().
 * - If offline, the record keeps pending_sync: true in IndexedDB and is
 *   flushed automatically when connectivity restores.
 *
 * Cloud tables use SCD Type 2 temporal columns for mutable assets:
 * validFrom / validTo / currentFlag, keyed by a stable logical id so
 * historical valuation records are never overwritten.
 */

import { supabase, cloudEnabled, getSessionUser } from './supabaseClient.js';
import { STORES, pendingRecords, markSynced } from './indexedDB.js';

/** Map local store name -> Supabase table name. */
const TABLE_MAP = {
  settings: 'settings',
  transactions: 'transactions',
  budgets: 'budgets',
  accounts: 'accounts',
  snapshots: 'snapshots',
  netWorthEntries: 'net_worth_entries',
  netWorthHistory: 'net_worth_history',
  holdings: 'holdings',
  portfolioHistory: 'portfolio_history',
  pensions: 'pensions',
  pensionHistory: 'pension_history',
  bills: 'bills',
  commitments: 'commitments'
};

let flushing = false;

/** Strip client-only flags and attach auth.uid() ownership. */
async function payloadFor(store, record) {
  const user = await getSessionUser();
  if (!user) return null;
  const { pending_sync, synced_at, ...rest } = record;
  return {
    ...rest,
    id: rest.id,
    owner_id: user.id,
    table: TABLE_MAP[store]
  };
}

async function upsertRecord(store, record) {
  if (!cloudEnabled || !supabase) return false;
  const payload = await payloadFor(store, record);
  if (!payload) return false;
  const { pending_sync, synced_at, table, ...row } = payload;
  const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
  if (error) {
    console.warn('[sync] upsert failed', store, error.message);
    return false;
  }
  await markSynced(store, record.id);
  return true;
}

/** Fire-and-forget background sync for one just-written record. */
export function syncRecord(store, record) {
  if (!cloudEnabled || !supabase) return Promise.resolve(false);
  if (!navigator.onLine) return Promise.resolve(false); // stays pending_sync in IndexedDB
  return upsertRecord(store, record).catch(() => false);
}

/** Flush every pending record across all stores. Safe to call repeatedly. */
export async function flushPending() {
  if (flushing || !cloudEnabled || !supabase) return;
  if (!navigator.onLine) return;
  const user = await getSessionUser();
  if (!user) return;
  flushing = true;
  try {
    for (const store of STORES) {
      const pending = await pendingRecords(store);
      for (const record of pending) {
        if (!navigator.onLine) return; // went offline mid-flush; keep remainder pending
        await upsertRecord(store, record);
      }
    }
  } finally {
    flushing = false;
  }
}

/** Register connectivity + auth listeners to auto-push queued writes. */
export function initSync() {
  if (!cloudEnabled) return () => {};
  const onOnline = () => flushPending();
  window.addEventListener('online', onOnline);
  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      if (session) flushPending();
    });
  }
  // Opportunistic periodic flush (non-blocking).
  const timer = setInterval(flushPending, 60_000);
  return () => {
    window.removeEventListener('online', onOnline);
    clearInterval(timer);
  };
}
