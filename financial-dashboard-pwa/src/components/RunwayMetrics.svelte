<script>
  /**
   * The four cash-flow headline figures. Presentational only: the arithmetic lives
   * in `services/runway.js` and the resolved payday in `services/income.js`, so this
   * component just formats what it is handed.
   */
  let { plan = {}, mainPayday = null, inDisplay = (value) => value } = $props();
</script>

<div class="fh-metrics" style="margin-top:14px">
  <article class="fh-metric">
    <p class="eyebrow">SAFE TO SPEND EACH DAY</p>
    <strong>{inDisplay(plan.safeToday)}</strong>
    <p class="hint">
      {plan.isCycle
        ? 'Spread across the whole pay cycle; after reserving'
        : 'After reserving'}
      {inDisplay(plan.obligationTotal)}; hypothetical
    </p>
  </article>
  <article class="fh-metric">
    <p class="eyebrow">DAYS UNTIL PAYDAY</p>
    <strong>{plan.daysUntilPayday || 0}</strong>
    <p class="hint">
      {mainPayday
        ? `Main payday ${mainPayday.weekday} ${mainPayday.label}`
        : plan.paydayPast
          ? 'Payday has passed — add an income stream to see the runway'
          : 'Add an income stream to see the runway'}
      {#if plan.isCycle}<br />Cycle of {plan.dayCount || 0} day(s), from {plan.cycleStart} to {plan.cycleEnd}{/if}
      {#if plan.pastDays > 0}<br />{plan.pastDays} day(s) of this cycle are already behind you{/if}
      {#if plan.truncated}<br />Grid shows the first {plan.renderedDays} days{/if}
    </p>
  </article>
  <article class="fh-metric">
    <p class="eyebrow">CASH AFTER BILLS & SPEND ITEMS</p>
    <strong class:negative={plan.cashAfterPlannedSpend < 0}>{inDisplay(plan.cashAfterPlannedSpend)}</strong>
    <p class="hint">
      {plan.shortfall > 0 ? `${inDisplay(plan.shortfall)} short of obligations` : 'Available for the cycle after obligations'}
    </p>
  </article>
  <article class="fh-metric">
    <p class="eyebrow">BALANCE AT PAYDAY</p>
    <strong class:negative={plan.projectedAtPayday < 0}>{inDisplay(plan.projectedAtPayday)}</strong>
    <p class="hint">After bills and Spend Items only; Safe to Spend is hypothetical</p>
  </article>
</div>
