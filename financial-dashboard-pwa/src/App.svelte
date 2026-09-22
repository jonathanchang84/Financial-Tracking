<script>
  import { onMount } from 'svelte';
  import Auth from './components/Auth.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import CashFlow from './components/CashFlow.svelte';
  import PositionScreen from './components/PositionScreen.svelte';
  import Budgets from './components/Budgets.svelte';
  import Backup from './components/Backup.svelte';
  import { initStores } from './stores/finance.js';
  import { initSyncEngine, syncStatus } from './services/syncEngine.js';
  import { session } from './services/supabaseClient.js';

  const views = [
    { id: 'dashboard', label: 'Overview', icon: '⌂' },
    { id: 'cashflow', label: 'Cash flow', icon: '◷' },
    { id: 'position', label: 'Position', icon: '◒' },
    { id: 'investments', label: 'Investments', icon: '⌁' },
    { id: 'pensions', label: 'Pensions', icon: '◫' },
    { id: 'budgets', label: 'Budgets', icon: '◎' }
  ];

  let view = $state('dashboard');
  let ready = $state(false);
  let bootError = $state('');
  let showAuth = $state(false);
  let showBackup = $state(false);

  onMount(() => {
    initStores()
      .then(() => { ready = true; initSyncEngine(); })
      .catch((e) => { bootError = e.message; });
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }
  });

  function openBackup() { showBackup = true; }
</script>

{#if bootError}
  <main class="panel" style="margin:24px">
    <h2>Local database unavailable</h2>
    <p>{bootError}</p>
  </main>
{:else if !ready}
  <main class="panel" style="margin:24px"><p class="muted">Loading local database…</p></main>
{:else}
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">
        <p class="eyebrow">OFFLINE-FIRST</p>
        <h1>Financial Dashboard</h1>
      </div>
      <div class="header-actions">
        <span class="sync-pill" title="Sync status">{$syncStatus}</span>
        <button class="secondary-button" onclick={() => (showAuth = true)}>
          {$session ? 'Account ✓' : 'Sign in'}
        </button>
        <button class="secondary-button" onclick={openBackup}>Backup</button>
      </div>
    </header>

    <main class="content">
      {#if view === 'dashboard'}<Dashboard />{/if}
      {#if view === 'cashflow'}<CashFlow />{/if}
      {#if view === 'position'}<PositionScreen entity="netWorth" />{/if}
      {#if view === 'investments'}<PositionScreen entity="holdings" />{/if}
      {#if view === 'pensions'}<PositionScreen entity="pensions" />{/if}
      {#if view === 'budgets'}<Budgets />{/if}
    </main>

    <nav class="bottom-nav" aria-label="Primary navigation">
      {#each views as item (item.id)}
        <button class="nav-item" class:active={view === item.id} onclick={() => (view = item.id)}>
          <span>{item.icon}</span>{item.label}
        </button>
      {/each}
      <button class="nav-item" onclick={openBackup}><span>↥</span>Backup</button>
    </nav>
  </div>

  {#if showAuth}<Auth onClose={() => (showAuth = false)} />{/if}
  {#if showBackup}<Backup onClose={() => (showBackup = false)} />{/if}
{/if}
