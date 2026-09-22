<script>
  import { displayCurrency, CURRENCIES, setDisplayCurrency } from '../stores/finance.js';
  export let id = '';
  export let label = 'Currency';
  export let compact = false;

  function onChange(e) {
    setDisplayCurrency(e.target.value);
  }
</script>

<label class:compact for={id || undefined}>
  {#if !compact}{label}{/if}
  <select {id} value={$displayCurrency} on:change={onChange}>
    {#each CURRENCIES as code}
      <option value={code}>{code}</option>
    {/each}
  </select>
</label>

<style>
  label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85rem;
    color: var(--muted);
  }
  label.compact {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  select {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 8px 10px;
    font: inherit;
  }
</style>
