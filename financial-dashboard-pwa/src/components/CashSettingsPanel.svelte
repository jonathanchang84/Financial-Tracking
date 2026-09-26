<script>
  /**
   * Available balance and balance currency. Presentational: it owns the draft
   * values and reports them, while the parent decides how to persist them.
   */
  import { RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { parseNonNegativeNumber } from '../services/runway.js';
  import { showToast, errorToast } from '../stores/ui.js';

  let {
    balance = '0',
    currency = 'USD',
    onSave = async () => {},
    onInvalid = () => {}
  } = $props();

  const codes = Object.keys(RATES);
  let form = $state({ balance, currency });
  let saving = $state(false);

  // Re-fill when the stored values change underneath us (boot, pull, another tab).
  let syncedKey = '';
  $effect(() => {
    const key = `${balance}|${currency}`;
    if (key === syncedKey) return;
    syncedKey = key;
    form = { balance, currency };
  });

  function parsed() {
    const value = parseNonNegativeNumber(form.balance);
    if (value === null) {
      errorToast('Enter a valid available balance');
      onInvalid();
    }
    return value;
  }

  /** Saves as soon as the field is committed, so the balance is never stale. */
  async function saveNow() {
    const value = parsed();
    if (value === null) return;
    try {
      await onSave({ balance: value, balanceCurrency: form.currency });
    } catch (error) {
      errorToast('Could not save balance: ' + error.message);
    }
  }

  async function saveOnSubmit(event) {
    event.preventDefault();
    const value = parsed();
    if (value === null) return;
    saving = true;
    try {
      await onSave({ balance: value, balanceCurrency: form.currency });
      showToast('Balance saved');
    } catch (error) {
      errorToast(`Could not save balance: ${error.message}`);
    } finally {
      saving = false;
    }
  }
</script>

<form class="fh-form" onsubmit={saveOnSubmit}>
  <label>Available balance
    <input type="number" min="0" step="0.01" bind:value={form.balance} required onchange={saveNow} />
  </label>
  <label>Balance currency
    <select bind:value={form.currency} onchange={saveNow}>
      {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
    </select>
  </label>
  <button class="primary-button" type="submit" disabled={saving}>Save balance</button>
</form>
