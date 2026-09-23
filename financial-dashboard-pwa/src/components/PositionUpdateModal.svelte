<script>
  /**
   * Add / edit / update records for Accounts, Investments and Pensions.
   *
   * `mode: 'version'` renders the historic series-name picker: choosing an
   * existing name attaches the snapshot to that series' chain, so two series
   * never blur together (a series is a name + currency pair).
   */
  import Modal from './Modal.svelte';
  import { RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { todayISO } from '../services/recordHelpers.js';
  import { errorToast } from '../stores/ui.js';

  let {
    entityKey = 'netWorth',
    mode = 'create',
    record = null,
    seriesOptions = [],
    defaultCurrency = 'USD',
    onSubmit = null,
    onClose = () => {}
  } = $props();

  const LABELS = {
    netWorth: { noun: 'account', name: 'Account name', value: 'Current value', create: 'Add account' },
    holdings: { noun: 'holding', name: 'Holding name', value: 'Unit price', create: 'Add holding' },
    pensions: { noun: 'pension pot', name: 'Pot name', value: 'Current value', create: 'Add pension pot' }
  };

  const labels = $derived(LABELS[entityKey] ?? LABELS.netWorth);
  const codes = Object.keys(RATES);
  const isHolding = $derived(entityKey === 'holdings');
  const isFormMode = $derived(mode === 'create' || mode === 'edit');

  function initialForm() {
    // svelte-ignore state_referenced_locally
    const source = record;
    // svelte-ignore state_referenced_locally
    const currencyFallback = defaultCurrency;
    // svelte-ignore state_referenced_locally
    const holding = entityKey === 'holdings';
    const sourceValue = holding ? source?.price : source?.value;
    return {
      name: source?.name || source?.series || '',
      institution: source?.institution || '',
      provider: source?.provider || '',
      symbol: source?.symbol || '',
      type: source?.type || '',
      kind: source?.kind || 'Asset',
      quantity: source?.quantity != null ? String(source.quantity) : '',
      price: source?.price != null ? String(source.price) : '',
      value: sourceValue != null ? String(sourceValue) : '',
      date: source?.date || source?.validFrom || todayISO(),
      currency: source?.currencyCode || source?.currency || currencyFallback
    };
  }

  let form = $state(initialForm());
  let busy = $state(false);

    const title = $derived(
    mode === 'create'
      ? labels.create
      : mode === 'edit'
        ? `Edit ${labels.noun}`
        : mode === 'version'
          ? 'Update snapshot'
          : `Update ${isHolding ? 'unit price' : 'value'}`
  );

  const subtitle = $derived(
    isFormMode
      ? mode === 'create'
        ? 'Adding a record also opens its first dated snapshot.'
        : 'Descriptive fields only — dated snapshots stay untouched.'
      : mode === 'version'
        ? 'Pick an existing series name to keep its history separate.'
        : 'A dated snapshot is recorded under this series.'
  );

  const submitLabel = $derived(
    mode === 'create'
      ? labels.create
      : mode === 'edit'
        ? `Save ${labels.noun}`
        : mode === 'version'
          ? 'Update snapshot'
          : 'Update'
  );

  function submit(event) {
    event.preventDefault();
    const payload = { ...form };
    if (!String(payload.name || '').trim()) {
      errorToast(`Give the ${labels.noun} a name`);
      return;
    }
    if (!isFormMode && String(payload.value ?? '').trim() === '') {
      errorToast('Enter a valid value');
      return;
    }
    busy = true;
    try {
      onSubmit?.(payload);
      onClose();
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = false;
    }
  }
</script>

<Modal {title} eyebrow="POSITION UPDATE" {subtitle} {onClose}>
  <form onsubmit={submit}>
    {#if isFormMode}
      <label>{labels.name}
        <input bind:value={form.name} placeholder="Barclays savings" required />
      </label>
      {#if entityKey === 'netWorth'}
        <label>Institution<input bind:value={form.institution} placeholder="Barclays" /></label>
        <label>Kind
          <select bind:value={form.kind}>
            <option value="Asset">Asset</option>
            <option value="Liability">Liability</option>
          </select>
        </label>
        <label>{labels.value}<input type="number" step="0.01" bind:value={form.value} required /></label>
      {:else if isHolding}
        <label>Symbol<input bind:value={form.symbol} placeholder="VUSA" /></label>
        <label>Asset type<input bind:value={form.type} placeholder="ETF" /></label>
        <label>Quantity<input type="number" step="0.0001" bind:value={form.quantity} required /></label>
        <label>Unit price<input type="number" step="0.01" bind:value={form.price} required /></label>
      {:else}
        <label>Provider<input bind:value={form.provider} placeholder="Provider" /></label>
        <label>{labels.value}<input type="number" step="0.01" bind:value={form.value} required /></label>
      {/if}
      <label>Snapshot date<input type="date" bind:value={form.date} required /></label>
    {:else if mode === 'version'}
      <label>Series name
        {#if seriesOptions.length}
          <input
            list="position-series"
            bind:value={form.name}
            placeholder="Pick an existing name or type a new one"
            required
          />
          <datalist id="position-series">
            {#each seriesOptions as option}<option value={option}></option>{/each}
          </datalist>
        {:else}
          <input bind:value={form.name} placeholder="Series name" required />
        {/if}
      </label>
      <label>Snapshot date<input type="date" bind:value={form.date} required /></label>
      <label>Value<input type="number" step="0.01" bind:value={form.value} required /></label>
    {:else}
      <label>Name<input value={record?.name || record?.series || ''} disabled /></label>
      <label>Date<input type="date" bind:value={form.date} required /></label>
      <label>{isHolding ? 'Unit price on this date' : 'Value on this date'}
        <input type="number" step="0.01" bind:value={form.value} required />
      </label>
    {/if}

    <label>Currency
      <select bind:value={form.currency}>
        {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
      </select>
    </label>

    {#if !isFormMode}
      <p class="hint">
        Saving closes the open version with a validTo date and makes this the current version.
      </p>
    {/if}

    <div class="modal-actions">
      <button class="secondary-button" type="button" onclick={onClose}>Cancel</button>
      <button class="primary-button" type="submit" disabled={busy}>{submitLabel}</button>
    </div>
  </form>
</Modal>


