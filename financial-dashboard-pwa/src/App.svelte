<script>
  /**
   * App shell: boot the local database, start the sync engine, route between the
   * six dashboards, and host the optional Auth + Backup modals.
   */
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import Toast from './components/Toast.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import CashFlow from './components/CashFlow.svelte';
  import PositionScreen from './components/PositionScreen.svelte';
  import Budgets from './components/Budgets.svelte';
  import Backup from './components/Backup.svelte';
  import Auth from './components/Auth.svelte';
  import CurrencySelect from './components/CurrencySelect.svelte';
  import { initStores } from './stores/finance.js';
  import { initSyncEngine, teardownSyncEngine, syncStatus, syncDetail, pendingCount } from './services/syncEngine.js';
  import { session } from './services/supabaseClient.js';
  import { theme, toggleTheme, watchConnectivity, online } from './stores/ui.js';

  const VIEWS = [
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
    const stopConnectivity = watchConnectivity();

    const requested = location.hash.replace('#', '');
    if (VIEWS.some((item) => item.id === requested)) view = requested;

    initStores()
      .then(() => {
        ready = true;
        return initSyncEngine();
      })
      .catch((error) => {
        bootError = error.message;
      });

    return stopConnectivity;
  });

  onDestroy(() => teardownSyncEngine());

  function go(next) {
    view = next;
    try {
      history.replaceState(null, '', `#${next}`);
    } catch {
      /* hash updates are cosmetic */
    }
  }

  const signedIn = $derived(Boolean($session));
</script>

{#if bootError}
  <main class="panel" style="margin:24px">
    <h2>Local database unavailable</h2>
    <p class="error">{bootError}</p>
    <p class="hint">
      Private browsing windows and disabled storage can block IndexedDB. Close private mode or allow site
      data, then reload.
    </p>
  </main>
{:else if !ready}
  <main class="panel" style="margin:24px">
    <p class="muted">Loading your local database…</p>
  </main>
{:else}
  <div class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">{get(theme) === 'dark' ? 'LOCAL-FIRST · DARK' : 'LOCAL-FIRST'}</p>
        <h1>Financial Dashboard</h1>
      </div>
      <div class="header-actions">
        <span class="sync-pill" title={$syncDetail}>{$syncStatus}{$pendingCount ? ` · ${$pendingCount}` : ''}</span>
        {#if !$online}<span class="sync-pill">Offline</span>{/if}
        <CurrencySelect compact />
        <button class="icon-button" type="button" title="Toggle colour theme" onclick={toggleTheme}>
          {$theme === 'dark' ? '☾' : '☼'}
        </button>
        <button class="secondary-button" type="button" onclick={() => (showAuth = true)}>
          {signedIn ? 'Account ✓' : 'Sign in'}
        </button>
        <button class="secondary-button" type="button" onclick={() => (showBackup = true)}>Backup</button>
      </div>
    </header>

    <main class="content">
      {#if view === 'dashboard'}
        <Dashboard
          onOpenCashflow={() => go('cashflow')}
          onOpenPosition={() => go('position')}
          onOpenBudgets={() => go('budgets')}
        />
      {/if}
      {#if view === 'cashflow'}<CashFlow />{/if}
      {#if view === 'position'}<PositionScreen entityKey="netWorth" />{/if}
      {#if view === 'investments'}<PositionScreen entityKey="holdings" />{/if}
      {#if view === 'pensions'}<PositionScreen entityKey="pensions" />{/if}
      {#if view === 'budgets'}<Budgets />{/if}
    </main>

    <nav class="bottom-nav" aria-label="Primary navigation">
      {#each VIEWS as item (item.id)}
        <button class="nav-item" class:active={view === item.id} type="button" onclick={() => go(item.id)}>
          <span>{item.icon}</span>{item.label}
        </button>
      {/each}
      <button class="nav-item" type="button" onclick={() => (showBackup = true)}><span>↥</span>Backup</button>
    </nav>
  </div>

  {#if showAuth}<Auth onClose={() => (showAuth = false)} />{/if}
  {#if showBackup}<Backup onClose={() => (showBackup = false)} />{/if}
  <Toast />
{/if}
