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
  const chartValues = $derived(rows.map((row) => convertCurrency(row.ending, currency, $displayCurrency)));
  const chartMin = $derived(Math.min(0, ...chartValues));
  const chartMax = $derived(Math.max(1, ...chartValues));
  const chartPoints = $derived(
    rows
      .map((row, index) => {
        const x = rows.length === 1 ? 320 : 24 + (index * 592) / (rows.length - 1);
        const value = convertCurrency(row.ending, currency, $displayCurrency);
        const y = 184 - ((value - chartMin) / (chartMax - chartMin || 1)) * 150;
        return `${x},${y}`;
      })
      .join(' ')
  );
  const spendPercent = $derived(obligationTotal > 0 ? (scheduledCommitments / obligationTotal) * 100 : 0);
  const billPercent = $derived(obligationTotal > 0 ? (scheduledBills / obligationTotal) * 100 : 0);
  const chartLabel = $derived(
    rows.length
      ? `Projected balance from ${rows[0].shortLabel} through ${rows[rows.length - 1].shortLabel}`
      : emptyMessage
  );
</script>

{#if !rows.length}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="runway-visual">
    <div class="runway-chart-wrap">
      <svg class="runway-chart" viewBox="0 0 640 220" role="img" aria-label={chartLabel}>
        <title>{chartLabel}</title>
        <desc>Ending balance after safe daily spending, Spend Items and scheduled bills.</desc>
        <line class="runway-zero" x1="24" x2="616" y1={184 - ((0 - chartMin) / (chartMax - chartMin || 1)) * 150} y2={184 - ((0 - chartMin) / (chartMax - chartMin || 1)) * 150} />
        <polyline points={chartPoints} />
        {#each rows as row, index}
          {@const value = convertCurrency(row.ending, currency, $displayCurrency)}
          {@const x = rows.length === 1 ? 320 : 24 + (index * 592) / (rows.length - 1)}
          {@const y = 184 - ((value - chartMin) / (chartMax - chartMin || 1)) * 150}
          <circle cx={x} cy={y} r="3">
            <title>{row.shortLabel}: {fmt(row.ending)}</title>
          </circle>
        {/each}
      </svg>
      <div class="runway-chart-labels"><span>{rows[0].shortLabel}</span><span>{rows[rows.length - 1].shortLabel}</span></div>
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
  .runway-chart circle { fill: var(--panel); stroke: var(--accent); stroke-width: 2; }
  .runway-zero { stroke: var(--line); stroke-width: 1; stroke-dasharray: 4 4; }
  .runway-chart-labels { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.72rem; padding: 0 8px; }
  .obligation-breakdown { display: grid; gap: 10px; }
  .obligation-breakdown .section-heading { align-items: center; }
  .obligation-row { display: grid; gap: 5px; }
  .obligation-row > div:first-child { display: flex; justify-content: space-between; gap: 12px; font-size: 0.82rem; }
  .obligation-row .progress { height: 9px; }
  .obligation-row .progress > span { background: var(--accent); }
  .obligation-row .progress > span.bill-bar { background: var(--warning); }
</style>