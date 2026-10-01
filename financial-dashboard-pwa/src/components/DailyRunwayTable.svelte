<script>
  /**
   * Daily runway grid across a pay cycle: starting balance, hypothetical
   * safe-to-spend amount, Spend Items, cumulative hypothetical safe spend, bills
   * and actual ending balance.
   *
   * Three distinctions the grid itself carries, so none of them is re-derived
   * here from the current date:
   *   - `isPast`   a day already gone, shaded so it reads as history
   *   - `isToday`  marked rather than shaded
   *   - `isRecorded` the balance was actually captured that day, badged
   *
   * An unanchored day has no recorded balance behind it and shows an em-dash
   * rather than a formatted zero: a zero would be a real-looking figure
   * claiming the balance was nil, which is exactly the kind of quiet wrongness
   * the em-dash exists to avoid.
   */
  import { displayCurrency, convertCurrency, money } from '../stores/finance.js';

  let {
    rows = [],
    currency = 'USD',
    limit = 0,
    emptyMessage = 'Set your balance and payday to see the daily runway.'
  } = $props();

  const visible = $derived(limit > 0 ? rows.slice(0, limit) : rows);
  const fmt = (value) => money(convertCurrency(value, currency, $displayCurrency), $displayCurrency);
  // `null` means "no recorded balance for this day", which is not the same as 0.
  const cell = (value) => (value === null || value === undefined ? '—' : fmt(value));
</script>

{#if !visible.length}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="fh-scroll">
    <table class="fh-table runway-table">
      <colgroup>
        <col class="runway-date" />
        <col class="runway-number" />
        <col class="runway-number" />
        <col class="runway-number" />
        <col class="runway-cumulative" />
        <col class="runway-number" />
        <col class="runway-number" />
      </colgroup>
      <thead>
        <tr>
          <th scope="col" class="text-cell">Date</th>
          <th scope="col">Starting</th>
          <th scope="col">Safe to spend</th>
          <th scope="col">Spend Items</th>
          <th scope="col">Projected cumulative safe spend</th>
          <th scope="col">Scheduled bills</th>
          <th scope="col">Ending</th>
        </tr>
      </thead>
      <tbody>
        {#each visible as row (row.date)}
          <tr class:is-past={row.isPast} class:is-today={row.isToday} class:is-unanchored={!row.anchored}>
            <th scope="row" class="text-cell">
              <strong>{row.label}</strong>
              <small>
                Day {row.dayNumber}
                {#if row.isToday}<span class="runway-flag">Today</span>{/if}
                {#if row.isRecorded}<span class="runway-flag recorded">Recorded</span>{/if}
              </small>
            </th>
            <td>{cell(row.starting)}</td>
            <td>{cell(row.safe)}</td>
            <td class:strong={row.commitments > 0}>{cell(row.commitments)}</td>
            <td>{cell(row.cumulativeSafeSpend)}</td>
            <td class:strong={row.bills > 0}>{cell(row.bills)}</td>
            <td class="strong" class:negative={row.ending !== null && row.ending < 0}>{cell(row.ending)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  <p class="hint">
    The grid covers the whole pay cycle, from this payday through to the day before the next, so
    days already gone are shaded. Days with no recorded balance show an em-dash rather than a
    figure: enter a balance for that date above to fill them in, and a day marked "Recorded" is a
    captured figure while the rest are carried forward from it.
    Safe to spend is the cash remaining after every bill and Spend Item still ahead of today,
    divided by the days from today to the end of the cycle. The daily amount is the same on each
    row, so the projected cumulative counts up from today and the last row equals the cash after
    bills and Spend Items. It is hypothetical, so it does not reduce Starting or Ending, and
    days already gone show an em-dash because there is nothing left to budget for them. Saturday
    and Sunday bill due dates shift forward to Monday.
  </p>
{/if}
