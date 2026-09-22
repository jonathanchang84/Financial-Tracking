<script>
  import {
    displayCurrency, money, convertCurrency, RATES, settings,
    bills, commitments, netWorthEntries, holdings, pensions, netWorthHistory
  } from '../stores/finance.js';
  import { buildDailyRunway, codeOf, num } from '../services/recordHelpers.js';

  const codes = Object.keys(RATES || { USD: 1 });

  function convertedSum(rows, valueOf) {
    return (rows || []).reduce((sum, row) => {
      const sign = String(row.kind || '').toLowerCase() === 'liability' ? -1 : 1;
      return sum + convertCurrency(sign * valueOf(row), codeOf(row), $displayCurrency);
    }, 0);
  }

  $: position = convertedSum($netWorthEntries, (row) => num(row.value));
  $: invested = ($holdings || []).reduce((sum, row) => sum + convertCurrency(num(row.quantity) * num(row.price) || num(row.value), codeOf(row), $displayCurrency), 0);
  $: pensionValue = convertedSum($pensions, (row) => num(row.value));
  $: balance = num($settings?.balance ?? $settings?.currentAvailableBalance);
  $: balanceCurrency = $settings?.balanceCurrency || $settings?.currentBalanceCurrencyCode || 'USD';
  $: payday = $settings?.payday || $settings?.nextPayDate || '';
  $: runway = buildDailyRunway({ balance, currency: balanceCurrency, payday, bills: $bills || [], commitments: $commitments || [] });
  $: safe = runway[0]?.safe ?? 0;
  $: atPayday = runway.length ? runway[runway.length - 1].ending : 0;
  $: growth = (() => {
    const points = ($netWorthHistory || [])
      .map((row) => ({ date: String(row.date || ''), value: convertCurrency(num(row.value), codeOf(row), $displayCurrency) }))
      .sort((a, b) => a.date.localeCompare(b.date));
    if (points.length < 2 || !points[points.length - 2].value) return '—';
    const pct = ((points[points.length - 1].value - points[points.length - 2].value) / Math.abs(points[points.length - 2].value)) * 100;
    return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}% vs prior snapshot`;
  })();

  function show(amount, from = balanceCurrency) {
    return money(convertCurrency(num(amount), from, $displayCurrency), $displayCurrency);
  }
</script>

<section class="fh-grid">
  <div class="fh-row">
    <div>
      <p class="eyebrow">OVERVIEW</p>
      <h2>Headline position</h2>
    </div>
    <label>Display currency
      <select value={$displayCurrency} on:change={(e) => displayCurrency.set(e.currentTarget.value)}>
        {#each codes as code}<option value={code}>{code}</option>{/each}
      </select>
    </label>
  </div>
  <div class="fh-metrics">
    <article class="fh-metric"><p class="eyebrow">NET POSITION</p><strong>{money(position, $displayCurrency)}</strong><p class="muted">{growth}</p></article>
    <article class="fh-metric"><p class="eyebrow">INVESTMENTS</p><strong>{money(invested, $displayCurrency)}</strong></article>
    <article class="fh-metric"><p class="eyebrow">PENSIONS</p><strong>{money(pensionValue, $displayCurrency)}</strong></article>
    <article class="fh-metric"><p class="eyebrow">SAFE EACH DAY</p><strong>{show(safe)}</strong><p class="muted">Through {payday || 'payday'}</p></article>
    <article class="fh-metric"><p class="eyebrow">AT PAYDAY</p><strong>{show(atPayday)}</strong></article>
  </div>
  <section class="panel">
    <p class="eyebrow">DAILY RUNWAY</p>
    <div class="fh-scroll">
      <table class="fh-table">
        <thead><tr><th>Date</th><th>Starting</th><th>Safe</th><th>Commitments</th><th>Cumulative</th><th>Bills</th><th>Ending</th></tr></thead>
        <tbody>
          {#each runway.slice(0, 8) as row}
            <tr>
              <td>{row.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</td>
              <td>{show(row.starting)}</td><td>{show(row.safe)}</td><td>{show(row.commitments)}</td>
              <td>{show(row.cumulative)}</td><td>{show(row.bills)}</td><td>{show(row.ending)}</td>
            </tr>
          {:else}
            <tr><td colspan="7">Set a balance and payday on Cash flow to see the runway.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
  </section>
</section>
