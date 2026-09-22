<script>
  import { createEventDispatcher } from 'svelte';
  import Modal from './Modal.svelte';
  import { CURRENCIES, money } from '../stores/finance.js';

  export let title = 'Update value';
  export let mode = 'snapshot'; // 'snapshot' = edit stored snapshot; 'entry' = replace current value
  export let subjectLabel = 'Series name';
  export let subject = '';
  export let seriesOptions = [];
  export let date = '';
  export let value = '';
  export let currency = 'USD';
  export let currencyEditable = true;
  export let detail = '';
  export let onSubmit = () => {};
  export let onDelete = null;

  const dispatch = createEventDispatcher();

  let localSubject = subject;
  let localDate = date || new Date().toISOString().slice(0, 10);
  let localValue = value;
  let localCurrency = currency;

  $: if (seriesOptions.length && !seriesOptions.includes(localSubject) && !localSubject) {
    localSubject = seriesOptions[0];
  }

  function cancel() {
    dispatch('close');
  }

  function remove() {
    if (onDelete) onDelete();
    dispatch('close');
  }

  function submit() {
    const parsed = Number(localValue);
    if (!localSubject.trim() || Number.isNaN(parsed)) return;
    onSubmit({
      series: localSubject.trim(),
      date: localDate,
      value: parsed,
      currency: localCurrency
    });
    dispatch('close');
  }
</script>

<Modal {title} on:close>
  <form
    on:submit|preventDefault={submit}
  >
    {#if mode === 'snapshot' && seriesOptions.length}
      <label>
        {subjectLabel}
        <input
          list="series-options"
          bind:value={localSubject}
          placeholder="Pick an existing name or type a new one"
          required
        />
        <datalist id="series-options">
          {#each seriesOptions as option}
            <option value={option}></option>
          {/each}
        </datalist>
      </label>
    {:else}
      <label>
        {subjectLabel}
        <input bind:value={localSubject} placeholder={subject || 'Series name'} required />
      </label>
    {/if}

    <label>
      Date
      <input type="date" bind:value={localDate} required />
    </label>

    <label>
      {mode === 'entry' ? 'New value (replaces current, records dated snapshot)' : 'Value'}
      <input type="number" step="0.01" bind:value={localValue} required />
    </label>

    <label>
      Currency
      <select bind:value={localCurrency} disabled={!currencyEditable}>
        {#each CURRENCIES as code}
          <option value={code}>{code}</option>
        {/each}
      </select>
    </label>

    {#if detail}
      <p class="hint">{detail}</p>
    {/if}
    {#if mode === 'snapshot'}
      <p class="hint">
        {money(localValue, localCurrency)} · picking an existing name keeps that series separate from
        others.
      </p>
    {/if}

    <div class="modal-actions">
      <button class="secondary-button" type="button" on:click={cancel}>Cancel</button>
      {#if onDelete}
        <button class="danger-button" type="button" on:click={remove}>Delete</button>
      {/if}
      <button class="primary-button" type="submit">Save</button>
    </div>
  </form>
</Modal>

<style>
  form {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  input,
  select {
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 9px 10px;
    font: inherit;
  }
  .hint {
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0;
  }
  .modal-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    margin-top: 4px;
  }
  .secondary-button,
  .primary-button,
  .danger-button {
    border-radius: 8px;
    padding: 9px 14px;
    font: inherit;
    cursor: pointer;
    border: 1px solid var(--line);
  }
  .secondary-button {
    background: transparent;
    color: var(--text);
  }
  .primary-button {
    background: var(--accent, #4ade80);
    border-color: transparent;
    color: #06210f;
    font-weight: 600;
  }
  .danger-button {
    background: transparent;
    color: #f87171;
    border-color: #f87171;
  }
</style>
