<script>
  /**
   * Shared screen for Accounts (`netWorth`), Investments (`holdings`) and
   * Pensions (`pensions`).
   *
   * Shows current records, open snapshots, and a monthly value comparison table.
   * The underlying SCD Type 2 version trail remains available for editing.
   */
  import { get } from 'svelte/store';
  import {
    settings,
    displayCurrency,
    money,
    convertCurrency,
    RATES,
    CURRENCY_NAMES,
    saveSetting,
    ENTITY_STORES,
    totalsByCurrency,
    holdingValue,
    signedValue
  } from '../stores/finance.js';
  import {
    entityConfig,
    addPosition,
    updatePosition,
    updateCurrentValue,
    recordSnapshot,
    saveVersion,
    removePosition,
    removeVersion
  } from '../services/positions.js';
  import { isCurrentVersion } from '../services/scd2.js';
  import { num, currencyOf, seriesNameOf } from '../services/runway.js';
  import { saveSettings } from '../stores/finance.js';
  import { projectPensionSeries, MAX_PENSION_PROJECTION_YEARS } from '../services/financeCalculations.js';
  import { buildMonthlyHistoryTable } from '../services/monthlyHistory.js';
  import { todayISO } from '../services/recordHelpers.js';
  import { longLabel } from '../services/dates.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import RecordList from './RecordList.svelte';
  import PositionUpdateModal from './PositionUpdateModal.svelte';
  import MonthlyHistoryTable from './MonthlyHistoryTable.svelte';
  import HistoryTrend from './HistoryTrend.svelte';
  import PensionGrowthEditor from './PensionGrowthEditor.svelte';
  import PensionProjection from './PensionProjection.svelte';

  // `entityKey` is fixed per instance (App renders one screen per view).
  let { entityKey = 'netWorth' } = $props();

  // svelte-ignore state_referenced_locally: entityKey never changes for a mounted screen
  const config = entityConfig(entityKey);
  // svelte-ignore state_referenced_locally: store handles are stable per entityKey
  const store = ENTITY_STORES[config.store];
  // svelte-ignore state_referenced_locally: store handles are stable per entityKey
  const historyStore = ENTITY_STORES[config.history];

  let form = $state({
    series: '',
    date: todayISO(),
    value: '',
    currency: get(settings).balanceCurrency || 'USD',
    growth: '5'
  });
  let modal = $state(null);

  const codes = Object.keys(RATES);

  const entryRows = $derived(
    ($store || []).map((row) => ({
      id: row.id,
      title: seriesNameOf(row),
      subtitle: subtitleFor(row),
      amount: money(entryValue(row), currencyOf(row)),
      badges: [{ label: 'Current record', tone: 'current' }],
      raw: row
    }))
  );

  const seriesNames = $derived(
    Array.from(
      new Set([
        ...($historyStore || []).map((row) => seriesNameOf(row)),
        ...($store || []).map((row) => seriesNameOf(row))
      ])
    ).sort((a, b) => a.localeCompare(b))
  );

  const openRows = $derived(
    ($historyStore || [])
      .filter((row) => isCurrentVersion(row))
      .sort((a, b) => seriesNameOf(a).localeCompare(seriesNameOf(b)))
      .map((row) => ({
        id: row.id,
        title: seriesNameOf(row),
        subtitle: `Since ${longLabel(row.validFrom || row.date)} · ${currencyOf(row)}`,
        amount: money(num(row.value), currencyOf(row)),
        badges: [{ label: 'Open version', tone: 'current' }],
        raw: row
      }))
  );

  const totals = $derived(totalsByCurrency($store || [], entityValue));
  const totalInDisplay = $derived(
    Object.entries(totals).reduce((sum, [code, value]) => sum + convertCurrency(value, code, $displayCurrency), 0)
  );
  const monthlyHistory = $derived.by(() =>
    buildMonthlyHistoryTable({
      rows: $historyStore || [],
      readValue: entityKey === 'netWorth' ? signedValue : (row) => num(row.value),
      convert: (value, currency) => convertCurrency(value, currency, $displayCurrency)
    })
  );
  /**
   * Points for the chart, one per series, mirroring the table's columns.
   * Values are already converted to the display currency by
   * `buildMonthlyHistoryTable`, so nothing is converted twice.
   */
  const trendSeries = $derived(
    monthlyHistory.columns.map((column) => ({
      key: column.key,
      name: column.name,
      points: monthlyHistory.rows.map((row) => ({
        date: `${row.month}-01`,
        value: row.cells[column.key]?.value ?? null
      }))
    }))
  );

  /* --- chart view options: which series are shown, and at what granularity --- */

  const CHART_OPTIONS_KEY = 'chartViewOptions';
  const chartOptions = $derived(
    $settings[CHART_OPTIONS_KEY] && typeof $settings[CHART_OPTIONS_KEY] === 'object'
      ? $settings[CHART_OPTIONS_KEY]
      : {}
  );
  // Per entityKey, so hiding a holding does not hide a pension.
  const savedForScreen = $derived(chartOptions[entityKey] || {});
  const granularity = $derived(savedForScreen.granularity === 'month' ? 'month' : 'year');

  /**
   * Hidden series keys, intersected with the series that actually exist.
   *
   * Series get renamed, and a saved key for a series that no longer exists must
   * not hide a different one that took its place. If nothing matches, nothing is
   * hidden - a chart with every series struck out is worse than a stale preference.
   */
  const hiddenSeries = $derived.by(() => {
    const known = new Set(trendSeries.map((item) => item.key));
    const saved = Array.isArray(savedForScreen.hidden) ? savedForScreen.hidden : [];
    return saved.filter((key) => known.has(key));
  });

  function saveChartOptions(patch) {
    const next = { ...chartOptions, [entityKey]: { ...savedForScreen, ...patch } };
    return saveSettings({ [CHART_OPTIONS_KEY]: next });
  }

  async function toggleSeries(key) {
    const hidden = new Set(hiddenSeries);
    if (hidden.has(key)) hidden.delete(key);
    else hidden.add(key);
    await saveChartOptions({ hidden: [...hidden] });
  }

  async function setGranularity(value) {
    await saveChartOptions({ granularity: value === 'month' ? 'month' : 'year' });
  }
  const pensionPotGrowth = $derived.by(() =>
    $settings.pensionPotGrowth && typeof $settings.pensionPotGrowth === 'object'
      ? $settings.pensionPotGrowth
      : {}
  );
  let pensionProjectionYears = $state(10);
  $effect(() => {
    const saved = Number($settings.pensionProjectionYears);
    pensionProjectionYears = Number.isFinite(saved)
      ? Math.min(MAX_PENSION_PROJECTION_YEARS, Math.max(1, Math.trunc(saved)))
      : 10;
  });
  const pensionProjection = $derived(
    projectPensionSeries({
      history: $historyStore || [],
      pots: $store || [],
      growthByPot: pensionPotGrowth,
      annualRate: num($settings.pensionGrowth),
      years: pensionProjectionYears
    })
  );

  function entityValue(row) {
    return config.kind === 'holding' ? holdingValue(row) : signedValue(row);
  }

  function entryValue(row) {
    return config.kind === 'holding' ? holdingValue(row) : num(row.value);
  }

  function subtitleFor(row) {
    const currency = currencyOf(row);
    if (entityKey === 'netWorth') return [row.institution, row.kind, currency].filter(Boolean).join(' • ');
    if (entityKey === 'holdings') {
      return [row.symbol, row.type, `${num(row.quantity)} units`, currency].filter(Boolean).join(' • ');
    }
    return [row.provider, currency].filter(Boolean).join(' • ');
  }

  function openModal(mode, record = null) {
    modal = { mode, record };
  }

  async function savePensionGrowth(rates) {
    await saveSetting('pensionPotGrowth', rates);
    showToast('Pension growth rates saved');
  }

  async function saveProjectionYears(event) {
    const value = Number(event.currentTarget.value);
    if (!Number.isFinite(value)) return;
    pensionProjectionYears = Math.min(MAX_PENSION_PROJECTION_YEARS, Math.max(1, Math.trunc(value)));
    try {
      await saveSetting('pensionProjectionYears', pensionProjectionYears);
      showToast(`Pension forecast set to ${pensionProjectionYears} years`);
    } catch (error) {
      errorToast(error.message);
    }
  }

  async function submitSnapshot(event) {
    event.preventDefault();
    try {
      const { plan } = await recordSnapshot(entityKey, {
        series: form.series,
        date: form.date,
        value: form.value,
        currency: form.currency
      });
      if (entityKey === 'holdings') await saveSetting('portfolioGrowth', num(form.growth) / 100);
      form = { ...form, value: '' };
      showToast(`Snapshot saved under series “${plan.insert.series}”`);
    } catch (error) {
      errorToast(error.message);
    }
  }

  async function submitModal(payload) {
    if (!modal) return;
    try {
      if (modal.mode === 'create') {
        await addPosition(entityKey, payload);
        showToast(`${config.label} added with its first snapshot`);
      } else if (modal.mode === 'edit') {
        await updatePosition(entityKey, modal.record, payload);
        showToast(`${config.label} updated`);
      } else if (modal.mode === 'value') {
        const result = await updateCurrentValue(entityKey, modal.record, {
          date: payload.date,
          value: payload.value,
          currency: payload.currency
        });
        showToast(`Value updated · snapshot ${money(result.snapshotValue, payload.currency)}`);
      } else {
        await saveVersion(entityKey, modal.record, {
          series: payload.name,
          date: payload.date,
          value: payload.value,
          currency: payload.currency
        });
        showToast('Snapshot updated');
      }
    } catch (error) {
      errorToast(error.message);
    }
  }

  async function deleteEntry(row) {
    if (!window.confirm(`Remove “${seriesNameOf(row)}”? Its dated snapshots stay as history.`)) return;
    await removePosition(entityKey, row);
    showToast('Record removed locally');
  }

  async function deleteVersion(row) {
    if (!window.confirm(`Delete the ${longLabel(row.date)} snapshot for “${seriesNameOf(row)}”?`)) return;
    await removeVersion(entityKey, row);
    showToast('Snapshot deleted');
  }
</script>

<section class="fh-grid">
  <div class="view-heading">
    <div>
      <p class="eyebrow">
        {entityKey === 'netWorth' ? 'FINANCIAL POSITION' : entityKey === 'holdings' ? 'PORTFOLIO' : 'RETIREMENT'}
      </p>
      <h2>
        {entityKey === 'netWorth'
          ? 'Accounts and net worth'
          : entityKey === 'holdings'
            ? 'Investments and growth'
            : 'Pension outlook'}
      </h2>
      <p class="muted">
        Add dated snapshots across any currency, give each series its own name, and read everything in
        {$displayCurrency}.
      </p>
    </div>
    <div class="button-row">
      <CurrencySelect compact />
      <button class="primary-button" type="button" onclick={() => openModal('create')}>
        Add {config.label.toLowerCase()}
      </button>
    </div>
  </div>

  <div class="fh-metrics">
    <article class="fh-metric">
      <p class="eyebrow">TOTAL ({$displayCurrency})</p>
      <strong>{money(totalInDisplay, $displayCurrency)}</strong>
      <p class="hint">{entryRows.length} current record(s)</p>
    </article>
    {#each Object.entries(totals) as [code, value] (code)}
      <article class="fh-metric">
        <p class="eyebrow">{code}</p>
        <strong>{money(value, code)}</strong>
        <p class="hint">Converted: {money(convertCurrency(value, code, $displayCurrency), $displayCurrency)}</p>
      </article>
    {/each}
  </div>

  <section class="panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">SNAPSHOT</p>
        <h3>Record a dated value</h3>
        <p class="hint">Picking an existing name keeps that series separate from the others.</p>
      </div>
    </div>
    <form class="fh-form" onsubmit={submitSnapshot}>
      <label>{config.seriesLabel}
        <input
          list="series-options"
          bind:value={form.series}
          placeholder="Pick an existing name or type a new one"
          required
        />
        <datalist id="series-options">
          {#each seriesNames as option}<option value={option}></option>{/each}
        </datalist>
      </label>
      <label>Snapshot date<input type="date" bind:value={form.date} required /></label>
      <label>{config.kind === 'holding' ? 'Market value' : 'Value'}
        <input type="number" step="0.01" bind:value={form.value} required />
      </label>
      <label>Currency
        <select bind:value={form.currency}>
          {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
        </select>
      </label>
      {#if entityKey === 'holdings'}
        <label>Annual growth %<input type="number" step="0.1" min="-100" bind:value={form.growth} /></label>
      {/if}
      <button class="primary-button" type="submit">Save snapshot</button>
    </form>
  </section>

  <section class="panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">MONTHLY COMPARISON</p>
        <h3>{entityKey === 'holdings' ? 'Portfolio value by month' : entityKey === 'pensions' ? 'Pension value by month' : 'Net worth by month'}</h3>
        <p class="hint">Each item shows its last recorded value in the month. Percent change compares with the immediately preceding month.</p>
      </div>
    </div>
    <MonthlyHistoryTable
      table={monthlyHistory}
      emptyMessage="Record dated snapshots to see the monthly comparison."
    />
    <!-- One insertion covers Position, Investments and Pensions: all three render
         this same component, parameterised by entityKey. -->
    {#if trendSeries.length}
      <div class="chart-controls">
        <div class="chart-granularity" role="group" aria-label="Chart granularity">
          <button
            type="button"
            class="chip"
            class:active={granularity === 'year'}
            aria-pressed={granularity === 'year'}
            onclick={() => setGranularity('year')}
          >By year</button>
          <button
            type="button"
            class="chip"
            class:active={granularity === 'month'}
            aria-pressed={granularity === 'month'}
            onclick={() => setGranularity('month')}
          >By month</button>
        </div>
        <!-- Real checkboxes rather than clickable divs, so this is keyboard and
             screen-reader operable. Each one hides or shows a series. -->
        <fieldset class="chart-series">
          <legend class="visually-hidden">Series shown in the chart</legend>
          {#each trendSeries as item (item.key)}
            <label class="series-toggle">
              <input
                type="checkbox"
                checked={!hiddenSeries.includes(item.key)}
                onchange={() => toggleSeries(item.key)}
              />
              <span>{item.name}</span>
            </label>
          {/each}
        </fieldset>
      </div>
    {/if}

    <HistoryTrend
      series={trendSeries}
      hidden={hiddenSeries}
      granularity={granularity}
      title={entityKey === 'holdings' ? 'Portfolio value' : entityKey === 'pensions' ? 'Pension value' : 'Net worth'}
      emptyMessage="Record dated snapshots to see growth over time."
    />
  </section>

  {#if entityKey === 'pensions'}
    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">POT ASSUMPTIONS</p>
          <h3>Annual growth per pension pot</h3>
          <p class="hint">Each pot uses its own rate. The monthly rate is compounded from the annual rate.</p>
        </div>
      </div>
      <PensionGrowthEditor
        pots={$store || []}
        rates={pensionPotGrowth}
        fallbackRate={num($settings.pensionGrowth)}
        onSave={savePensionGrowth}
      />
    </section>
  {/if}

  {#if entityKey === 'pensions'}
    <section class="panel">
      <div class="section-heading">
        <div>
          <p class="eyebrow">FORECAST</p>
          <h3>Stacked pension projection</h3>
          <p class="hint">Each pot uses its own annual rate; the monthly equivalent is compounded, not annual growth divided by 12.</p>
          <label class="projection-horizon">Forecast horizon
            <select value={pensionProjectionYears} onchange={saveProjectionYears}>
              {#each Array.from({ length: MAX_PENSION_PROJECTION_YEARS }, (_, index) => index + 1) as years}
                <option value={years}>{years} {years === 1 ? 'year' : 'years'}</option>
              {/each}
            </select>
          </label>
        </div>
      </div>
      <PensionProjection projection={pensionProjection} />
    </section>
  {/if}

  <section class="panel">
    <div class="section-heading">
      <div><p class="eyebrow">CURRENT</p><h3>{config.plural}</h3></div>
    </div>
    <RecordList
      rows={entryRows}
      emptyMessage={`No ${config.plural.toLowerCase()} recorded yet.`}
      onUpdate={(row) => openModal('value', row)}
      onEdit={(row) => openModal('edit', row)}
      onDelete={deleteEntry}
    />
  </section>

  <section class="panel">
    <div class="section-heading">
      <div><p class="eyebrow">OPEN VERSIONS</p><h3>Latest snapshot per series</h3></div>
    </div>
    <RecordList
      rows={openRows}
      emptyMessage="No open snapshots yet."
      onEdit={(row) => openModal('version', row)}
      onDelete={deleteVersion}
    />
  </section>

</section>

{#if modal}
  <PositionUpdateModal
    {entityKey}
    mode={modal.mode}
    record={modal.record}
    seriesOptions={seriesNames}
    defaultCurrency={form.currency}
    onSubmit={submitModal}
    onClose={() => (modal = null)}
  />
{/if}

