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
    stackExtent,
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

  // A 45-degree hatch, defined once and referenced by every liability segment.
  // A liability therefore differs from an asset in three independent ways: it
  // hangs below the zero line, it is marked in the legend, and it is hatched.
  // Colour alone would fail in greyscale and for anyone who cannot separate the
  // hues, which is the one case where misreading a liability as an asset matters.
  const LIABILITY_HATCH = 'url(#liability-hatch)';

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

  // Scaled from the stacked extents, not the individual maxima or the net total.
  // Scaling from the largest single value puts a 50k stack on a 30k axis and
  // clips it with no error at all; scaling from the net clips whichever side is
  // larger, which is exactly what happens once liabilities exist.
  // `floorAtZero` because a bar is read as a length from zero, and it is what
  // lets one axis span both sides of it.
  const scale = $derived.by(() => {
    const { min, max } = stackExtent(stacks);
    return niceScale([min, max], { floorAtZero: true });
  });
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
        Assets stack above the zero line and liabilities below it.
      </desc>

      <defs>
        <!-- Texture only: the pattern is transparent apart from a dark diagonal,
             so it is drawn OVER the solid series fill. Baking the colour into the
             pattern instead would mean one pattern per series, since `currentColor`
             resolves against the svg rather than the rect that references it. -->
        <pattern id="liability-hatch" width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
          <line x1="0" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="2.5" opacity="0.5" />
        </pattern>
      </defs>

      {#each scale.ticks as tick (tick.value)}
        <line class="trend-grid" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={yAt(tick.value)} y2={yAt(tick.value)} />
        <text class="trend-axis-label" x={PLOT.left - 8} y={yAt(tick.value) + 3} text-anchor="end">
          {fmtShort(tick.value)}
        </text>
      {/each}

      <!-- The zero baseline. Drawn stronger than the grid because assets stack up
           from it and liabilities stack down from it: it is the line that makes
           the two sides readable as one measure rather than two unrelated bars. -->
      {#if scale.min < 0 && scale.max > 0}
        <line class="trend-zero" x1={PLOT.left} x2={WIDTH - PLOT.right} y1={yAt(0)} y2={yAt(0)} />
      {/if}

      {#each stacks as stack, index (stack.bucket)}
        {#each stack.segments as segment (segment.key)}
          {@const top = yAt(segment.to)}
          {@const bottom = yAt(segment.from)}
          <rect
            class="trend-bar"
            class:liability={segment.side === 'liability'}
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
          {#if segment.side === 'liability'}
            <!-- Texture over the solid fill, so the hue is still the series colour
                 and the hatching reads as "this is a liability" on top of it. -->
            <rect
              class="trend-hatch"
              x={centreAt(index) - barWidth / 2}
              y={top}
              width={barWidth}
              height={Math.max(1, bottom - top)}
              fill={LIABILITY_HATCH}
              pointer-events="none"
            />
          {/if}
        {/each}
        {#if stack.net}
          <!-- Anchored above the POSITIVE stack, not the net, so the label clears
               the bar. A net below the top of the assets would otherwise be drawn
               inside the bar it is labelling. -->
          {@const labelY = Math.max(PLOT.top + 8, yAt(stack.top) - 5)}
          <text class="trend-total" x={centreAt(index)} y={labelY} text-anchor="middle">
            Net Value: {fmt(stack.net)}
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
  /* A liability is distinguishable by more than colour: it hangs below the zero
     line, it is marked in the legend, and it carries a diagonal hatch. Colour
     alone would fail in greyscale, in print, and for anyone who cannot separate
     the hues - which is the one case where misreading a liability as an asset
     actually matters. */
  .trend-hatch { color: var(--text); pointer-events: none; }
  .trend-grid { stroke: var(--line); stroke-width: 1; opacity: 0.55; }
  .trend-zero { stroke: var(--text); stroke-width: 1; opacity: 0.45; }
  .trend-axis-label { fill: var(--muted); font-size: 10px; }
  .trend-month-label { fill: var(--muted); font-size: 10px; }
  .trend-total { fill: var(--muted); font-size: 9px; }
  @media (max-width: 560px) { .trend-axis-label, .trend-month-label { font-size: 11px; } }
</style>


