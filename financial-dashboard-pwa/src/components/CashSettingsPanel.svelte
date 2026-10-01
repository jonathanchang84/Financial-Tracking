<script>
  /**
   * Available balance and balance currency. Presentational: it owns the draft
   * values and reports them, while the parent decides how to persist them.
   */
  import { RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { parseNonNegativeNumber } from '../services/runway.js';
  import { dayKey } from '../services/dates.js';
  import { showToast, errorToast } from '../stores/ui.js';

  let {
    balance = '0',
    currency = 'USD',
    date = '',
    onSave = async () => {},
    onInvalid = () => {}
  } = $props();

  const codes = Object.keys(RATES);
  // Defaults to today so the common case is "record today's balance", while
  // still allowing a past date so a user can backfill history for a day the
  // cycle view cannot otherwise fill in.
  let form = $state({ balance, currency, date: date || dayKey(new Date()) });
  let saving = $state(false);

  // Re-fill when the stored values change underneath us (boot, pull, another tab).
  let syncedKey = '';
  $effect(() => {
    const key = `${balance}|${currency}`;
    if (key === syncedKey) return;
    syncedKey = key;
    form = { balance, currency, date: form.date || dayKey(new Date()) };
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
      await onSave({ balance: value, balanceCurrency: form.currency, balanceDate: form.date });
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
      await onSave({ balance: value, balanceCurrency: form.currency, balanceDate: form.date });
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
  <label>Balance on
    <input type="date" bind:value={form.date} required onchange={saveNow} />
  </label>
  <label>Balance currency
    <select bind:value={form.currency} onchange={saveNow}>
      {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
    </select>
  </label>
  <button class="primary-button" type="submit" disabled={saving}>Save balance</button>
</form>
