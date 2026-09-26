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
  import ProtectionBanner from './components/ProtectionBanner.svelte';
  import { initStores, exchangeRates } from './stores/finance.js';
  import { describeRates } from './services/rates.js';
  import { initSyncEngine, teardownSyncEngine, pendingCount } from './services/syncEngine.js';
  import { protectionCopy, protectionState, readDismissedAt, rememberDismissedAt, shouldShowProtectionBanner } from './services/dataSafety.js';
  import { session } from './services/appClient.js';
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

  // The old pill read "Saved locally" in the same grey as a healthy state, which
  // is misleading: local-only means this browser profile holds the only copy.
  const protection = $derived(protectionState({
    online: $online,
    signedIn: Boolean($session),
    pending: $pendingCount
  }));
  const protectionText = $derived(protectionCopy(protection));
  // States where the numbers came from and when. Declared here rather than inline
  // in the template because a `$derived` referenced only in markup is easy to
  // delete, and an undeclared one silently renders as empty rather than failing.
  const rateNote = $derived(
    $exchangeRates ? describeRates($exchangeRates) : { label: '', tone: 'ok' }
  );

  // Nudge once there is something to lose, and remember the dismissal along with
  // the record count at the time so it reappears only if there is much more at
  // stake rather than nagging on every visit.
  let dismissedAt = $state(readDismissedAt());
  const showProtectionBanner = $derived(
    shouldShowProtectionBanner({ state: protection, pending: $pendingCount, dismissedAt })
  );

  function dismissProtectionBanner() {
    dismissedAt = Number($pendingCount) || 0;
    rememberDismissedAt(dismissedAt);
  }

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
        {#if protection === 'stalled' || protection === 'local-only'}
          <!-- The "Not syncing" copy tells the user to re-sync, so the control that
               does it has to be reachable from the warning itself rather than
               only from the Backup dialog. -->
          <button
            class="sync-pill as-button"
            class:alert={protectionText.tone === 'alert'}
            class:warn={protectionText.tone === 'warn'}
            type="button"
            title={protectionText.detail}
            aria-live="polite"
            onclick={() => (showBackup = true)}
          >{protectionText.label}{$pendingCount && protection === 'stalled' ? ` · ${$pendingCount}` : ''}</button>
        {:else}
          <span
            class="sync-pill"
            title={protectionText.detail}
            aria-live="polite"
          >{protectionText.label}</span>
        {/if}
        <CurrencySelect compact />
        <!-- Live rates with the date they were fetched. Silent staleness is what
             made the old hard-coded table wrong for months without anyone noticing,
             so the "as of" is stated rather than implied. -->
        <span class="rate-note" class:warn={rateNote.tone === 'warn'}>{rateNote.label}</span>
        <button class="icon-button" type="button" title="Toggle colour theme" onclick={toggleTheme}>
          {$theme === 'dark' ? '☾' : '☼'}
        </button>
        <button
          class="secondary-button"
          type="button"
          title={signedIn ? 'Open your profile' : 'Sign in'}
          onclick={() => (showAuth = true)}
        >
          {signedIn ? 'Profile' : 'Sign in'}
        </button>
        <button class="secondary-button" type="button" onclick={() => (showBackup = true)}>Backup</button>
      </div>
    </header>

    <main class="content">
      {#if showProtectionBanner}
        <ProtectionBanner
          pending={$pendingCount}
          onSignIn={() => (showAuth = true)}
          onDismiss={dismissProtectionBanner}
        />
      {/if}
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

  {#if showBackup}<Backup onClose={() => (showBackup = false)} />{/if}
{/if}

<!-- Recovery callbacks must be able to open this modal even while the local
     database is still loading or has reported a boot error. -->
{#if showAuth}<Auth onClose={() => (showAuth = false)} />{/if}
<Toast />
