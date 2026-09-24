<script>
  /**
   * Daily runway grid — starting balance, safe-to-spend amount, Spend Items,
   * cumulative Spend Items, scheduled bills and ending balance.
   */
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';

  let {
    rows = [],
    currency = 'USD',
    limit = 0,
    emptyMessage = 'Set your balance and payday to see the daily runway.'
  } = $props();

  const visible = $derived(limit > 0 ? rows.slice(0, limit) : rows);
  const fmt = (value) => money(convertCurrency(value, currency, $displayCurrency), $displayCurrency);
</script>

{#if !visible.length}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="fh-scroll">
    <table class="fh-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Starting</th>
          <th>Safe to spend</th>
          <th>Spend Items</th>
          <th>Cumulative Spend Items</th>
          <th>Scheduled bills</th>
          <th>Ending</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as row (row.date)}
          <tr>
            <td>
              <strong>{row.label}</strong>
              <small>Day {row.dayNumber}</small>
            </td>
            <td>{fmt(row.starting)}</td>
            <td>{fmt(row.safe)}</td>
            <td class:strong={row.commitments > 0}>{fmt(row.commitments)}</td>
            <td>{fmt(row.cumulative)}</td>
            <td class:strong={row.bills > 0}>{fmt(row.bills)}</td>
            <td class="strong" class:negative={row.ending < 0}>{fmt(row.ending)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="hint">
    Safe today reserves scheduled bills and Spend Items before dividing the remaining cash across the cycle.
    Saturday and Sunday bill due dates shift forward to Monday.
  </p>
{/if}
