<script>
  /** Small, accessible line chart for dated position/portfolio history. */
  import { displayCurrency, money } from '../stores/finance.js';
  import { num } from '../services/runway.js';
  import { longLabel } from '../services/dates.js';

  let { points = [], title = 'History', emptyMessage = 'Record dated snapshots to see the trend.' } = $props();
  const values = $derived(points.map((point) => num(point.value)));
  const minValue = $derived(Math.min(...values, 0));
  const maxValue = $derived(Math.max(...values, 1));
  const coordinates = $derived(points.map((point, index) => {
    const x = points.length === 1 ? 320 : 24 + (index * 592) / (points.length - 1);
    const y = 184 - ((num(point.value) - minValue) / (maxValue - minValue || 1)) * 150;
    return { ...point, x, y, value: num(point.value) };
  }));
  const path = $derived(coordinates.map((point) => `${point.x},${point.y}`).join(' '));
  const fmt = (value) => money(value, $displayCurrency);
  const label = $derived(points.length ? `${title} from ${longLabel(points[0].date)} to ${longLabel(points.at(-1).date)}` : emptyMessage);
</script>

{#if points.length}
  <div class="trend-visual">
    <svg class="trend-chart" viewBox="0 0 640 220" role="img" aria-label={label}>
      <title>{label}</title>
      <desc>Line chart of {title.toLowerCase()} over time.</desc>
      <line class="trend-zero" x1="24" x2="616" y1={184 - ((0 - minValue) / (maxValue - minValue || 1)) * 150} y2={184 - ((0 - minValue) / (maxValue - minValue || 1)) * 150} />
      <polyline points={path} />
      {#each coordinates as point (point.date)}
        <circle cx={point.x} cy={point.y} r="3"><title>{longLabel(point.date)}: {fmt(point.value)}</title></circle>
      {/each}
    </svg>
    <div class="trend-labels"><span>{longLabel(points[0].date)}</span><span>{longLabel(points.at(-1).date)}</span></div>
  </div>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .trend-visual { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .trend-chart { display: block; width: 100%; height: auto; min-height: 190px; }
  .trend-chart polyline { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  .trend-chart circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; }
  .trend-zero { stroke: var(--line); stroke-width: 1; stroke-dasharray: 4 4; }
  .trend-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.72rem; padding: 0 8px; }
</style>
