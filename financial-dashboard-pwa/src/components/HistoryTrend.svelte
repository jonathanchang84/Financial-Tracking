<script>
  /**
   * Small, accessible line chart for dated position/portfolio history.
   *
   * Hand-rolled SVG rather than a charting library: the project has no chart
   * dependency, and this only needs a line, an axis and a legend. It also keeps
   * the `aria-label`/`desc`/`title` structure a canvas chart would throw away,
   * which matters for a finance app.
   *
   * Takes either a single series (`points`) or several (`series`). The monthly
   * history table has one column per item, so the chart mirrors that.
   *
   * A `null` value is a month with no record and the line breaks there. The
   * monthly table fills gaps with `null` deliberately, and joining across one
   * would claim a pension was worth nothing.
   */
  import { displayCurrency, money } from '../stores/finance.js';
  import { num } from '../services/runway.js';
  import { longLabel } from '../services/dates.js';
  import { formatAxisValue, niceScale, splitIntoRuns } from '../services/chartScale.js';

  let {
    points = [],
    series = [],
    title = 'History',
    emptyMessage = 'Record dated snapshots to see the trend.',
    height = 200
  } = $props();

  // Plot area inside the viewBox. The left gutter holds the y labels, so it is
  // generous: "12.4k" needs room at the display size.
  const PLOT = { left: 52, right: 16, top: 12, bottom: 26 };
  const WIDTH = 640;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = height - PLOT.top - PLOT.bottom;
  const SWATCHES = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

  /** Normalised to one shape, so single and multi series share all the maths. */
  const lines = $derived.by(() => {
    if (series.length) {
      return series.map((item, index) => ({
        key: item.key,
        name: item.name,
        points: item.points || [],
        color: SWATCHES[index % SWATCHES.length],
        total: false
      }));
    }
    if (!points.length) return [];
    return [{ key: 'value', name: title, points, color: SWATCHES[0], total: true }];
  });

  const allValues = $derived(lines.flatMap((line) => line.points.map((point) => num(point.value))));
  const scale = $derived(niceScale(allValues));
  const monthCount = $derived(Math.max(...lines.map((line) => line.points.length), 0));

  /** X is by month index, not by date, so gaps stay evenly spaced. */
  const xAt = (index) =>
    PLOT.left + (monthCount === 1 ? plotWidth / 2 : (index * plotWidth) / (monthCount - 1));
  const yAt = (value) =>
    PLOT.top + plotHeight - ((num(value) - scale.min) / (scale.max - scale.min || 1)) * plotHeight;

  const drawnLines = $derived(
    lines.map((line) => ({
      ...line,
      runs: splitIntoRuns(line.points).map((run) =>
        run.map((point, index) => `${xAt(index)},${yAt(point.value)}`).join(' ')
      )
    }))
  );

  const zeroY = $derived.by(() => (scale.min > 0 || scale.max < 0 ? null : yAt(0)));
  const monthLabels = $derived((lines[0]?.points || []).map((point) => longLabel(point.date)));
  const fmt = (value) => money(num(value), $displayCurrency);
  const a11yLabel = $derived(
    `${title} by month, ${monthLabels.length ? `${monthLabels[0]} to ${monthLabels.at(-1)}` : ''}, ` +
      `from ${formatAxisValue(scale.min)} to ${formatAxisValue(scale.max)}`
  );
</script>


{#if lines.some((line) => line.points.length)}
  <div class="trend-visual">
    <svg
      class="trend-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={a11yLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{a11yLabel}</title>
      <desc>
        Line chart of {title.toLowerCase()} by month. The vertical axis runs from
        {formatAxisValue(scale.min)} to {formatAxisValue(scale.max)}.
        {#each lines as line (line.key)}{line.name} has
        {line.points.filter((point) => point.value !== null && point.value !== undefined).length}
        recorded month(s).{/each}
      </desc>

      <!-- Gridlines carry the value, which is the point of the exercise: the
           numbers on the left are readable without hovering anything. -->
      {#each scale.ticks as tick (tick.value)}
        <line
          class="trend-grid"
          x1={PLOT.left}
          x2={WIDTH - PLOT.right}
          y1={PLOT.top + plotHeight - tick.ratio * plotHeight}
          y2={PLOT.top + plotHeight - tick.ratio * plotHeight}
        />
        <text
          class="trend-axis-label"
          x={PLOT.left - 8}
          y={PLOT.top + plotHeight - tick.ratio * plotHeight + 3}
          text-anchor="end"
        >{formatAxisValue(tick.value)}</text>
      {/each}

      {#if zeroY !== null}
        <line class="trend-zero" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={zeroY} y2={zeroY} />
      {/if}

      {#each drawnLines as line (line.key)}
        {#each line.runs as runPoints, index (index)}
          <polyline class="trend-line" points={runPoints} style={`stroke: ${line.color}`} />
        {/each}
        <!-- Points only on a single series: with many series and months they
             overlap into a solid band. Exact values stay on hover and in the
             table beneath. -->
        {#if line.total && line.points.length <= 60}
          {#each splitIntoRuns(line.points) as run (run[0]?.date)}
            {#each run as point, index (point.date)}
              <circle cx={xAt(index)} cy={yAt(point.value)} r="3">
                <title>{longLabel(point.date)}: {fmt(point.value)}</title>
              </circle>
            {/each}
          {/each}
        {/if}
      {/each}

      <!-- Month labels on the x axis, three only so they never collide. -->
      {#if monthCount > 1}
        {#each [...new Set([0, Math.floor((monthCount - 1) / 2), monthCount - 1])] as index (index)}
          <text
            class="trend-month-label"
            x={xAt(index)}
            y={height - 8}
            text-anchor={index === 0 ? 'start' : index === monthCount - 1 ? 'end' : 'middle'}
          >{monthLabels[index] || ''}</text>
        {/each}
      {/if}
    </svg>

    {#if lines.length > 1}
      <ul class="trend-legend" aria-label="{title} series">
        {#each lines as line (line.key)}
          <li><span class="legend-swatch" style={`background: ${line.color}`}></span>{line.name}</li>
        {/each}
      </ul>
    {/if}
  </div>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .trend-visual { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .trend-chart { display: block; width: 100%; height: auto; }
  .trend-line { fill: none; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
  .trend-grid { stroke: var(--line); stroke-width: 1; opacity: 0.55; }
  .trend-zero { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 4 4; }
  .trend-axis-label { fill: var(--muted); font-size: 10px; }
  .trend-month-label { fill: var(--muted); font-size: 10px; }
  .trend-chart circle { fill: var(--panel); stroke-width: 2; }
  .trend-legend {
    list-style: none; padding: 8px 4px 0; margin: 0; display: flex; flex-wrap: wrap;
    gap: 6px 16px; font-size: 0.74rem; color: var(--muted);
  }
  .trend-legend li { display: flex; align-items: center; gap: 6px; }
  .legend-swatch { width: 10px; height: 3px; border-radius: 2px; }
  @media (max-width: 560px) { .trend-axis-label, .trend-month-label { font-size: 11px; } }
</style>

