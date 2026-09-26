<script>
  /** Per-pension-pot annual growth assumptions with compounded monthly equivalents. */
  import { monthlyPensionRate } from '../services/financeCalculations.js';
  import { num, seriesNameOf } from '../services/runway.js';

  let {
    pots = [],
    rates = {},
    fallbackRate = 0.05,
    onSave = async () => {},
    emptyMessage = 'Add a pension pot before setting its growth rate.'
  } = $props();

  let drafts = $state({});
  let busy = $state(false);
  let error = $state('');
  let syncedKey = '';

  function effectiveRate(pot) {
    const id = String(pot.id);
    if (Object.prototype.hasOwnProperty.call(rates || {}, id)) return num(rates[id]);
    return num(fallbackRate);
  }

  $effect(() => {
    const next = Object.fromEntries(
      pots.map((pot) => [String(pot.id), String(effectiveRate(pot) * 100)])
    );
    const key = JSON.stringify(next);
    if (key === syncedKey) return;
    syncedKey = key;
    drafts = next;
  });

  async function submit(event) {
    event.preventDefault();
    error = '';
    const next = {};
    for (const pot of pots) {
      const id = String(pot.id);
      const percent = Number(String(drafts[id] ?? '').replace(/,/g, ''));
      if (!Number.isFinite(percent) || percent <= -100) {
        error = `Enter an annual growth rate greater than -100% for ${seriesNameOf(pot)}.`;
        return;
      }
      next[id] = percent / 100;
    }
    busy = true;
    try {
      await onSave(next);
    } catch (caught) {
      error = caught?.message || 'Could not save pension growth rates.';
    } finally {
      busy = false;
    }
  }
</script>

{#if pots.length}
  <form class="growth-form" onsubmit={submit}>
    <div class="growth-list">
      {#each pots as pot (pot.id)}
        {@const rate = effectiveRate(pot)}
        <div class="growth-row">
          <label>{seriesNameOf(pot)} — annual growth %
            <input
              type="number"
              step="0.01"
              min="-99.99"
              bind:value={drafts[String(pot.id)]}
              required
            />
          </label>
          <p class="hint">
            Compounded monthly: {monthlyPensionRate(rate) * 100 < 0 ? '' : '+'}
            {(monthlyPensionRate(rate) * 100).toFixed(3)}%
          </p>
        </div>
      {/each}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="button-row">
      <button class="primary-button" type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Save growth rates'}
      </button>
    </div>
  </form>
{:else}
  <p class="muted">{emptyMessage}</p>
{/if}

<style>
  .growth-form { display: grid; gap: 12px; }
  .growth-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); gap: 10px; }
  .growth-row { border: 1px solid var(--line); border-radius: 10px; padding: 10px; background: var(--panel-alt); }
  .growth-row .hint { margin-top: 6px; }
</style>
