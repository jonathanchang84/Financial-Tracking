<script>
  /** Add / edit a named, dated spend item (one-off spend planned for a day). */
  import Modal from './Modal.svelte';
  import { RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { saveCommitment } from '../services/commands.js';
  import { errorToast } from '../stores/ui.js';
  import { todayISO } from '../services/recordHelpers.js';

  let { record = null, defaultCurrency = 'USD', onClose = () => {} } = $props();

  function initialForm() {
    // svelte-ignore state_referenced_locally
    const source = record;
    // svelte-ignore state_referenced_locally
    const currencyFallback = defaultCurrency;
    return {
      name: source?.name ?? '',
      date: source?.date ?? todayISO(),
      amount: source?.amount != null ? String(source.amount) : '',
      currency: source?.currencyCode || currencyFallback
    };
  }

  let form = $state(initialForm());
  let busy = $state(false);

  const codes = Object.keys(RATES);

  async function submit(event) {
    event.preventDefault();
    busy = true;
    try {
      await saveCommitment({
        id: record?.id,
        name: form.name,
        date: form.date,
        amount: Number(form.amount),
        currency: form.currency
      });
      onClose();
    } catch (error) {
      errorToast(error.message);
    } finally {
      busy = false;
    }
  }
</script>

<Modal
  title={record ? 'Update spend item' : 'Add spend item'}
  eyebrow="SPEND ITEM"
  subtitle="Spend items reduce the ending balance for that day in the runway grid."
  {onClose}
>
  <form onsubmit={submit}>
    <label>Name<input bind:value={form.name} placeholder="Evening groceries" required /></label>
    <label>Date<input type="date" bind:value={form.date} required /></label>
    <label>Amount<input type="number" step="0.01" min="0" bind:value={form.amount} required /></label>
    <label>Currency
      <select bind:value={form.currency}>
        {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
      </select>
    </label>
    <div class="modal-actions">
      <button class="secondary-button" type="button" onclick={onClose}>Cancel</button>
      <button class="primary-button" type="submit" disabled={busy}>
        {record ? 'Save spend item' : 'Add spend item'}
      </button>
    </div>
  </form>
</Modal>
