<script>
  /**
   * Available balance and balance currency. Presentational: it owns the draft
   * values and reports them, while the parent decides how to persist them.
   */
  import { RATES, CURRENCY_NAMES, money } from '../stores/finance.js';
  import { parseNonNegativeNumber, num } from '../services/runway.js';
  import { dayKey, longLabel } from '../services/dates.js';
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

  /**
   * What pressing Save will write, phrased for the day actually chosen.
   *
   * The amount and the date decide *which day* a figure lands on, so they only mean
   * anything together. A backfill and a change to what you have available today are
   * different operations with very different consequences, and stating the
   * difference before the write is what stops one being mistaken for the other.
   */
  const target = $derived.by(() => {
    const key = dayKey(form.date);
    if (!key) return { key: '', isPast: false, isToday: false, label: 'no date chosen' };
    return {
      key,
      isPast: key < today,
      isToday: key === today,
      label: key === today ? 'today' : longLabel(key)
    };
  });
  const draft = $derived.by(() => {
    const value = parseNonNegativeNumber(form.balance);
    return value === null ? null : value;
  });
  // Only the amount and the date are the draft's concern. Currency is a property of
  // the account, and the stored balance is what makes the draft "unsaved"; comparing
  // strings would report a dirty form for a re-typed but identical amount.
  const unsaved = $derived(
    draft !== null && (draft !== num(balance) || (form.date || today) !== today)
  );

  function parsed() {
    const value = draft;
    if (value === null) {
      errorToast('Enter a valid available balance');
      onInvalid();
    }
    return value;
  }

  /**
   * The single place a balance is written.
   *
   * Amount and date are read together here, at one instant, so the figure can only
   * ever land on the day the form is showing. Committing either field on its own
   * was the defect: typing an amount saved it against whatever date happened to be
   * in the box, so picking the payday *after* typing left the value sitting on today
   * and silently overwrote today's real balance. Nothing writes until here.
   */
  async function commit() {
    const value = parsed();
    if (value === null) return;
    const date = dayKey(form.date);
    if (!date) {
      errorToast('Choose the date this balance was true');
      return;
    }
    saving = true;
    try {
      await onSave({ balance: value, balanceCurrency: form.currency, balanceDate: date });
      showToast('Balance saved');
    } catch (error) {
      // A rejected date is explained by the parent, which knows why; anything else
      // is a storage failure this form is the only place that can report. Exactly one
      // path toasts, so a failure never appears twice.
      if (!PARENT_EXPLAINED.has(error?.message)) {
        errorToast(`Could not save balance: ${error.message}`);
      }
    } finally {
      saving = false;
    }
  }

  // Rejections the parent has already put on screen, so they are not echoed here.
  const PARENT_EXPLAINED = new Set(['future balance date', 'missing balance date']);
</script>

<form class="fh-form" onsubmit={(event) => { event.preventDefault(); commit(); }}>
  <label>Available balance
    <!-- No save handlers anywhere in this form. The date decides which day a figure
         belongs to, so committing the amount alone would target whatever date the
         box happens to be showing. -->
    <input type="number" min="0" step="0.01" bind:value={form.balance} required />
  </label>
  <label>Balance on
    <input type="date" bind:value={form.date} required max={today} />
  </label>
  <label>Balance currency
    <select bind:value={form.currency}>
      {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
    </select>
  </label>
  <div class="fh-form-save">
    <button class="primary-button" type="submit" disabled={saving || !unsaved}>
      {target.isPast ? `Save balance for ${target.label}` : 'Save balance'}
    </button>
    {#if unsaved}
      <span class="unsaved-marker">Unsaved changes</span>
    {/if}
  </div>
  <p class="hint">
    {#if target.isPast}
      Records history for {target.label} only — your current balance of
      {money(num(balance), currency)} stays as it is.
    {:else if target.isToday}
      Sets your available balance for today, and records it as today's figure.
    {:else}
      Choose a date to record this balance against.
    {/if}
  </p>
</form>
