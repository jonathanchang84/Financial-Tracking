/**
 * Small, framework-free record helpers shared by components and services.
 * Math lives in `runway.js` / `dates.js`; this module only shapes records.
 */

import { dayKey } from './dates.js';
import { num, currencyOf, seriesNameOf } from './runway.js';

export { num, currencyOf, seriesNameOf };

/** Historic alias kept for readability in the screens. */
export const codeOf = currencyOf;

export function nameOf(row) {
  return String(row?.name || row?.series || row?.symbol || '').trim();
}

export function newId() {
  return globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function todayISO() {
  return dayKey(new Date());
}

export function iso(value) {
  return dayKey(value);
}

export function decimal(value) {
  return Math.round(num(value) * 100) / 100;
}

export function displayName(row) {
  return nameOf(row) || seriesNameOf(row);
}

/**
 * Persist through whichever store API is available. Every entity store created
 * by `src/stores/finance.js` exposes `save`, so the fallbacks only matter when a
 * raw IndexedDB-backed shim is passed in.
 */
export async function persist(store, record) {
  const next = { ...record, pending_sync: true };
  if (typeof store?.save === 'function') return store.save(next);
  if (typeof store?.upsert === 'function') return store.upsert(next);
  if (typeof store?.put === 'function') return store.put(next);
  throw new Error('Store has no save method');
}

export async function destroy(store, id) {
  if (typeof store?.remove === 'function') return store.remove(id);
  if (typeof store?.delete === 'function') return store.delete(id);
  throw new Error('Store has no delete method');
}

/** Case-insensitive "does this record match the search text" helper. */
export function matchesSearch(row, term) {
  const needle = String(term || '').trim().toLowerCase();
  if (!needle) return true;
  return [row?.name, row?.series, row?.symbol, row?.category, row?.institution, row?.provider, row?.notes]
    .filter(Boolean)
    .some((value) => String(value).toLowerCase().includes(needle));
}
