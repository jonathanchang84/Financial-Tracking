<script>
  /** Global display-currency selector: drives every dashboard's formatting. */
  import { displayCurrency, setDisplayCurrency, RATES, CURRENCY_NAMES } from '../stores/finance.js';

  let { label = 'View currency', compact = false, id = '' } = $props();

  const codes = Object.keys(RATES);
</script>

<label class:compact for={id || undefined}>
  {#if !compact}{label}{/if}
  <select {id} value={$displayCurrency} onchange={(event) => setDisplayCurrency(event.currentTarget.value)}>
    {#each codes as code}
      <option value={code}>{compact ? code : `${code} · ${CURRENCY_NAMES[code] ?? code}`}</option>
    {/each}
  </select>
</label>
