<script>
  /** Current-month table and category doughnut matching the workbook's Current Month sheet. */
  import SpendingDonut from './SpendingDonut.svelte';
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';
  import { num } from '../services/runway.js';
  import { longLabel } from '../services/dates.js';

  let {
    data = { rows: [], categories: [], total: 0, unpaidTotal: 0, remainder: 0 },
    currency = 'USD',
    onTogglePaid = () => {}
  } = $props();

  const fmt = (value) => money(convertCurrency(value, currency, $displayCurrency), $displayCurrency);
  const rows = $derived(data.rows || []);
</script>

<div class="current-month-panel">
  <div class="current-month-layout">
    <div>
      <p class="eyebrow">CATEGORY BREAKDOWN</p>
      <h3>Where this month's spending goes</h3>
      <SpendingDonut categories={data.categories || []} total={num(data.total)} {currency} />
    </div>
    <div class="current-month-summary">
      <div><span>Total planned</span><strong>{fmt(data.total)}</strong></div>
      <div><span>Still unpaid</span><strong>{fmt(data.unpaidTotal)}</strong></div>
      <div><span>Running remainder</span><strong class:negative={num(data.remainder) < 0}>{fmt(data.remainder)}</strong></div>
    </div>
  </div>

  {#if rows.length}
    <div class="fh-scroll" style="margin-top:16px">
      <table class="fh-table">
        <thead>
          <tr><th>Date</th><th>Item</th><th>Type</th><th>Amount</th><th>Paid</th><th>Remainder</th></tr>
        </thead>
        <tbody>
          {#each rows as row (row.paymentKey || `${row.kind}-${row.id}`)}
            <tr>
              <td>{longLabel(row.date)}</td>
              <td><strong>{row.name}</strong></td>
              <td>{row.category}</td>
              <td>{fmt(row.amount)}</td>
              <td>
                <button class:active={row.paid} class="text-button" type="button" aria-pressed={row.paid} onclick={() => onTogglePaid(row)}>
                  {row.paid ? 'Paid' : 'Unpaid'}
                </button>
              </td>
              <td class:negative={num(row.remainder) < 0}>{fmt(row.remainder)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="hint">The remainder follows the workbook formula: each unpaid amount reduces the running balance; paid rows leave it unchanged.</p>
  {:else}
    <p class="muted" style="margin-top:14px">No current-month bills or Spend Items found.</p>
  {/if}
</div>

<style>
  .current-month-panel { display: grid; gap: 14px; }
  .current-month-layout { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(190px, 0.7fr); gap: 18px; align-items: start; }
  .current-month-summary { display: grid; gap: 10px; }
  .current-month-summary > div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .current-month-summary span { color: var(--muted); font-size: 0.82rem; }
  .current-month-summary strong { white-space: nowrap; }
  .text-button.active { color: var(--positive); }
  @media (max-width: 680px) { .current-month-layout { grid-template-columns: 1fr; } }
</style>
