<script>
  /**
   * Stacked bar chart for position, investment and pension history.
   *
   * Hand-rolled SVG rather than a charting library: the project has no chart
   * dependency, and a stacked bar with an axis is not worth one. It also keeps
   * the `aria-label`/`desc`/`title` structure a canvas chart would throw away.
   *
   * Two decisions worth knowing, because both change what a bar means:
   *
   *   - A bar shows the value at the END of that year or month - the last
   *     snapshot recorded in it. It reads the same pivot the table below renders,
   *     so the two cannot disagree. The panel says which it is showing.
   *   - Stacking combines each series' closing value on the same date, because
   *     every series in a bucket is taken at its own last snapshot, which is
   *     usually the same day. The tooltip names the date per segment rather than
   *     implying one figure for all of them.
   *
   * A series with no figure for a bucket contributes no segment at all. Drawing
   * a zero-height one would read as "it was worth nothing" rather than "we have
   * no record", which is a different statement.
   */
  import { displayCurrency, money } from '../stores/finance.js';
  import { longLabel } from '../services/dates.js';
  import {
    bucketLabel,
    formatAxisValue,
    labelStride,
    maxStackTotal,
    niceScale,
    stackSegments
  } from '../services/chartScale.js';

  let {
    table = { columns: [], rows: [] },
    hidden = [],
    title = 'History',
    granularity = 'year',
    emptyMessage = 'Record dated snapshots to see growth over time.',
    height = 240
  } = $props();

  const PLOT = { left: 54, right: 12, top: 12, bottom: 28 };
  const WIDTH = 640;
  const plotWidth = WIDTH - PLOT.left - PLOT.right;
  const plotHeight = height - PLOT.top - PLOT.bottom;
  const SWATCHES = ['#0f766e', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777'];

  /**
   * The pivot is the single source of truth. Each series contributes its own
   * closing value per bucket, straight out of the same rows the table renders.
   */
  const allSeries = $derived(
    (table.columns || []).map((column, index) => ({
      key: column.key,
      name: column.name,
      color: SWATCHES[index % SWATCHES.length],
      values: new Map((table.rows || []).map((row) => [row.bucket, row.cells?.[column.key] ?? null]))
    }))
  );

  const visibleSeries = $derived(allSeries.filter((line) => !hidden.includes(line.key)));
  const buckets = $derived((table.rows || []).map((row) => row.bucket));
  const stacks = $derived(stackSegments({ series: visibleSeries, buckets }));

  // Scaled from the stacked totals, not the individual maxima. Scaling from the
  // largest single value puts a 50k stack on a 30k axis and clips it with no
  // error at all. `floorAtZero` because a bar is read as a length from zero.
  const scale = $derived(niceScale([maxStackTotal(stacks)], { floorAtZero: true }));
  const yAt = (value) =>
    PLOT.top + plotHeight - ((Number(value) - scale.min) / (scale.max - scale.min || 1)) * plotHeight;

  const slot = $derived(buckets.length ? plotWidth / buckets.length : plotWidth);
  // A bar never eats the whole slot, and never thins out to nothing.
  const barWidth = $derived(Math.max(3, Math.min(64, slot * 0.62)));
  const centreAt = (index) => PLOT.left + slot * (index + 0.5);

  const stride = $derived(labelStride(buckets.length, plotWidth));
  const fmt = (value) => money(Number(value), $displayCurrency);
  const fmtShort = (value) => formatAxisValue(value);

  const peakRange = $derived.by(() => {
    const dates = visibleSeries
      .flatMap((line) => [...line.values.values()].map((cell) => cell?.date))
      .filter(Boolean)
      .sort();
    return dates.length ? `${longLabel(dates[0])} to ${longLabel(dates.at(-1))}` : '';
  });

  /** Series key -> display name, so a segment tooltip can name itself. */
  const namesByKey = $derived(Object.fromEntries(allSeries.map((line) => [line.key, line.name])));

  /**
   * Tooltip text for one stacked segment, naming the date that bucket's closing
   * value was recorded. Each series is taken at its own last snapshot, so the
   * dates can differ within one bar and the tooltip should not imply otherwise.
   */
  function segmentLabel(bucket, segment, granularity, names) {
    const when = granularity === 'month' ? bucketLabel(bucket, 'month') : bucket;
    const date = visibleSeries.find((line) => line.key === segment.key)?.values?.get(bucket)?.date;
    return `${names?.[segment.key] || segment.key} · ${when}${date ? ` (${longLabel(date)})` : ''}`;
  }

  const a11yLabel = $derived(
    `Stacked bar chart of ${title.toLowerCase()} at the end of each ${granularity}. ` +
      `Vertical axis from ${fmtShort(scale.min)} to ${fmtShort(scale.max)}. ` +
      `${visibleSeries.length} series shown: ${visibleSeries.map((line) => line.name).join(', ') || 'none'}.`
  );
</script>



{#if buckets.length && allSeries.some((line) => [...line.values.values()].some((cell) => cell?.value !== null && cell?.value !== undefined))}
  <div class="trend-visual">
    <div class="trend-head">
      <p class="eyebrow">{granularity === 'month' ? 'VALUE AT END OF MONTH' : 'VALUE AT END OF YEAR'}</p>
      <p class="hint">
        The last value recorded in each {granularity}{visibleSeries.length > 1 ? ', stacked by series' : ''}{peakRange ? `. Span ${peakRange}` : ''}.
      </p>
    </div>

    <svg
      class="trend-chart"
      viewBox={`0 0 ${WIDTH} ${height}`}
      role="img"
      aria-label={a11yLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      <title>{a11yLabel}</title>
      <desc>
        Stacked bars of {title.toLowerCase()} at the end of each {granularity}, {buckets.length} bars.
        The vertical axis runs from {fmtShort(scale.min)} to {fmtShort(scale.max)}.
      </desc>

      {#each scale.ticks as tick (tick.value)}
        <line class="trend-grid" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={yAt(tick.value)} y2={yAt(tick.value)} />
        <text class="trend-axis-label" x={PLOT.left - 8} y={yAt(tick.value) + 3} text-anchor="end">
          {fmtShort(tick.value)}
        </text>
      {/each}

      {#each stacks as stack, index (stack.bucket)}
        {#each stack.segments as segment (segment.key)}
          {@const top = yAt(segment.to)}
          {@const bottom = yAt(segment.from)}
          <rect
            class="trend-bar"
            x={centreAt(index) - barWidth / 2}
            y={top}
            width={barWidth}
            height={Math.max(1, bottom - top)}
            fill={segment.color}
          >
            <title>
              {segmentLabel(stack.bucket, segment, granularity, namesByKey)}: {fmt(segment.value)}
            </title>
          </rect>
        {/each}
        {#if stack.total}
          <text class="trend-total" x={centreAt(index)} y={yAt(stack.total) - 5} text-anchor="middle">
            {fmtShort(stack.total)}
          </text>
        {/if}
      {/each}

      {#each buckets as bucket, index (bucket)}
        {#if index % stride === 0}
          <text class="trend-month-label" x={centreAt(index)} y={height - 9} text-anchor="middle">
            {bucketLabel(bucket, granularity)}
          </text>
        {/if}
      {/each}
    </svg>
  </div>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .trend-visual { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .trend-head { padding: 0 4px 6px; }
  .trend-head .eyebrow { margin: 0 0 2px; }
  .trend-head .hint { margin: 0; }
  .trend-chart { display: block; width: 100%; height: auto; }
  .trend-bar { shape-rendering: crispEdges; }
  .trend-bar:hover { opacity: 0.82; }
  .trend-grid { stroke: var(--line); stroke-width: 1; opacity: 0.55; }
  .trend-axis-label { fill: var(--muted); font-size: 10px; }
  .trend-month-label { fill: var(--muted); font-size: 10px; }
  .trend-total { fill: var(--muted); font-size: 9px; }
  @media (max-width: 560px) { .trend-axis-label, .trend-month-label { font-size: 11px; } }
</style>


