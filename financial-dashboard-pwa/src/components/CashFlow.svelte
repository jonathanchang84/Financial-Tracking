<script>
  /**
   * Cash flow planner — the runway grid, obligations, and the settings that drive
   * them. The balance form, the income-stream editor and the headline figures each
   * live in their own component; this file keeps the wiring and the plan itself.
   */
  import {
    settings,
    saveSettings,
    saveSetting,
    bills,
    balanceHistory,
    commitments,
    displayCurrency,
    money,
    convertCurrency
  } from '../stores/finance.js';
  import { runwayPlanner, num, currencyOf } from '../services/runway.js';
  import { balanceRecordId } from '../services/balanceHistory.js';
  import { saveRecord } from '../services/commands.js';
  import {
    MAX_INCOME_STREAMS,
    createStream,
    normaliseIncomeStreams,
    removeStream,
    resolveMainPayday,
    upcomingPaydays,
    upsertStream,
    withMainStream
  } from '../services/income.js';
  import { currentMonthExpenses } from '../services/financeCalculations.js';
  import { expensePaymentKey, isExpensePaid } from '../services/paymentState.js';
  import { dayKey, longLabel } from '../services/dates.js';
  import { confirmDelete } from '../services/commands.js';
  import { showToast, errorToast } from '../stores/ui.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import IncomeStreamsPanel from './IncomeStreamsPanel.svelte';
  import RunwayMetrics from './RunwayMetrics.svelte';
  import CashSettingsPanel from './CashSettingsPanel.svelte';
  import DailyRunwayTable from './DailyRunwayTable.svelte';
  import RunwayVisual from './RunwayVisual.svelte';
  import RecordList from './RecordList.svelte';
  import BillModal from './BillModal.svelte';
  import CommitmentModal from './CommitmentModal.svelte';
  import CurrentMonthExpenses from './CurrentMonthExpenses.svelte';

  let editingBill = $state(null);
  let editingCommitment = $state(null);
  let showBill = $state(false);
  let showCommitment = $state(false);

  const balanceCurrency = $derived($settings.balanceCurrency || 'USD');
  const paidExpenses = $derived($settings.paidExpenses || {});

  const incomeStreams = $derived(normaliseIncomeStreams($settings.incomeStreams));
  const mainPayday = $derived(resolveMainPayday(incomeStreams, new Date()));
  const otherPaydays = $derived(
    upcomingPaydays(incomeStreams.filter((stream) => !mainPayday || stream.id !== mainPayday.stream.id), new Date())
  );
  // The runway still takes one resolved date, so every existing figure and test is
  // unchanged. The legacy scalar stays as a fallback for pre-migration backups.
  const runwayPayday = $derived(mainPayday?.key || $settings.payday || '');

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
      payday: runwayPayday,
      // The payday rule, not just the next date: the cycle view needs to know
      // when the cycle opened, which a single future date cannot say.
      paydayDayOfMonth: mainPayday?.dayOfMonth ?? null,
      balanceHistory: $balanceHistory,
      bills: $bills,
      commitments: $commitments,
      paidExpenses
    })
  );

  // A balance with no date is still enough to draw the grid from today onward, so
  // the empty state is only ever about a missing balance or a missing payday now.
  const runwayEmptyMessage = $derived(
    plan.awaitingHistory
      ? 'Enter your available balance above to see the runway. Add a dated balance for a past day to fill in the days already gone in this cycle.'
      : 'Set your balance and payday to see the daily runway.'
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

  // Persist the balance, with the date deciding what the save means.
  //
  // The three cases are genuinely different operations, and treating them as one
  // was corrupting the runway:
  //   - past:    history only. Writing the scalar as well would replace *today's*
  //              balance with a figure from last Tuesday, and since the grid
  //              anchors today on that scalar, every forward projection moved with
  //              it. A backfill must never move today's balance.
  //   - today:   both, because this is the common case and the scalar is what the
  //              rest of the app reads.
  //   - future:  rejected. A balance that has not happened yet is not a fact, and
  //              it would anchor the grid on a day the user cannot spend on.
  async function saveCashSettings(next) {
    const { balanceDate, ...settings } = next;
    const date = dayKey(balanceDate);
    const todayKey = dayKey(new Date());
    if (!date) {
      // `dayKey('')` is `''`, which failed both date comparisons below and fell
      // through to writing the scalar with no history record at all — a silent
      // partial save. Refused rather than guessed at.
      errorToast('Choose the date this balance was true');
      throw new Error('missing balance date');
    }
    if (date > todayKey) {
      errorToast('Balance dates cannot be in the future');
      // Thrown so the form reports the rejection rather than claiming a save.
      throw new Error('future balance date');
    }
    if (date < todayKey) {
      // History only: `balance` is deliberately left out of the settings write, so
      // the stored current balance is untouched by a past backfill. The currency is
      // still saved — it describes the account, not the day.
      const { balance, ...withoutBalance } = settings;
      await saveSettings(withoutBalance);
      await saveRecord(
        'balanceHistory',
        { id: balanceRecordId(date), date, amount: num(balance), currencyCode: next.balanceCurrency },
        { silent: true }
      );
      // A distinct confirmation, because a backfill otherwise reads on screen
      // exactly like changing what you have available today.
      showToast(`Recorded ${money(num(balance), next.balanceCurrency)} for ${longLabel(date)}`);
      return;
    }
    await saveSettings(settings);
    if (date) {
      await saveRecord(
        'balanceHistory',
        { id: balanceRecordId(date), date, amount: num(next.balance), currencyCode: next.balanceCurrency },
        { silent: true }
      );
    }
  }

  /* ------------------------------------------------------------------ */
  /* Income streams                                                      */
  /* ------------------------------------------------------------------ */

  async function persistStreams(next) {
    try {
      await saveSetting('incomeStreams', next);
    } catch (error) {
      errorToast(`Could not save income streams: ${error.message}`);
    }
  }

  async function addStream() {
    if (incomeStreams.length >= MAX_INCOME_STREAMS) {
      errorToast(`You can track up to ${MAX_INCOME_STREAMS} income streams`);
      return;
    }
    await persistStreams(createStream(incomeStreams));
    showToast('Income stream added');
  }

  async function updateStream(id, changes) {
    await persistStreams(upsertStream(incomeStreams, { id, ...changes }));
  }

  async function makeMain(id) {
    await persistStreams(withMainStream(incomeStreams, id));
    const stream = incomeStreams.find((item) => item.id === id);
    showToast(`${stream?.name || 'Stream'} is now the main payday`);
  }

  async function deleteStream(id) {
    const stream = incomeStreams.find((item) => item.id === id);
    const remaining = removeStream(incomeStreams, id);
    await persistStreams(remaining);
    showToast(remaining.some((item) => item.isMain)
      ? `Removed ${stream?.name || 'stream'}. ${remaining.find((item) => item.isMain)?.name} is now the main payday.`
      : `Removed ${stream?.name || 'stream'}`);
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
        Save the balance and balance currency, list each income stream, then add bills and Spend Items. Everything
        is stored on this device first and committed to your account automatically.
      </p>
    </div>
    <CurrencySelect id="cashflow-currency" compact label="Default currency" />
  </div>

  <section class="panel">
    <CashSettingsPanel balance={$settings.balance} currency={balanceCurrency} onSave={saveCashSettings} />

    <RunwayMetrics {plan} {mainPayday} {inDisplay} />
  </section>

  <IncomeStreamsPanel
    streams={incomeStreams}
    {mainPayday}
    {otherPaydays}
    onAdd={addStream}
    onUpdate={updateStream}
    onMakeMain={makeMain}
    onDelete={deleteStream}
  />

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
        <p class="hint">One row per day across the whole pay cycle: starting balance, hypothetical Safe to Spend, Spend Items, projected cumulative safe spend (that amount times the number of days from today), bills and the actual ending balance. Days already gone are shaded and show an em-dash for the cumulative column, and a day marked "Recorded" is one you entered a balance for. Entering a balance for a past date records history only; it does not change what you have available today.</p>
      </div>
    </div>
    <DailyRunwayTable
      rows={plan.rows}
      currency={balanceCurrency}
      emptyMessage={runwayEmptyMessage}
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
