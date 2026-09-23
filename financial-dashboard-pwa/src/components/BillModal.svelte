<script>
  /** Add / edit a recurring bill (`dueDay` 1-31, clamped to each month). */
  import Modal from './Modal.svelte';
  import { RATES, CURRENCY_NAMES } from '../stores/finance.js';
  import { saveBill } from '../services/commands.js';
  import { errorToast } from '../stores/ui.js';

  let { record = null, defaultCurrency = 'USD', onClose = () => {} } = $props();

  function initialForm() {
    // svelte-ignore state_referenced_locally
    const source = record;
    // svelte-ignore state_referenced_locally
    const currencyFallback = defaultCurrency;
    return {
      name: source?.name ?? '',
      category: source?.category ?? '',
      amount: source?.amount != null ? String(source.amount) : '',
      dueDay: source?.dueDay != null ? String(source.dueDay) : '1',
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
      await saveBill({
        id: record?.id,
        name: form.name,
        category: form.category,
        amount: Number(form.amount),
        dueDay: Number(form.dueDay),
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
  title={record ? 'Update bill' : 'Add bill'}
  eyebrow="RECURRING BILL"
  subtitle="Weekend due dates are paid on the following Monday."
  {onClose}
>
  <form onsubmit={submit}>
    <label>Name<input bind:value={form.name} placeholder="Rent" required /></label>
    <label>Category<input bind:value={form.category} placeholder="Housing" /></label>
    <label>Amount<input type="number" step="0.01" min="0" bind:value={form.amount} required /></label>
    <label>Due day (1-31)<input type="number" min="1" max="31" bind:value={form.dueDay} required /></label>
    <label>Currency
      <select bind:value={form.currency}>
        {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
      </select>
    </label>
    <div class="modal-actions">
      <button class="secondary-button" type="button" onclick={onClose}>Cancel</button>
      <button class="primary-button" type="submit" disabled={busy}>
        {record ? 'Save bill' : 'Add bill'}
      </button>
    </div>
  </form>
</Modal>
