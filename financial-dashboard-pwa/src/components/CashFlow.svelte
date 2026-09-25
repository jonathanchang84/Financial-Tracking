<script>
  /**
   * Cash flow planner — the historic form controls plus the daily runway grid.
   * Balance, balance currency and payday are settings; bills and Spend Items are records.
   */
  import {
    settings,
    saveSettings,
    saveSetting,
    bills,
    commitments,
    displayCurrency,
    money,
    convertCurrency,
    RATES,
    CURRENCY_NAMES
  } from '../stores/finance.js';
  import { runwayPlanner, num, currencyOf, parseNonNegativeNumber } from '../services/runway.js';
  import { currentMonthExpenses } from '../services/financeCalculations.js';
  import { expensePaymentKey, isExpensePaid } from '../services/paymentState.js';
  import { dayKey, longLabel, isValidDate, startOfDay } from '../services/dates.js';
  import { confirmDelete } from '../services/commands.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import DailyRunwayTable from './DailyRunwayTable.svelte';
  import RunwayVisual from './RunwayVisual.svelte';
  import RecordList from './RecordList.svelte';
  import BillModal from './BillModal.svelte';
  import CommitmentModal from './CommitmentModal.svelte';
  import CurrentMonthExpenses from './CurrentMonthExpenses.svelte';

  const codes = Object.keys(RATES);

  let form = $state({ balance: '0', currency: 'USD', payday: '' });
  let editingBill = $state(null);
  let editingCommitment = $state(null);
  let showBill = $state(false);
  let showCommitment = $state(false);
  let savingCashSettings = $state(false);

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
  const paidExpenses = $derived($settings.paidExpenses || {});
  const currentMonthKey = dayKey(new Date()).slice(0, 7);
  const currentMonthData = $derived(
    currentMonthExpenses({
      balance: $settings.balance,
      currency: balanceCurrency,
      bills: $bills,
      commitments: $commitments,
      paidExpenses
    })
  );
  const currentMonthRows = $derived(new Map((currentMonthData.rows || []).map((row) => [row.paymentKey, row])));

  const plan = $derived(
    runwayPlanner({
      balance: $settings.balance,
      currency: balanceCurrency,
      payday: $settings.payday || '',
      bills: $bills,
      commitments: $commitments,
      paidExpenses
    })
  );

  const inDisplay = (value, from = balanceCurrency) =>
    money(convertCurrency(value, from, $displayCurrency), $displayCurrency);

  function currentExpenseRow(row, kind) {
    const key = kind === 'bill'
      ? expensePaymentKey(row, new Date(), currentMonthKey)
      : expensePaymentKey(row, row.date, currentMonthKey);
    return currentMonthRows.get(key) || {
      paid: isExpensePaid(row, row.date || new Date(), paidExpenses, currentMonthKey),
      paymentKey: key
    };
  }

  const commitmentRows = $derived(
    [...$commitments]
      .sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .map((row) => {
        const current = currentExpenseRow(row, 'commitment');
        return {
          id: row.id,
          title: row.name || 'Spend item',
          subtitle: `${longLabel(row.date)} · ${currencyOf(row)}`,
          amount: money(num(row.amount), currencyOf(row)),
          paid: current?.paid === true,
          paymentKey: current?.paymentKey || expensePaymentKey(row, row.date, currentMonthKey),
          raw: row
        };
      })
  );

  const billRows = $derived(
    [...$bills]
      .sort((a, b) => num(a.dueDay) - num(b.dueDay))
      .map((row) => {
        const current = currentExpenseRow(row, 'bill');
        return {
          id: row.id,
          title: row.name || 'Bill',
          subtitle: `${row.category || 'Bill'} · due day ${num(row.dueDay)} · ${currencyOf(row)}`,
          amount: money(num(row.amount), currencyOf(row)),
          paid: current?.paid === true,
          paymentKey: current?.paymentKey || expensePaymentKey(row, new Date(), currentMonthKey),
          raw: row
        };
      })
  );

  // Persist the balance when the field is committed. Invalid drafts are left
  // visible for correction and never replace the last valid stored balance.
  async function saveBalanceNow() {
    const balance = parseNonNegativeNumber(form.balance);
    if (balance === null) {
      errorToast('Enter a valid available balance');
      return;
    }
    try {
      await saveSettings({ balance, balanceCurrency: form.currency });
      showToast('Balance saved');
    } catch (error) {
      errorToast('Could not save balance: ' + error.message);
    }
  }

  async function saveCashSettings(event) {
    event.preventDefault();
    const balance = parseNonNegativeNumber(form.balance);
    if (balance === null) {
      errorToast('Enter a valid available balance');
      return;
    }
    if (form.payday && (!isValidDate(form.payday) || startOfDay(form.payday) < startOfDay(new Date()))) {
      errorToast('Choose today or a future payday');
      return;
    }
    savingCashSettings = true;
    try {
      await saveSettings({
        balance,
        balanceCurrency: form.currency,
        payday: form.payday ? dayKey(form.payday) : ''
      });
      showToast(form.payday ? 'Runway settings saved' : 'Balance saved — set a payday to see the runway');
    } catch (error) {
      errorToast(`Could not save settings: ${error.message}`);
    } finally {
      savingCashSettings = false;
    }
  }

  async function togglePaid(row) {
    if (!row?.paymentKey) return;
    const next = { ...paidExpenses };
    if (row.paid) delete next[row.paymentKey];
    else next[row.paymentKey] = true;
    try {
      await saveSetting('paidExpenses', next);
      showToast(row.paid ? 'Marked unpaid' : 'Marked paid');
    } catch (error) {
      errorToast(`Could not update payment state: ${error.message}`);
    }
  }

  async function removeBill(row) {
    await confirmDelete('bills', row.id, `Delete the bill "${row.name}"?`);
  }

  async function removeCommitment(row) {
    await confirmDelete('commitments', row.id, `Delete the spend item "${row.name}"?`);
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
        Save the balance, balance currency and payday, then add bills and Spend Items. Everything is stored on
        this device first.
      </p>
    </div>
    <CurrencySelect id="cashflow-currency" compact label="Default currency" />
  </div>

  <section class="panel">
    <form class="fh-form" onsubmit={saveCashSettings}>
      <label>Available balance
        <input type="number" min="0" step="0.01" bind:value={form.balance} required onchange={saveBalanceNow} />
      </label>
      <label>Balance currency
        <select bind:value={form.currency} onchange={saveBalanceNow}>
          {#each codes as code}<option value={code}>{code} · {CURRENCY_NAMES[code] ?? code}</option>{/each}
        </select>
      </label>
      <label>Next payday
        <input type="date" bind:value={form.payday} />
      </label>
      <button class="primary-button" type="submit" disabled={savingCashSettings}>Save balance and payday</button>
    </form>

    <div class="fh-metrics" style="margin-top:14px">
      <article class="fh-metric">
        <p class="eyebrow">SAFE TO SPEND EACH DAY</p>
        <strong>{inDisplay(plan.safeToday)}</strong>
        <p class="hint">After reserving {inDisplay(plan.obligationTotal)}; hypothetical and spread before payday</p>
      </article>
      <article class="fh-metric">
        <p class="eyebrow">DAYS UNTIL PAYDAY</p>
        <strong>{plan.daysUntilPayday || 0}</strong>
        <p class="hint">
          {plan.paydayPast ? 'Payday has passed — choose a future date' : plan.payday ? `Payday ${longLabel(plan.payday)} · ${plan.dayCount || 0} inclusive grid day(s)` : 'Set your next payday'}
          {#if plan.truncated}<br />Grid shows the first {plan.renderedDays} days{/if}
        </p>
      </article>
      <article class="fh-metric">
        <p class="eyebrow">CASH AFTER BILLS & SPEND ITEMS</p>
        <strong class:negative={plan.cashAfterPlannedSpend < 0}>{inDisplay(plan.cashAfterPlannedSpend)}</strong>
        <p class="hint">{plan.shortfall > 0 ? `${inDisplay(plan.shortfall)} short of obligations` : 'Available for the cycle after obligations'}</p>
      </article>
      <article class="fh-metric">
        <p class="eyebrow">BALANCE AT PAYDAY</p>
        <strong class:negative={plan.projectedAtPayday < 0}>{inDisplay(plan.projectedAtPayday)}</strong>
        <p class="hint">After bills and Spend Items only; Safe to Spend is hypothetical</p>
      </article>
    </div>
  </section>

  <section class="panel">
    <div class="section-heading">
      <div><p class="eyebrow">CURRENT MONTH</p><h3>Workbook-style expense remainder</h3><p class="hint">Paid rows do not reduce the running remainder; unpaid rows do.</p></div>
    </div>
    <CurrentMonthExpenses data={currentMonthData} currency={balanceCurrency} onTogglePaid={togglePaid} />
  </section>

  <section class="panel">
    <RunwayVisual
      rows={plan.rows}
      currency={balanceCurrency}
      scheduledBills={plan.scheduledBills}
      scheduledCommitments={plan.scheduledCommitments}
      obligationTotal={plan.obligationTotal}
      truncated={plan.truncated}
      emptyMessage="Set your balance and payday to see the runway visualization."
    />

    <div class="section-heading">
      <div>
        <p class="eyebrow">DAILY VIEW</p>
        <h3>Daily runway table</h3>
        <p class="hint">One row per day: starting balance, hypothetical Safe to Spend, Spend Items, cumulative safe spend amount, bills and the actual obligations-only ending balance.</p>
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
      <div><p class="eyebrow">SPEND ITEMS</p><h3>Spend items</h3></div>
      <button class="primary-button" type="button" onclick={() => openCommitment()}>Add spend item</button>
    </div>
    <RecordList
      rows={commitmentRows}
      emptyMessage="No spend items recorded yet."
      onEdit={openCommitment}
      onDelete={removeCommitment}
      onTogglePaid={togglePaid}
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
      onTogglePaid={togglePaid}
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
