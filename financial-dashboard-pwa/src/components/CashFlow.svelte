<script>
  /**
   * Cash flow planner — the historic form controls plus the daily runway grid.
   * Balance/currency/payday are settings; bills and commitments are records.
   */
  import {
    settings,
    saveSetting,
    bills,
    commitments,
    displayCurrency,
    money,
    convertCurrency,
    RATES,
    CURRENCY_NAMES
  } from '../stores/finance.js';
  import { runwayPlanner, num, currencyOf } from '../services/runway.js';
  import { dayKey, longLabel } from '../services/dates.js';
  import { confirmDelete } from '../services/commands.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import DailyRunwayTable from './DailyRunwayTable.svelte';
  import RecordList from './RecordList.svelte';
  import BillModal from './BillModal.svelte';
  import CommitmentModal from './CommitmentModal.svelte';

  const codes = Object.keys(RATES);

  let form = $state({ balance: '0', currency: 'USD', payday: '' });
  let editingBill = $state(null);
  let editingCommitment = $state(null);
  let showBill = $state(false);
  let showCommitment = $state(false);

  let syncedKey = '';
  // Re-fill the form whenever the stored settings change (boot, restore, save).
  $effect(() => {
    const key = `${$settings.balance}|${$settings.balanceCurrency}|${$settings.payday}`;
    if (key === syncedKey) return;
    syncedKey = key;
    form = {
      balance: $settings.balance != null ? String($settings.balance) : '',
      currency: $settings.balanceCurrency || 'USD',
      payday: $settings.payday || ''
    };
  });

  const balanceCurrency = $derived($settings.balanceCurrency || 'USD');
  const plan = $derived(
    runwayPlanner({
      balance: $settings.balance,
      currency: balanceCurrency,
      payday: $settings.payday || '',
      bills: $bills,
      commitments: $commitments
    })
  );

  const inDisplay = (value, from = balanceCurrency) =>
    money(convertCurrency(value, from, $displayCurrency), $displayCurrency);

  const commitmentRows = $derived(
    [...$commitments]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((row) => ({
        id: row.id,
        title: row.name || 'Commitment',
        subtitle: `${longLabel(row.date)} · ${currencyOf(row)}`,
        amount: money(num(row.amount), currencyOf(row)),
        raw: row
      }))
  );

  const billRows = $derived(
    [...$bills]
      .sort((a, b) => num(a.dueDay) - num(b.dueDay))
      .map((row) => ({
        id: row.id,
        title: row.name || 'Bill',
        subtitle: `${row.category || 'Bill'} · due day ${num(row.dueDay)} · ${currencyOf(row)}`,
        amount: money(num(row.amount), currencyOf(row)),
        raw: row
      }))
  );

  async function saveCashSettings(event) {
    event.preventDefault();
    const balance = num(form.balance);
    if (!Number.isFinite(balance)) {
      errorToast('Enter your available balance');
      return;
    }
    if (!form.payday) {
      errorToast('Choose your next payday');
      return;
    }
    try {
      await saveSetting('balance', balance);
      await saveSetting('balanceCurrency', form.currency);
      await saveSetting('payday', dayKey(form.payday));
      showToast('Runway settings saved');
    } catch (error) {
      errorToast(`Could not save settings: ${error.message}`);
    }
  }

  async function removeBill(row) {
    await confirmDelete('bills', row.id, `Delete the bill "${row.name}"?`);
  }

  async function removeCommitment(row) {
    await confirmDelete('commitments', row.id, `Delete the commitment "${row.name}"?`);
  }

  function openBill(row = null) {
    editingBill = row;
    showBill = true;
  }

  function openCommitment(row = null) {
    editingCommitment = row;
    showCommitment = true;
  }
</script>


<section class="fh-grid">
  <div class="view-heading">
    <div>
      <p class="eyebrow">CASH FLOW</p>
      <h2>Runway planner</h2>
      <p class="muted">
        Save the balance, currency and payday, then add bills and commitments. Everything is stored on
        this device first.
      </p>
    </div>
    <CurrencySelect id="cashflow-currency" compact label="View" />
  </div>

  <section class="panel">
    <form class="fh-form" onsubmit={saveCashSettings}>
      <label>Available balance
        <input type="number" step="0.01" bind:value={form.balance} required />
      </label>
      <label>Currency
        <select bind:value={form.currency}>
          {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
        </select>
      </label>
      <label>Next payday
        <input type="date" bind:value={form.payday} required />
      </label>
      <button class="primary-button" type="submit">Save balance and payday</button>
    </form>

    <div class="fh-metrics" style="margin-top:14px">
      <article class="fh-metric">
        <p class="eyebrow">SAFE TO COMMIT EACH DAY</p>
        <strong>{inDisplay(plan.safeToday)}</strong>
        <p class="hint">Balance spread across {plan.dayCount || 0} day(s)</p>
      </article>
      <article class="fh-metric">
        <p class="eyebrow">DAYS TO PAYDAY</p>
        <strong>{plan.dayCount || 0}</strong>
        <p class="hint">
          {plan.payday ? `Through ${longLabel(plan.payday)}` : 'Set your next payday'}
          {#if plan.truncated}<br />Grid shows the first {plan.renderedDays} days{/if}
        </p>
      </article>
      <article class="fh-metric">
        <p class="eyebrow">PROJECTED AT PAYDAY</p>
        <strong>{inDisplay(plan.projectedAtPayday)}</strong>
        <p class="hint">After safe spend, commitments and bills</p>
      </article>
    </div>
  </section>

  <section class="panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">DAILY VIEW</p>
        <h3>Daily runway table</h3>
        <p class="hint">One row per day: starting balance, safe amount, commitments, cumulative, bills, ending balance.</p>
      </div>
    </div>
    <DailyRunwayTable
      rows={plan.rows}
      currency={balanceCurrency}
      emptyMessage="Set your balance and payday to see the daily runway."
    />
  </section>

  <section class="panel">
    <div class="section-heading">
      <div><p class="eyebrow">COMMITMENTS</p><h3>Named commitments</h3></div>
      <button class="primary-button" type="button" onclick={() => openCommitment()}>Add commitment</button>
    </div>
    <RecordList
      rows={commitmentRows}
      emptyMessage="No commitments recorded yet."
      onEdit={openCommitment}
      onDelete={removeCommitment}
    />
  </section>

  <section class="panel">
    <div class="section-heading">
      <div>
        <p class="eyebrow">BILLS</p>
        <h3>Recurring bills</h3>
        <p class="hint">Due days are clamped to each month; Saturdays and Sundays shift to Monday.</p>
      </div>
      <button class="primary-button" type="button" onclick={() => openBill()}>Add bill</button>
    </div>
    <RecordList
      rows={billRows}
      emptyMessage="No recurring bills yet."
      onEdit={openBill}
      onDelete={removeBill}
    />
  </section>
</section>

{#if showCommitment}
  <CommitmentModal
    record={editingCommitment}
    defaultCurrency={balanceCurrency}
    onClose={() => { showCommitment = false; editingCommitment = null; }}
  />
{/if}

{#if showBill}
  <BillModal
    record={editingBill}
    defaultCurrency={balanceCurrency}
    onClose={() => { showBill = false; editingBill = null; }}
  />
{/if}
