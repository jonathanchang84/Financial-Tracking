<script>
  /**
   * Shared screen for Accounts (`netWorth`), Investments (`holdings`) and
   * Pensions (`pensions`).
   *
   * Shows the current records, the open snapshot per series and the full SCD
   * Type 2 version trail (validFrom / validTo / currentFlag).
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
  import { todayISO } from '../services/recordHelpers.js';
  import { longLabel } from '../services/dates.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import RecordList from './RecordList.svelte';
  import PositionUpdateModal from './PositionUpdateModal.svelte';

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
  let showAllHistory = $state(false);

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

  const versionRows = $derived(
    ($historyStore || [])
      .slice()
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((row) => ({
        id: row.id,
        title: `${seriesNameOf(row)} · ${money(num(row.value), currencyOf(row))}`,
        subtitle: `${longLabel(row.date)} · ${currencyOf(row)} · valid from ${row.validFrom || row.date}${
          row.validTo ? ` to ${row.validTo}` : ' (open)'
        }`,
        badges: [isCurrentVersion(row) ? { label: 'Current', tone: 'current' } : { label: 'Closed', tone: 'closed' }],
        raw: row
      }))
  );

  const visibleVersions = $derived(showAllHistory ? versionRows : versionRows.slice(0, 25));

  const totals = $derived(totalsByCurrency($store || [], entityValue));
  const totalInDisplay = $derived(
    Object.entries(totals).reduce((sum, [code, value]) => sum + convertCurrency(value, code, $displayCurrency), 0)
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
      if (entityKey === 'pensions') await saveSetting('pensionGrowth', num(form.growth) / 100);
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
      {#if entityKey !== 'netWorth'}
        <label>Annual growth %<input type="number" step="0.1" min="-100" bind:value={form.growth} /></label>
      {/if}
      <button class="primary-button" type="submit">Save snapshot</button>
    </form>
  </section>

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

  <section class="panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">HISTORY</p>
        <h3>SCD Type 2 version trail</h3>
        <p class="hint">Every valuation keeps its validFrom / validTo window instead of being overwritten.</p>
      </div>
      {#if versionRows.length > 25}
        <button class="text-button" type="button" onclick={() => (showAllHistory = !showAllHistory)}>
          {showAllHistory ? 'Show fewer' : `Show all ${versionRows.length}`}
        </button>
      {/if}
    </div>
    <RecordList
      rows={visibleVersions}
      emptyMessage="No snapshot history yet."
      onEdit={(row) => openModal('version', row)}
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

