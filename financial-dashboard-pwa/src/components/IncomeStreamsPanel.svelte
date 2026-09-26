<script>
  /**
   * Income streams: named, recurring paydays with exactly one marked as the main
   * payday the runway runs from and to.
   *
   * Deliberately presentational — it owns no store access and no persistence, so
   * the list rules stay testable in `services/income.js` and this component stays
   * replaceable without touching the sync path.
   */
  import { MAX_INCOME_STREAMS, paydayDetail } from '../services/income.js';

  let {
    streams = [],
    mainPayday = null,
    otherPaydays = [],
    onAdd = () => {},
    onUpdate = () => {},
    onMakeMain = () => {},
    onDelete = () => {}
  } = $props();

  const heading = $derived(streams.length === 1 ? 'Income' : `${streams.length} income streams`);
</script>

<section class="panel">
  <div class="section-heading">
    <div>
      <p class="eyebrow">INCOME STREAMS</p>
      <h3>{heading}</h3>
      <p class="hint">
        Enter the day of the month each payment arrives. A day landing on a weekend is brought back to the Friday
        before. The main payday is the one the runway runs from and to; a single stream becomes it automatically.
      </p>
    </div>
    <button
      class="primary-button"
      type="button"
      disabled={streams.length >= MAX_INCOME_STREAMS}
      onclick={onAdd}
    >
      Add income stream
    </button>
  </div>

  {#if !streams.length}
    <p class="muted">No income streams yet. Add one to see the runway.</p>
  {:else}
    <div class="fh-scroll">
      <table class="fh-table">
        <thead>
          <tr>
            <th scope="col" class="text-cell">Income stream</th>
            <th scope="col">Day of month</th>
            <th scope="col">Next payday</th>
            <th scope="col">Main</th>
            <th scope="col"><span class="visually-hidden">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {#each streams as stream (stream.id)}
            {@const detail = paydayDetail(stream, new Date())}
            <tr class:primary-row={stream.isMain}>
              <td class="text-cell">
                <input
                  type="text"
                  value={stream.name}
                  maxlength="60"
                  placeholder="Income"
                  aria-label="Income stream name"
                  onchange={(event) => onUpdate(stream.id, { name: event.currentTarget.value })}
                />
              </td>
              <td>
                <input
                  class="fh-number"
                  type="number"
                  min="1"
                  max="31"
                  step="1"
                  value={stream.dayOfMonth}
                  aria-label="Day of the month paid"
                  onchange={(event) => onUpdate(stream.id, { dayOfMonth: event.currentTarget.value })}
                />
              </td>
              <td>
                {#if detail}
                  <span>{detail.weekday} {detail.label}</span>
                  {#if detail.adjusted}<p class="hint">{detail.notes[0]}</p>{/if}
                {:else}
                  <span class="muted">—</span>
                {/if}
              </td>
              <td>
                {#if stream.isMain}
                  <span class="badge">main</span>
                {:else}
                  <button class="secondary-button" type="button" onclick={() => onMakeMain(stream.id)}>Make main</button>
                {/if}
              </td>
              <td>
                <button class="secondary-button" type="button" onclick={() => onDelete(stream.id)}>Remove</button>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if otherPaydays.length}
    <p class="hint" style="margin-top:10px">
      Also paid: {otherPaydays.map((item) => `${item.stream.name} · ${item.weekday} ${item.label}`).join('  ·  ')}
    </p>
  {/if}
</section>
