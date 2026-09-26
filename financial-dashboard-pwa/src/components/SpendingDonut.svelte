<script>
  /** Accessible, dependency-free category doughnut for current-month spending. */
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';
  import { num } from '../services/runway.js';

  let {
    categories = [],
    total = 0,
    currency = 'USD',
    emptyMessage = 'Add bills or Spend Items to see the category breakdown.'
  } = $props();

  const colors = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777'];
  const active = $derived(categories.filter((row) => num(row.value) > 0));
  const totalValue = $derived(num(total) || active.reduce((sum, row) => sum + num(row.value), 0));
  const fmt = (value) => money(convertCurrency(value, currency, $displayCurrency), $displayCurrency);
  const gradient = $derived.by(() => {
    if (!totalValue) return 'var(--panel-alt)';
    let cursor = 0;
    const stops = active.map((row, index) => {
      const start = cursor;
      cursor += (num(row.value) / totalValue) * 100;
      return `${colors[index % colors.length]} ${start}% ${cursor}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  });
  const label = $derived(`Current month spending total ${fmt(totalValue)}`);
</script>

<div class="spending-breakdown">
  {#if active.length}
    <div class="spending-donut" style={`background: ${gradient}`} role="img" aria-label={label}>
      <div class="donut-hole">
        <strong>{fmt(totalValue)}</strong>
        <small>Total</small>
      </div>
    </div>
    <ul class="spending-legend" aria-label="Spending categories">
      {#each active as row, index (row.category)}
        {@const share = totalValue ? (num(row.value) / totalValue) * 100 : 0}
        <li>
          <span class="legend-swatch" style={`background: ${colors[index % colors.length]}`}></span>
          <span class="legend-name">{row.category}</span>
          <span class="legend-value">{fmt(row.value)} · {share.toFixed(1)}%</span>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="muted">{emptyMessage}</p>
  {/if}
</div>

<style>
  .spending-breakdown { display: grid; grid-template-columns: minmax(min(150px, 100%), 190px) minmax(0, 1fr); gap: 18px; align-items: center; }
  .spending-donut { width: 170px; aspect-ratio: 1; border-radius: 50%; display: grid; place-items: center; }
  .donut-hole { width: 106px; aspect-ratio: 1; border-radius: 50%; background: var(--panel); display: grid; place-content: center; text-align: center; }
  .donut-hole strong { font-size: 1.05rem; }
  .donut-hole small { color: var(--muted); }
  .spending-legend { list-style: none; padding: 0; margin: 0; display: grid; gap: 7px; }
  .spending-legend li { display: grid; grid-template-columns: 12px minmax(0, 1fr) minmax(0, auto); gap: 7px; align-items: center; font-size: 0.82rem; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 3px; }
  .legend-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-value { min-width: 0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; color: var(--muted); text-align: right; white-space: nowrap; }
  @media (max-width: 560px) { .spending-breakdown { grid-template-columns: 1fr; justify-items: center; } .spending-legend { width: 100%; } }
</style>
