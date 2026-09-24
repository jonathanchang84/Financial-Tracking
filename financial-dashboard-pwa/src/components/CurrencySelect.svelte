<script>
  /** Global display-currency selector: drives every dashboard's formatting. */
  import { displayCurrency, setDisplayCurrency, RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { errorToast } from '../stores/ui.js';

  let { label = 'Default currency', compact = false, id = '' } = $props();

  const codes = Object.keys(RATES);

  async function chooseCurrency(event) {
    const code = event.currentTarget.value;
    try {
      await setDisplayCurrency(code);
    } catch (error) {
      errorToast(`Could not save default currency: ${error.message}`);
    }
  }
</script>

<label class:compact for={id || undefined}>
  {#if !compact}{label}{/if}
  <select {id} value={$displayCurrency} onchange={chooseCurrency}>
    {#each codes as code}
      <option value={code}>{compact ? code : `${code} · ${CURRENCY_NAMES[code] ?? code}`}</option>
    {/each}
  </select>
</label>
