<script>
  /** Stacked annual pension projection matching the workbook's five-series chart intent. */
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';
  import { num } from '../services/runway.js';

  let { projection = { series: [], points: [], monthlyPoints: [] }, emptyMessage = 'Add pension pots or snapshots to see a projection.' } = $props();
  const palette = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2'];
  const series = $derived(projection.series || []);
  const points = $derived(projection.points || []);
  const monthlyRows = $derived((projection.monthlyPoints || []).slice(0, 13));
  const fmt = (value, from = 'USD') => money(convertCurrency(value, from, $displayCurrency), $displayCurrency);
  const bars = $derived.by(() => points.map((point) => {
    const segments = series.map((item, index) => ({
      name: item.name,
      currency: item.currency,
      color: palette[index % palette.length],
      value: convertCurrency(num(point.values?.[index]), item.currency, $displayCurrency),
      rawValue: num(point.values?.[index])
    })).filter((item) => item.value > 0);
    const value = segments.reduce((sum, item) => sum + item.value, 0);
    return { year: point.year, value, segments };
  }));
  const maxValue = $derived(Math.max(1, ...bars.map((bar) => bar.value)));
  const chartLabel = $derived(series.length ? `Projected pension value by year through ${bars.at(-1)?.year ?? 0}` : emptyMessage);
</script>

{#if series.length && bars.length}
  <div class="pension-projection" aria-label={chartLabel}>
    <div class="projection-plot" role="img" aria-label={chartLabel}>
      <div class="projection-bars">
        {#each bars as bar (bar.year)}
          {@const height = Math.max(2, (bar.value / maxValue) * 100)}
          <div class="projection-column">
            <div class="projection-stack" style={`height: ${height}%`} title={`${bar.year === 0 ? 'Now' : `Year ${bar.year}`}: ${fmt(bar.value, $displayCurrency)}`}>
              {#each bar.segments as segment (segment.name)}
                <span
                  class="projection-segment"
                  style={`height: ${bar.value ? (segment.value / bar.value) * 100 : 0}%; background: ${segment.color}`}
                  title={`${segment.name}: ${fmt(segment.rawValue, segment.currency)}`}
                ></span>
              {/each}
            </div>
            <small>{bar.year === 0 ? 'Now' : `Y${bar.year}`}</small>
          </div>
        {/each}
      </div>
    </div>
    <ul class="projection-legend" aria-label="Pension series">
      {#each series as item, index (item.id || item.name + item.currency)}
        <li>
          <span class="legend-swatch" style={`background: ${palette[index % palette.length]}`}></span>
          <span>{item.name}<small>{(item.annualRate * 100).toFixed(2)}% annual · {item.monthlyRate * 100 < 0 ? '' : '+'}{(item.monthlyRate * 100).toFixed(3)}% monthly</small></span>
        </li>
      {/each}
    </ul>
    <p class="hint">Each pot compounds monthly using (1 + annual rate)<sup>1/12</sup> − 1; annual bars show the value after twelve compounded months.</p>
    <details class="monthly-details">
      <summary>Next 12 months (compounded)</summary>
      <div class="table-scroll monthly-table-wrap">
        <table class="monthly-projection-table">
          <thead>
            <tr>
              <th>Month</th>
              {#each series as item (item.id || item.name + item.currency)}
                <th>{item.name}</th>
                <th>% MoM</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each monthlyRows as row (row.month)}
              <tr>
                <td>{row.month === 0 ? 'Now' : `M${row.month}`}</td>
                {#each series as item, index (item.id || item.name + item.currency)}
                  <td>{fmt(row.values?.[index], item.currency)}</td>
                  <td class="expected-change">
                    {row.month === 0
                      ? '—'
                      : `${item.monthlyRate >= 0 ? '+' : ''}${(item.monthlyRate * 100).toFixed(3)}%`}
                  </td>
                {/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </details>
  </div>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .pension-projection { display: grid; gap: 10px; }
  .projection-plot { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 10px; padding: 12px 12px 8px; overflow-x: auto; }
  .projection-bars { min-width: 560px; height: 220px; display: flex; align-items: end; gap: 8px; }
  .projection-column { height: 100%; flex: 1; min-width: 28px; display: flex; flex-direction: column; justify-content: end; align-items: center; gap: 5px; }
  .projection-stack { width: min(34px, 80%); min-height: 2px; display: flex; flex-direction: column-reverse; justify-content: start; border-radius: 5px 5px 2px 2px; overflow: hidden; background: var(--line); }
  .projection-segment { display: block; width: 100%; min-height: 1px; }
  .projection-column small { color: var(--muted); font-size: 0.68rem; }
  .projection-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 0; margin: 0; font-size: 0.78rem; }
  .projection-legend li { display: inline-flex; align-items: center; gap: 5px; }
  .projection-legend small { display: block; font-size: 0.65rem; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .monthly-details { border-top: 1px solid var(--line); padding-top: 8px; }
  .monthly-details summary { cursor: pointer; color: var(--accent); font-size: 0.82rem; }
  .monthly-table-wrap { margin-top: 8px; }
  .monthly-projection-table { min-width: 720px; width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .monthly-projection-table th, .monthly-projection-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  .monthly-projection-table th:first-child, .monthly-projection-table td:first-child { text-align: left; }
  .monthly-projection-table th { color: var(--muted); }
</style>
