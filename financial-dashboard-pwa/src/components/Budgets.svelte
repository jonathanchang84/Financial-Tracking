<script>
  import { budgets, displayCurrency, money, convertCurrency, RATES } from '../stores/finance.js';
  import { codeOf, destroy, newId, num, persist } from '../services/recordHelpers.js';

  const codes = Object.keys(RATES || { USD: 1 });
  let form = { name: '', limit: '', spent: '0', currency: 'USD' };
  let message = '';

  $: rows = $budgets || [];
  function left(row) { return Math.max(0, num(row.limit) - num(row.spent)); }
  function pct(row) { return Math.min(100, num(row.limit) ? (num(row.spent) / num(row.limit)) * 100 : 0); }

  async function onSubmit(event) {
    event.preventDefault();
    if (!form.name.trim() || !(num(form.limit) > 0)) { message = 'Name and monthly limit are required.'; return; }
    await persist(budgets, { id: newId(), name: form.name.trim(), limit: num(form.limit), spent: num(form.spent), currency: form.currency, currencyCode: form.currency });
    form = { name: '', limit: '', spent: '0', currency: form.currency };
    message = 'Budget saved locally.';
  }

  async function remove(id) {
    if (!confirm('Remove this budget?')) return;
    await destroy(budgets, id);
  }
</script>

<section class="fh-grid">
  <div>
    <p class="eyebrow">BUDGETS</p>
    <h2>Monthly safety targets</h2>
    <p class="muted">{message} Remaining room is limit minus spent. Amounts below are also shown in {$displayCurrency}.</p>
  </div>
  <form class="panel fh-form" on:submit={onSubmit}>
    <label>Budget name<input bind:value={form.name} placeholder="Essentials" required /></label>
    <label>Monthly limit<input bind:value={form.limit} inputmode="decimal" required /></label>
    <label>Already spent<input bind:value={form.spent} inputmode="decimal" /></label>
    <label>Currency<select bind:value={form.currency}>{#each codes as code}<option>{code}</option>{/each}</select></label>
    <button class="primary-button" type="submit">Save budget</button>
  </form>
  <div class="fh-metrics">
    {#each rows as row (row.id)}
      <article class="fh-metric">
        <p class="eyebrow">MONTHLY TARGET</p>
        <h3>{row.name}</h3>
        <strong>{money(left(row), codeOf(row))} left</strong>
        <p class="muted">{money(convertCurrency(left(row), codeOf(row), $displayCurrency), $displayCurrency)} in {$displayCurrency}</p>
        <div class="progress"><span style="width:{pct(row)}%"></span></div>
        <p class="muted">{money(num(row.spent), codeOf(row))} used of {money(num(row.limit), codeOf(row))}</p>
        <button class="text-button" type="button" on:click={() => remove(row.id)}>Remove</button>
      </article>
    {:else}
      <p class="muted">No budgets yet.</p>
    {/each}
  </div>
</section>
