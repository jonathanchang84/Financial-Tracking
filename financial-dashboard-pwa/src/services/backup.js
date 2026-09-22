import { getAll, clearStore, put, STORES } from './indexedDB.js';
import { bootstrapStores, settings } from '../stores/finance.js';
import { get } from 'svelte/store';

/** Export a complete local JSON backup (historic format). */
export async function exportBackup() {
  const data = {};
  for (const store of STORES) data[store] = await getAll(store);
  return {
    format: 'financial-health-backup',
    version: 2,
    exportedAt: new Date().toISOString(),
    data
  };
}

export function downloadBackup(filename) {
  exportBackup().then((backup) => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  });
}

/** Restore a historic or v2 backup file, replacing local data. */
export async function restoreBackup(file) {
  const backup = JSON.parse(await file.text());
  if (backup.format !== 'financial-health-backup') throw new Error('Invalid backup file');
  for (const store of STORES) await clearStore(store);
  for (const [store, values] of Object.entries(backup.data || {})) {
    if (!STORES.includes(store)) continue;
    if (store === 'settings' && !Array.isArray(values)) {
      for (const [key, value] of Object.entries(values)) {
        await put('settings', { id: key, key, value });
      }
    } else if (Array.isArray(values)) {
      for (const value of values) await put(store, value);
    }
  }
  await bootstrapStores();
  return get(settings);
}
