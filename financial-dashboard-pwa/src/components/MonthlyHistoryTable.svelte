<script>
  /** Bucket-by-item value table with a paired period-over-period change column. */
  import { displayCurrency, money } from '../stores/finance.js';

  let {
    table = { columns: [], rows: [], granularity: 'month' },
    emptyMessage = 'Record dated snapshots to see the monthly comparison.'
  } = $props();

  // A bucket is either '2024' or '2024-06' depending on the shared toggle, so the
  // header has to follow it rather than assuming months.
  const bucketLabel = (bucket) => {
    if (table.granularity === 'year') return String(bucket);
    const [year, month] = String(bucket).split('-').map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  };
  const valueLabel = (value) => value === null ? '—' : money(value, $displayCurrency);
  const changeLabel = (change) => change === null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
</script>

{#if table.rows.length && table.columns.length}
  <div class="table-scroll monthly-history-wrap">
    <table class="fh-table monthly-history-table" style={`min-width: ${Math.max(600, 120 + table.columns.length * 220)}px`}>
      <colgroup>
        <col class="history-month" />
        {#each table.columns as column (column.key)}
          <col class="history-value" />
          <col class="history-change" />
        {/each}
      </colgroup>
      <caption>Item values by {table.granularity}. Each cell shows the last value recorded in that {table.granularity}.</caption>
      <thead>
        <tr>
          <th scope="col" class="text-cell">{table.granularity === 'year' ? 'Year' : 'Month'}</th>
          {#each table.columns as column (column.key)}
            <th scope="col" class="text-cell" class:negative={column.kind === 'liability'} title={`${column.name} (${column.currency})`}>{column.name}<small>{column.currency}</small></th>
            <th scope="col">% change</th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each table.rows as row (row.bucket)}
          <tr>
            <th scope="row" class="text-cell">{bucketLabel(row.bucket)}</th>
            {#each table.columns as column (column.key)}
              {@const cell = row.cells[column.key]}
              {@const isLiability = column.kind === 'liability'}
              <td class="value-cell" class:negative={isLiability && (cell?.value ?? 0) < 0}>{valueLabel(cell?.value)}</td>
              <td class="change-cell" class:positive={cell?.change != null && cell.change > 0} class:negative={cell?.change != null && cell.change < 0}>{changeLabel(cell?.change)}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .monthly-history-wrap { width: 100%; min-width: 0; max-width: 100%; margin-top: 2px; border: 1px solid var(--line); border-radius: 10px; }
  .monthly-history-table { min-width: 520px; }
  .monthly-history-table col.history-month { width: 120px; }
  .monthly-history-table col.history-value { width: 130px; }
  .monthly-history-table col.history-change { width: 90px; }
  .monthly-history-table caption { caption-side: top; text-align: left; padding: 9px 10px; color: var(--muted); font-size: 0.76rem; }
  .monthly-history-table th, .monthly-history-table td { padding: 8px 10px; }
  .monthly-history-table th:first-child, .monthly-history-table td:first-child { position: sticky; left: 0; z-index: 1; background: var(--panel); }
  .monthly-history-table thead th:first-child { z-index: 2; }
  .monthly-history-table th small { display: block; font-size: 0.65rem; font-weight: 400; margin-top: 1px; }
  .monthly-history-table tbody th { text-align: left; font-weight: 600; }
  .monthly-history-table .value-cell { min-width: 112px; }
  .monthly-history-table .change-cell { min-width: 78px; font-variant-numeric: tabular-nums; }
</style>
