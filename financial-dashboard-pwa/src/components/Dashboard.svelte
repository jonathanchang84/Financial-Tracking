<script>
  /** Overview: headline metrics, daily runway preview, position and budget health. */
  import {
    settings,
    positionTotals,
    netWorthHistory,
    netWorthTotal,
    investmentsTotal,
    pensionsTotal,
    expensesLogged,
    budgets,
    bills,
    commitments,
    displayCurrency,
    money,
    convertCurrency
  } from '../stores/finance.js';
  import { runwayPlanner, growthPercent, num } from '../services/runway.js';
  import { normaliseIncomeStreams, resolveMainPayday } from '../services/income.js';
  import CurrencySelect from './CurrencySelect.svelte';
  import DailyRunwayTable from './DailyRunwayTable.svelte';

  let { onOpenCashflow = () => {}, onOpenPosition = () => {}, onOpenBudgets = () => {} } = $props();

  const balanceCurrency = $derived($settings.balanceCurrency || 'USD');
  const incomeStreams = $derived(normaliseIncomeStreams($settings.incomeStreams));
  const mainPayday = $derived(resolveMainPayday(incomeStreams, new Date()));
  // One resolved date, so the planner and every existing figure are unchanged.
  const payday = $derived(mainPayday?.key || $settings.payday || '');
  const plan = $derived(
    runwayPlanner({
      balance: $settings.balance,
      currency: balanceCurrency,
      payday,
      bills: $bills,
      commitments: $commitments,
      paidExpenses: $settings.paidExpenses || {}
    })
  );

  const inDisplay = (value, from = balanceCurrency) =>
    money(convertCurrency(value, from, $displayCurrency), $displayCurrency);

  /** Month-on-month change of the latest recorded snapshots (historic wording). */
  const growth = $derived.by(() => {
    const points = [...$netWorthHistory]
      .map((row) => ({
        date: String(row.date || ''),
        value: convertCurrency(num(row.value), row.currencyCode || row.currency || 'USD', $displayCurrency)
      }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const percent = growthPercent(points);
    if (percent === null) return 'Not enough snapshot data yet';
    return `${percent >= 0 ? '+' : ''}${percent.toFixed(2)}% vs the previous snapshot`;
  });

  const budgetRows = $derived($budgets.slice(0, 3));
  const breakdown = $derived(
    Object.entries($positionTotals)
      .map(([code, value]) => ({ code, value: convertCurrency(value, code, $displayCurrency) }))
  );
  const sortedBreakdown = $derived([...breakdown].sort((a, b) => b.value - a.value));
</script>

<section class="fh-grid">
  <div class="panel">
    <div class="view-heading">
      <div>
        <p class="eyebrow">TODAY</p>
        <h2>Your financial picture</h2>
        <p class="muted">
          {mainPayday
            ? `Main payday ${mainPayday.stream.name} · ${mainPayday.weekday} ${mainPayday.label}`
            : 'Payday not set'} · {plan.daysUntilPayday || 0} day(s) until payday · figures in
          {$displayCurrency}
        </p>
      </div>
      <CurrencySelect id="dashboard-currency" />
    </div>
  </div>

  <div class="fh-metrics">
    <article class="fh-metric">
      <p class="eyebrow">NET WORTH</p>
      <strong>{money($netWorthTotal, $displayCurrency)}</strong>
      <p class="hint">{growth}</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">AVAILABLE</p>
      <strong>{inDisplay(num($settings.balance))}</strong>
      <p class="hint">Saved balance in {balanceCurrency}</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">SAFE TO SPEND EACH DAY</p>
      <strong>{inDisplay(plan.safeToday)}</strong>
      <p class="hint">After reserving {inDisplay(plan.obligationTotal)} of planned obligations; hypothetical</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">DAYS UNTIL NEXT PAYDAY</p>
      <strong>{plan.daysUntilPayday || 0}</strong>
      <p class="hint">
        {mainPayday
          ? `Calendar days from today to ${mainPayday.stream.name} on ${mainPayday.label}`
          : 'Set a main income stream on Cash flow'}
      </p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">BALANCE AT PAYDAY</p>
      <strong>{inDisplay(plan.projectedAtPayday)}</strong>
      <p class="hint">After bills and Spend Items; hypothetical Safe to Spend is not deducted</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">INVESTMENTS</p>
      <strong>{money($investmentsTotal, $displayCurrency)}</strong>
      <p class="hint">Holdings at current price</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">PENSIONS</p>
      <strong>{money($pensionsTotal, $displayCurrency)}</strong>
      <p class="hint">Recorded pot values</p>
    </article>
    <article class="fh-metric">
      <p class="eyebrow">EXPENSES LOGGED</p>
      <strong>{money($expensesLogged, $displayCurrency)}</strong>
      <p class="hint">Local activity only</p>
    </article>
  </div>

  <section class="panel">
    <div class="section-heading">
      <div><p class="eyebrow">RUNWAY</p><h3>Cash safety</h3></div>
      <button class="text-button" type="button" onclick={onOpenCashflow}>Edit</button>
    </div>
    <DailyRunwayTable
      rows={plan.rows}
      currency={balanceCurrency}
      limit={8}
      emptyMessage="Set your balance and payday on Cash flow to see the runway."
    />
  </section>

  <div class="fh-grid dashboard-summary-grid">
    <section class="panel">
      <div class="section-heading">
        <div><p class="eyebrow">POSITION</p><h3>Net worth by currency</h3></div>
        <button class="text-button" type="button" onclick={onOpenPosition}>View</button>
      </div>
      {#if sortedBreakdown.length}
        <div class="stack-list">
          {#each sortedBreakdown as item (item.code)}
            <div class="stack-row">
              <span><strong>{item.code}</strong><small>Net position (converted)</small></span>
              <strong>{money(item.value, $displayCurrency)}</strong>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted">Add an account on the Position screen to begin.</p>
      {/if}
    </section>

    <section class="panel">
      <div class="section-heading">
        <div><p class="eyebrow">BUDGET</p><h3>Safety target</h3></div>
        <button class="text-button" type="button" onclick={onOpenBudgets}>View</button>
      </div>
      {#if budgetRows.length}
        <div class="stack-list">
          {#each budgetRows as budget (budget.id)}
            {@const left = Math.max(0, num(budget.limit) - num(budget.spent))}
            <div class="stack-row">
              <span>
                <strong>{budget.name}</strong>
                <small>{num(budget.spent).toFixed(2)} of {num(budget.limit).toFixed(2)} {budget.currency || 'USD'}</small>
              </span>
              <strong>{inDisplay(left, budget.currency || 'USD')} left</strong>
            </div>
          {/each}
        </div>
      {:else}
        <p class="muted">Set a monthly budget target.</p>
      {/if}
    </section>
  </div>
</section>

