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
    return { year: point.year, calendarYear: point.calendarYear ?? point.year, value, segments };
  }));
  const maxValue = $derived(Math.max(1, ...bars.map((bar) => bar.value)));
  const chartLabel = $derived(series.length
    ? `Projected pension value by calendar year from ${bars[0]?.calendarYear ?? ''} through ${bars.at(-1)?.calendarYear ?? ''}`
    : emptyMessage);
</script>

{#if series.length && bars.length}
  <div class="pension-projection" aria-label={chartLabel}>
    <div class="projection-plot" role="img" aria-label={chartLabel}>
      <div class="projection-bars" style={`--projection-years: ${bars.length}`}>
        {#each bars as bar (bar.year)}
          {@const height = Math.max(2, (bar.value / maxValue) * 100)}
          <div class="projection-column">
            <div class="projection-stack" style={`height: ${height}%`} title={`${bar.calendarYear}: ${fmt(bar.value, $displayCurrency)}`}>
              {#each bar.segments as segment (segment.name)}
                <span
                  class="projection-segment"
                  style={`height: ${bar.value ? (segment.value / bar.value) * 100 : 0}%; background: ${segment.color}`}
                  title={`${segment.name}: ${fmt(segment.rawValue, segment.currency)}`}
                ></span>
              {/each}
            </div>
            <small class="projection-year">{bar.calendarYear}</small>
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
    <p class="hint">Calendar years are shown along the bottom. Each pot compounds monthly using (1 + annual rate)<sup>1/12</sup> − 1; annual bars show the value after twelve compounded months.</p>
    {#if bars.length > 20}
      <p class="hint projection-scroll-hint">Scroll horizontally to see every calendar year.</p>
    {/if}
    <details class="monthly-details">
      <summary>Next 12 months (compounded)</summary>
      <div class="table-scroll monthly-table-wrap">
        <table class="fh-table monthly-projection-table">
          <colgroup>
            <col class="projection-month" />
            {#each series as item (item.id || item.name + item.currency)}
              <col class="projection-value" />
              <col class="projection-change" />
            {/each}
          </colgroup>
          <thead>
            <tr>
              <th scope="col" class="text-cell">Month</th>
              {#each series as item (item.id || item.name + item.currency)}
                <th scope="col" class="text-cell">{item.name}</th>
                <th scope="col">% MoM</th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each monthlyRows as row (row.month)}
              <tr>
                <th scope="row" class="text-cell">{row.month === 0 ? 'Now' : `M${row.month}`}</th>
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
  .projection-bars { min-width: max(560px, calc(var(--projection-years) * 42px)); height: 250px; display: flex; align-items: end; gap: 8px; }
  .projection-column { height: 100%; flex: 1 0 34px; min-width: 34px; display: flex; flex-direction: column; justify-content: end; align-items: center; gap: 7px; }
  .projection-stack { width: min(30px, 78%); min-height: 2px; display: flex; flex-direction: column-reverse; justify-content: start; border-radius: 5px 5px 2px 2px; overflow: hidden; background: var(--line); }
  .projection-segment { display: block; width: 100%; min-height: 1px; }
  .projection-year { color: var(--muted); font-size: 0.72rem; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .projection-scroll-hint { color: var(--accent); }
  .projection-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 8px 14px; padding: 0; margin: 0; font-size: 0.78rem; }
  .projection-legend li { display: inline-flex; align-items: center; gap: 5px; }
  .projection-legend small { display: block; font-size: 0.65rem; }
  .legend-swatch { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
  .monthly-details { border-top: 1px solid var(--line); padding-top: 8px; }
  .monthly-details summary { cursor: pointer; color: var(--accent); font-size: 0.82rem; }
  .monthly-table-wrap { margin-top: 8px; }
  .monthly-projection-table { min-width: 720px; width: 100%; border-collapse: collapse; font-size: 0.8rem; }
  .monthly-projection-table col.projection-month { width: 105px; }
  .monthly-projection-table col.projection-value { width: 140px; }
  .monthly-projection-table col.projection-change { width: 90px; }
  .monthly-projection-table th, .monthly-projection-table td { padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
  .monthly-projection-table th:first-child, .monthly-projection-table td:first-child,
  .monthly-projection-table th.text-cell { text-align: left; }
  .monthly-projection-table th { color: var(--muted); }
</style>
