<script>
  /** Local JSON export/import plus the optional application cloud push/pull controls. */
  import Modal from './Modal.svelte';
  import { session, cloudEnabled } from '../services/appClient.js';
  import { syncStatus, syncDetail, pendingCount, lastSyncedAt, syncNow } from '../services/syncEngine.js';
  import {
    downloadBackup,
    restoreBackup,
    readBackupFile,
    summariseBackup,
    pushAllToCloud,
    pullAllFromCloud
  } from '../services/backup.js';
  import { showToast, errorToast } from '../stores/ui.js';

  let { onClose = () => {} } = $props();

  let busy = $state('');
  let status = $state('');
  let selected = $state(null);

  async function exportLocal() {
    busy = 'export';
    status = '';
    try {
      const filename = await downloadBackup();
      status = `Backup exported as ${filename}.`;
      showToast('Backup exported locally');
    } catch (error) {
      errorToast(`Export failed: ${error.message}`);
    } finally {
      busy = '';
    }
  }

  async function chooseFile(event) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    try {
      const parsed = await readBackupFile(file);
      selected = { file, backup: parsed, summary: summariseBackup(parsed) };
      status = `Ready to restore ${selected.summary.entities} record(s) and ${selected.summary.settings} setting(s)${
        parsed.exportedAt ? ` from ${new Date(parsed.exportedAt).toLocaleString()}` : ''
      }.`;
    } catch (error) {
      selected = null;
      errorToast(error.message);
    }
  }

  async function confirmRestore() {
    if (!selected) return;
    if (!window.confirm('Restore this backup? It replaces the local data on this device.')) return;
    busy = 'restore';
    try {
      const report = await restoreBackup(selected.backup);
      status = `Restored ${report.entities} record(s) and ${report.settings} setting(s).`;
      selected = null;
      showToast('Backup restored');
    } catch (error) {
      errorToast(`Restore failed: ${error.message}`);
    } finally {
      busy = '';
    }
  }

  async function pushAll() {
    busy = 'push';
    try {
      const result = await pushAllToCloud();
      status = result.skipped
        ? 'Sign in and go online to push to the cloud.'
        : `Pushed ${result.pushed} record(s)${result.failed ? `, ${result.failed} failed` : ''}.`;
      showToast('Cloud push finished');
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = '';
    }
  }

  async function pullAll() {
    busy = 'pull';
    try {
      const result = await pullAllFromCloud();
      status = result.skipped ? 'Sign in and go online to pull from the cloud.' : `Pulled ${result.pulled} record(s).`;
      showToast('Cloud pull finished');
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = '';
    }
  }

  async function syncEverything() {
    busy = 'sync';
    try {
      const result = await syncNow();
      status = `Pushed ${result.pushed ?? 0}, pulled ${result.pulled ?? 0}.`;
      showToast('Sync complete');
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = '';
    }
  }
</script>

<Modal title="Backup and restore" eyebrow="DATA CONTROL" onClose={onClose}>
  <p class="muted">
    Your data never leaves this device unless you export it or sign in for cloud sync. Everything works
    offline; each change is committed to the database automatically once you are back online and signed
    in, so there is no sync step to remember.
  </p>

  <div class="button-row" style="margin-top:10px">
    <button class="primary-button" type="button" disabled={busy === 'export'} onclick={exportLocal}>
      Export JSON backup
    </button>
    <label class="secondary-button file-button">
      Choose backup file
      <input type="file" accept="application/json" onchange={chooseFile} />
    </label>
  </div>

  {#if selected}
    <div class="panel" style="margin-top:12px">
      <p class="hint">
        {selected.summary.entities} records · {selected.summary.settings} settings · {selected.summary.stores} store(s)
      </p>
      <div class="button-row">
        <button class="primary-button" type="button" disabled={busy === 'restore'} onclick={confirmRestore}>
          Restore and replace local data
        </button>
        <button class="secondary-button" type="button" onclick={() => (selected = null)}>Cancel</button>
      </div>
    </div>
  {/if}

  <hr style="border:none;border-top:1px solid var(--line);margin:16px 0" />

  <div class="section-heading">
    <div>
      <p class="eyebrow">CLOUD SYNC</p>
      <h3>{cloudEnabled ? 'Application cloud connected' : 'Local only'}</h3>
      <p class="hint">{$syncStatus}{$syncDetail ? ` · ${$syncDetail}` : ''}</p>
    </div>
    <span class="badge">{cloudEnabled ? ($session ? 'signed in' : 'no session') : 'unconfigured'}</span>
  </div>

  <p class="hint">
    Every change is committed to the database automatically a moment after you make it, so there is no step
    to remember. These buttons are repair tools: use one only if a change has not appeared on another
    device, or after restoring a backup.
  </p>

  <p class="hint">
    Pending writes: {$pendingCount}{$lastSyncedAt ? ` · last sync ${new Date($lastSyncedAt).toLocaleTimeString()}` : ''}
  </p>

  <div class="button-row" style="margin-top:10px">
    <button class="secondary-button" type="button" disabled={!cloudEnabled || busy === 'push'} onclick={pushAll}>
      Push all to cloud
    </button>
    <button class="secondary-button" type="button" disabled={!cloudEnabled || busy === 'pull'} onclick={pullAll}>
      Pull from cloud
    </button>
    <button class="primary-button" type="button" disabled={!cloudEnabled || busy === 'sync'} onclick={syncEverything}>
      Re-sync everything
    </button>
  </div>

  {#if status}<p class="hint" style="margin-top:8px">{status}</p>{/if}
</Modal>
