<script>
  /**
   * Budgets — historic rules: remaining room is `limit - spent`, never negative,
   * and the progress bar tops out at 100% while over-budget cards turn red.
   */
  import { budgets, displayCurrency, money, convertCurrency, RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { saveBudget, confirmDelete } from '../services/commands.js';
  import { num } from '../services/runway.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';

  const codes = Object.keys(RATES);

  let form = $state({ name: '', limit: '', spent: '0', currency: 'USD' });
  let editingId = $state(null);
  let busy = $state(false);

  const rows = $derived(
    [...$budgets].map((row) => {
      const limit = num(row.limit);
      const spent = num(row.spent);
      return {
        ...row,
        limit,
        spent,
        left: Math.max(0, limit - spent),
        percent: Math.min(100, limit ? (spent / limit) * 100 : 0),
        over: spent > limit
      };
    })
  );

  function reset() {
    form = { name: '', limit: '', spent: '0', currency: form.currency };
    editingId = null;
  }

  function startEdit(row) {
    editingId = row.id;
    form = {
      name: row.name,
      limit: String(num(row.limit)),
      spent: String(num(row.spent)),
      currency: row.currency || row.currencyCode || 'USD'
    };
  }

  async function submit(event) {
    event.preventDefault();
    busy = true;
    try {
      await saveBudget({
        id: editingId,
        name: form.name,
        limit: form.limit,
        spent: form.spent,
        currency: form.currency
      });
      reset();
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = false;
    }
  }

  async function remove(row) {
    const removed = await confirmDelete('budgets', row.id, `Remove the “${row.name}” budget?`);
    if (removed && editingId === row.id) reset();
  }
</script>

<section class="fh-grid">
  <div class="view-heading">
    <div>
      <p class="eyebrow">BUDGETS</p>
      <h2>Monthly safety targets</h2>
      <p class="muted">
        Set a monthly limit and track how much room remains. Amounts stay in their own currency and are
        also shown in {$displayCurrency}.
      </p>
    </div>
    <CurrencySelect compact />
  </div>

  <section class="panel">
    <form class="fh-form" onsubmit={submit}>
      <label>Budget name<input bind:value={form.name} placeholder="Essentials" required /></label>
      <label>Monthly limit<input type="number" step="0.01" min="0" bind:value={form.limit} required /></label>
      <label>Already spent<input type="number" step="0.01" min="0" bind:value={form.spent} /></label>
      <label>Currency
        <select bind:value={form.currency}>
          {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
        </select>
      </label>
      <button class="primary-button" type="submit" disabled={busy}>
        {editingId ? 'Save budget' : 'Add budget'}
      </button>
      {#if editingId}
        <button class="secondary-button" type="button" onclick={reset}>Cancel edit</button>
      {/if}
    </form>
  </section>

  <div class="fh-metrics">
    {#each rows as row (row.id)}
      <article class="fh-metric">
        <p class="eyebrow">MONTHLY TARGET</p>
        <h3>{row.name}</h3>
        <strong class={row.over ? 'negative' : ''}>{money(row.left, row.currency || 'USD')} left</strong>
        <p class="hint">
          {money(convertCurrency(row.left, row.currency || 'USD', $displayCurrency), $displayCurrency)} in
          {$displayCurrency}
        </p>
        <div class="progress" class:over={row.over}>
          <span style="width:{row.percent}%"></span>
        </div>
        <p class="hint">
          {money(row.spent, row.currency || 'USD')} used of {money(row.limit, row.currency || 'USD')}
          {#if row.over} · over budget{/if}
        </p>
        <div class="button-row" style="margin-top:6px">
          <button class="text-button" type="button" onclick={() => startEdit(row)}>Edit</button>
          <button class="text-button danger" type="button" onclick={() => remove(row)}>Remove</button>
        </div>
      </article>
    {:else}
      <p class="muted">No budgets yet. Add a safety target above.</p>
    {/each}
  </div>
</section>
