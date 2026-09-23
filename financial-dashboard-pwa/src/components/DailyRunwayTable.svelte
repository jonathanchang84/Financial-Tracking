<script>
  /**
   * Daily runway grid — the exact metrics from the historic cash-flow screen:
   * starting balance, safe amount, commitments, cumulative commitments,
   * scheduled bills and ending balance, one row per day through payday.
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
          <th>Safe today</th>
          <th>Commitments</th>
          <th>Cumulative</th>
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
            <td class="strong">{fmt(row.ending)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="hint">
    Safe today spreads the saved balance across the remaining days. Saturday and Sunday bill
    due dates shift forward to Monday.
  </p>
{/if}
