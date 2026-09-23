/**
 * Local JSON backup / restore.
 *
 * Round-trips with the historic `pwa/` prototype: same `format` string, same
 * `data.<store>` arrays and `data.settings` object shape (version 1 files
 * import cleanly), plus cloud push/pull helpers for the Backup screen.
 */

import { getAll, putMany, clearStore, STORES } from './indexedDB.js';
import { reloadStores, initStores } from '../stores/finance.js';
import { flushPending, pullRemote, syncNow, resetPullCursor } from './syncEngine.js';
import { dayKey } from './dates.js';

export const BACKUP_FORMAT = 'financial-health-backup';
export const BACKUP_VERSION = 2;

/** Build the in-memory backup object. */
export async function exportBackup() {
  const data = {};
  for (const store of STORES) data[store] = await getAll(store);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    app: 'financial-dashboard-pwa',
    exportedAt: new Date().toISOString(),
    data
  };
}

/** Export and trigger a browser download. Returns the filename used. */
export async function downloadBackup(filename = `financial-health-${dayKey(new Date())}.json`) {
  const backup = await exportBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  return filename;
}

/** Parse + validate a backup blob/text. Throws with a user-readable reason. */
export async function readBackupFile(file) {
  const text = typeof file === 'string' ? file : await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON.');
  }
  if (parsed?.format !== BACKUP_FORMAT) {
    throw new Error('That file is not a Financial Health backup.');
  }
  if (!parsed.data || typeof parsed.data !== 'object') {
    throw new Error('The backup file has no data section.');
  }
  return parsed;
}

/** Count records in a parsed backup so the UI can describe the restore. */
export function summariseBackup(backup) {
  const data = backup?.data || {};
  const entities = Object.entries(data).reduce(
    (total, [store, value]) => (store === 'settings' ? total : total + (Array.isArray(value) ? value.length : 0)),
    0
  );
  const settings = data.settings && !Array.isArray(data.settings) ? Object.keys(data.settings).length : 0;
  return { entities, settings, exportedAt: backup?.exportedAt || '', stores: Object.keys(data).length };
}

/**
 * Replace local data with a backup file.
 * Historic version-1 files carry `settings` as `{ key: value }`; arrays are
 * accepted too so a raw store dump also restores.
 */
export async function restoreBackup(file) {
  const backup = await readBackupFile(file);
  const data = backup.data || {};

  for (const store of STORES) await clearStore(store);

  let entities = 0;
  let settingsCount = 0;

  for (const [store, value] of Object.entries(data)) {
    if (!STORES.includes(store)) continue;

    if (store === 'settings') {
      if (Array.isArray(value)) {
        await putMany('settings', value.map((row) => ({ ...row, id: row.id || row.key, key: row.key || row.id })));
        settingsCount += value.length;
      } else if (value && typeof value === 'object') {
        const rows = Object.entries(value).map(([key, settingValue]) => ({ id: key, key, value: settingValue }));
        await putMany('settings', rows);
        settingsCount += rows.length;
      }
      continue;
    }

    if (Array.isArray(value) && value.length) {
      await putMany(store, value);
      entities += value.length;
    }
  }

  await initStores();
  return { entities, settings: settingsCount, exportedAt: backup.exportedAt || '' };
}

/** Wipe local data (used by the Backup screen's "clear this device" action). */
export async function clearLocalData() {
  for (const store of STORES) await clearStore(store);
  await initStores();
  reloadStores();
}

/* ------------------------------------------------------------------ */
/* Cloud helpers                                                      */
/* ------------------------------------------------------------------ */

/** Upload every local row, including ones already marked synced. */
export function pushAllToCloud() {
  return flushPending({ all: true });
}

/** Force a full pull (ignores the incremental cursor) and reload the stores. */
export async function pullAllFromCloud() {
  resetPullCursor();
  const result = await pullRemote({ full: true, apply: true });
  await reloadStores();
  return result;
}

/** Push everything, then pull anything newer. */
export function syncAll() {
  return syncNow();
}

export const exportAll = downloadBackup;
export const importAll = restoreBackup;
