<script>
  import { fly } from 'svelte/transition';
  import { displayCurrency, convertToDisplay, runReport, money } from '../stores/finance.js';

  let { onClose } = $props();
  let busy = $state(false);
  let error = $state('');

  async function exportBackup(ev) {
    ev.preventDefault();
    busy = true;
    error = '';
    try {
      await exportLocalBackup();
      const { exportAll } = await import('../services/backup.js');
      await exportAll();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }

  async function importBackup(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    if (!confirm('Restore this backup? It will replace current local data.')) return;
    busy = true;
    error = '';
    try {
      const { importAll } = await import('../services/backup.js');
      const report = await importAll(file);
      error = '';
      alert(`Restored: ${report.entities} records, ${report.settings} settings.`);
      location.reload();
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
      ev.target.value = '';
    }
  }

  async function exportLocalBackup() {
    // kept for backwards-compat path; real implementation lives in backup.js
  }
</script>

<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} transition:fly={{ duration: 160 }}>
  <section class="modal" role="dialog" aria-modal="true" aria-label="Backup and restore">
    <div class="section-heading">
      <div><p class="eyebrow">DATA CONTROL</p><h3>Backup and restore</h3></div>
      <button class="text-button" onclick={onClose}>Close</button>
    </div>
    <p class="muted">Your data never leaves this device unless you export it yourself.</p>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="button-row">
      <button class="primary-button" disabled={busy} onclick={exportBackup}>Export backup</button>
      <label class="secondary-button file-button">Import backup
        <input type="file" accept="application/json" onchange={importBackup} disabled={busy}>
      </label>
    </div>
    <p class="muted">Exports include every local store plus optional Supabase rows when signed in.</p>
  </section>
</div>
