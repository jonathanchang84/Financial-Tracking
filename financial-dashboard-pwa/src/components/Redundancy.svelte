<script>
  /** Workbook-aligned tax-adjusted redundancy runway calculator. */
  import { settings, saveSettings, displayCurrency, money, convertCurrency } from '../stores/finance.js';
  import { redundancyProjection } from '../services/financeCalculations.js';
  import { num } from '../services/runway.js';
  import { errorToast, showToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';

  let form = $state({ payout: '', threshold: '30000', taxRate: '40', spends: ['5800', '5100', '3800'] });
  let syncedKey = '';
  $effect(() => {
    const current = $settings;
    const key = `${current.redundancyPayout}|${current.redundancyTaxFreeThreshold}|${current.redundancyTaxRate}|${JSON.stringify(current.redundancySpends || [])}`;
    if (key === syncedKey) return;
    syncedKey = key;
    form = {
      payout: current.redundancyPayout != null ? String(current.redundancyPayout) : '',
      threshold: current.redundancyTaxFreeThreshold != null ? String(current.redundancyTaxFreeThreshold) : '30000',
      taxRate: current.redundancyTaxRate != null ? String(num(current.redundancyTaxRate) * 100) : '40',
      spends: (current.redundancySpends || [5800, 5100, 3800]).map(String)
    };
  });

  const projection = $derived(redundancyProjection({
    payout: num(form.payout),
    taxFreeThreshold: num(form.threshold),
    taxRate: num(form.taxRate) / 100,
    monthlySpends: form.spends.map(num)
  }));
  const fmt = (value) => money(convertCurrency(value, $settings.balanceCurrency || 'USD', $displayCurrency), $displayCurrency);

  async function save(event) {
    event.preventDefault();
    const spends = form.spends.map((value) => Number(value));
    if (num(form.payout) < 0 || num(form.threshold) < 0 || num(form.taxRate) < 0 || num(form.taxRate) > 100 || spends.some((value) => value <= 0)) {
      errorToast('Enter a non-negative payout and valid tax/spending assumptions');
      return;
    }
    try {
      await saveSettings({
        redundancyPayout: num(form.payout),
        redundancyTaxFreeThreshold: num(form.threshold),
        redundancyTaxRate: num(form.taxRate) / 100,
        redundancySpends: spends
      });
      showToast('Redundancy scenario saved');
    } catch (error) {
      errorToast(error.message);
    }
  }
</script>

<section class="fh-grid">
  <div class="view-heading">
    <div><p class="eyebrow">REDUNDANCY</p><h2>Runway after redundancy</h2><p class="muted">Compare the same tax-adjusted payout against low, medium and high monthly spending.</p></div>
    <CurrencySelect compact />
  </div>

  <div class="fh-metrics">
    <article class="fh-metric"><p class="eyebrow">TAXABLE AMOUNT</p><strong>{fmt(projection.taxable)}</strong></article>
    <article class="fh-metric"><p class="eyebrow">NET TAKE-HOME</p><strong>{fmt(projection.netTakeHome)}</strong></article>
    <article class="fh-metric"><p class="eyebrow">MONTHLY SCENARIOS</p><strong>{projection.scenarios.filter((row) => row.months != null).length}</strong><p class="hint">Saved assumptions</p></article>
  </div>

  <section class="panel">
    <form class="fh-form" onsubmit={save}>
      <label>Gross payout<input type="number" min="0" step="0.01" bind:value={form.payout} required /></label>
      <label>Tax-free threshold<input type="number" min="0" step="0.01" bind:value={form.threshold} required /></label>
      <label>Tax rate %<input type="number" min="0" max="100" step="0.1" bind:value={form.taxRate} required /></label>
      {#each form.spends as spend, index}
        <label>Monthly spend {index + 1}<input type="number" min="0.01" step="0.01" bind:value={form.spends[index]} required /></label>
      {/each}
      <button class="primary-button" type="submit">Save scenario</button>
    </form>
    <p class="hint">Formula: taxable payout = max(0, payout − threshold); net take-home = tax-free portion + taxable portion × (1 − tax rate).</p>
  </section>

  <div class="fh-metrics">
    {#each projection.scenarios as scenario, index (index)}
      <article class="fh-metric">
        <p class="eyebrow">SCENARIO {index + 1}</p>
        <strong>{scenario.months == null ? '—' : `${scenario.months.toFixed(1)} months`}</strong>
        <p class="hint">At {fmt(scenario.spend)} per month</p>
        <div class="progress" role="progressbar" aria-label={`Scenario ${index + 1} runway`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.min(100, (scenario.months || 0) / 24 * 100)}><span style={`width: ${Math.min(100, (scenario.months || 0) / 24 * 100)}%`}></span></div>
      </article>
    {/each}
  </div>
</section>
