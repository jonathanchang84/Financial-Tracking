<script>
  /** Lightweight, dependency-free runway trajectory and obligation breakdown. */
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';

  let {
    rows = [],
    currency = 'USD',
    scheduledBills = 0,
    scheduledCommitments = 0,
    obligationTotal = 0,
    truncated = false,
    emptyMessage = 'Set your balance and payday to see the runway visualization.'
  } = $props();

  const fmt = (value) => money(convertCurrency(value, currency, $displayCurrency), $displayCurrency);
  // Unanchored days have no ending balance, so they take no part in the line's
  // scale. Including a placeholder zero here would drag the axis down and make
  // every real reading look compressed.
  const plottable = $derived(rows.filter((row) => row.ending !== null && row.ending !== undefined));
  const chartValues = $derived(plottable.map((row) => convertCurrency(row.ending, currency, $displayCurrency)));
  const chartMin = $derived(Math.min(0, ...chartValues));
  const chartMax = $derived(Math.max(1, ...chartValues));
  const xFor = (row) => (rows.length === 1 ? 320 : 24 + (rows.indexOf(row) * 592) / (rows.length - 1));
  const yFor = (value) => 184 - ((value - chartMin) / (chartMax - chartMin || 1)) * 150;
  const pointsFor = (subset) => subset.map((row) => `${xFor(row)},${yFor(convertCurrency(row.ending, currency, $displayCurrency))}`).join(' ');

  // The cycle view runs from a payday in the past, so the line is drawn in two
  // tones either side of today: muted for what has happened, accent for what is
  // still projected. Splitting on the row flags means the boundary is the same
  // one the table shades on, rather than a second guess at where today is.
  const pastRows = $derived(plottable.filter((row) => row.isPast));
  const futureRows = $derived(plottable.filter((row) => !row.isPast));
  const todayRow = $derived(plottable.find((row) => row.isToday) || null);
  // The connector across today: without it the two tones leave a visible gap
  // between yesterday and tomorrow, which reads as missing data.
  const bridgeRows = $derived(
    todayRow ? [pastRows.at(-1), todayRow, futureRows[0]].filter(Boolean) : []
  );
  const spendPercent = $derived(obligationTotal > 0 ? (scheduledCommitments / obligationTotal) * 100 : 0);
  const billPercent = $derived(obligationTotal > 0 ? (scheduledBills / obligationTotal) * 100 : 0);
  const chartLabel = $derived(
    plottable.length
      ? `Projected balance from ${plottable[0].shortLabel} through ${plottable[plottable.length - 1].shortLabel}`
      : emptyMessage
  );
</script>

{#if !plottable.length}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="runway-visual">
    <div class="runway-chart-wrap">
      <svg class="runway-chart" viewBox="0 0 640 220" role="img" aria-label={chartLabel}>
        <title>{chartLabel}</title>
        <desc>Actual ending balance after Spend Items and scheduled bills; hypothetical safe spending is not deducted. Days already past are drawn in a muted tone and the shaded band marks today onwards as the projection.</desc>
        <line class="runway-zero" x1="24" x2="616" y1={yFor(0)} y2={yFor(0)} />
        <!-- The projection band: a wash behind everything from today rightwards,
             so "what has happened" and "what is still to come" are separable at a
             glance without having to read the axis labels. -->
        {#if todayRow}
          <rect
            class="runway-future-band"
            x={Math.min(24, xFor(todayRow))}
            y="8"
            width={Math.max(0, 616 - xFor(todayRow))}
            height="196"
          />
          <line class="runway-today" x1={xFor(todayRow)} x2={xFor(todayRow)} y1="8" y2="204" />
        {/if}
        {#if pastRows.length > 1}
          <polyline class="runway-past" points={pointsFor(pastRows)} />
        {/if}
        {#if futureRows.length > 1}
          <polyline points={pointsFor(futureRows)} />
        {/if}
        <!-- Where today splits the two tones, one continuous line is drawn under
             them so the curve is not visually broken at the boundary. -->
        {#if bridgeRows.length > 1}
          <polyline class="runway-bridge" points={pointsFor(bridgeRows)} />
        {/if}
        {#each plottable as row}
          {@const value = convertCurrency(row.ending, currency, $displayCurrency)}
          <circle
            class:past={row.isPast}
            class:recorded={row.isRecorded}
            cx={xFor(row)}
            cy={yFor(value)}
            r={row.isToday ? 4 : 3}
          >
            <title>{row.shortLabel}: {fmt(row.ending)}{row.isRecorded ? ' (balance recorded)' : ''}</title>
          </circle>
        {/each}
      </svg>
      <div class="runway-chart-labels"><span>{plottable[0].shortLabel}</span><span>{plottable[plottable.length - 1].shortLabel}</span></div>
      <p class="runway-legend">
        <span><i class="key past"></i>Past days</span>
        <span><i class="key future"></i>Today onwards</span>
        <span><i class="key recorded"></i>Balance recorded</span>
      </p>
    </div>

    <div class="obligation-breakdown" aria-label="Planned obligations">
      <div class="section-heading"><div><p class="eyebrow">PLANNED OBLIGATIONS</p><h4>Where the runway goes</h4></div><strong>{fmt(obligationTotal)}</strong></div>
      <div class="obligation-row">
        <div><span>Spend Items</span><strong>{fmt(scheduledCommitments)}</strong></div>
        <div class="progress" role="progressbar" aria-label="Spend Items share" aria-valuemin="0" aria-valuemax="100" aria-valuenow={spendPercent}><span style={`width: ${spendPercent}%`}></span></div>
      </div>
      <div class="obligation-row">
        <div><span>Scheduled bills</span><strong>{fmt(scheduledBills)}</strong></div>
        <div class="progress" role="progressbar" aria-label="Scheduled bills share" aria-valuemin="0" aria-valuemax="100" aria-valuenow={billPercent}><span class="bill-bar" style={`width: ${billPercent}%`}></span></div>
      </div>
    </div>
    {#if truncated}<p class="hint">The chart shows the first {rows.length} days; the summary above uses the complete payday cycle.</p>{/if}
  </div>
{/if}

<style>
  .runway-visual { display: grid; gap: 16px; margin-top: 16px; }
  .runway-chart-wrap { background: var(--panel-alt); border: 1px solid var(--line); border-radius: 10px; padding: 10px; }
  .runway-chart { display: block; width: 100%; height: auto; min-height: 190px; }
  .runway-chart polyline { fill: none; stroke: var(--accent); stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
  /* The past tone is a dashed muted line rather than a lighter accent: colour
     alone would fail anyone who cannot separate the two hues, and the table it
     sits above carries the same distinction by shading. */
  .runway-chart polyline.runway-past { stroke: var(--muted); stroke-width: 2; stroke-dasharray: 5 4; opacity: 0.75; }
  .runway-chart polyline.runway-bridge { stroke-width: 3; opacity: 0.9; }
  .runway-chart circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; }
  .runway-chart circle.past { stroke: var(--muted); }
  /* A filled marker for a recorded balance, so a measured reading is separable
     from one merely carried forward. */
  .runway-chart circle.recorded { fill: var(--accent); stroke: var(--panel); }
  .runway-zero { stroke: var(--line); stroke-width: 1; stroke-dasharray: 4 4; }
  .runway-future-band { fill: var(--today-fill); }
  .runway-today { stroke: var(--muted); stroke-width: 1; stroke-dasharray: 3 3; }
  .runway-chart-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.72rem; padding: 0 8px; }
  .runway-legend {
    display: flex; gap: 14px; flex-wrap: wrap; margin: 8px 8px 0;
    color: var(--muted); font-size: 0.72rem;
  }
  .runway-legend span { display: inline-flex; align-items: center; gap: 5px; }
  .runway-legend .key { width: 14px; height: 0; border-top: 2px solid var(--accent); }
  .runway-legend .key.past { border-top: 2px dashed var(--muted); }
  .runway-legend .key.future { border-top: 2px solid var(--accent); }
  .runway-legend .key.recorded { border-top: none; width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
  .obligation-breakdown { display: grid; gap: 10px; }
  .obligation-breakdown .section-heading { align-items: center; }
  .obligation-row { display: grid; gap: 5px; }
  .obligation-row > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 0.82rem; }
  .obligation-row .progress { height: 9px; }
  .obligation-row .progress > span { background: var(--accent); }
  .obligation-row .progress > span.bill-bar { background: var(--warning); }
</style>