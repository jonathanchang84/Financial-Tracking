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
  const today = $derived(dayKey(new Date()));

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

  /** Saves as soon as the amount is committed, so the balance is never stale. */
  async function saveNow() {
    const value = parsed();
    if (value === null) return;
    try {
      await commit(value);
    } catch (error) {
      reportFailure(error);
    }
  }

  /**
   * Write the amount, then return the date field to today.
   *
   * Leaving a past date in the box is how a backfill gets destroyed: the next
   * balance edit would be recorded against that old date instead of today, quietly
   * overwriting the very figure the user had just corrected. Resetting makes the
   * form's common case — record what I have now — the default for the next entry,
   * and a deliberate backfill is one extra edit rather than a trap.
   *
   * The date is only reset on success, so a rejected entry keeps its draft and the
   * user can fix the date rather than retype the amount.
   */
  async function commit(value) {
    await onSave({ balance: value, balanceCurrency: form.currency, balanceDate: form.date });
    form.date = today;
  }

  // A rejected date is explained by the parent, which knows why; anything else is a
  // storage failure this form is the only place that can report. Exactly one of the
  // two paths toasts, so a failure never shows the same error twice.
  function reportFailure(error) {
    if (error?.message !== 'future balance date') {
      errorToast(`Could not save balance: ${error.message}`);
    }
  }

  async function saveOnSubmit(event) {
    event.preventDefault();
    const value = parsed();
    if (value === null) return;
    saving = true;
    try {
      await commit(value);
      showToast('Balance saved');
    } catch (error) {
      reportFailure(error);
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
    <!-- No save handler here on purpose. Changing the date chooses which day the
         amount applies to; it must never write a balance of its own, or retargeting
         a backfill would stamp whatever is in the box onto the newly chosen day. -->
    <input type="date" bind:value={form.date} required max={today} />
  </label>
  <label>Balance currency
    <select bind:value={form.currency} onchange={saveNow}>
      {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
    </select>
  </label>
  <button class="primary-button" type="submit" disabled={saving}>Save balance</button>
</form>
