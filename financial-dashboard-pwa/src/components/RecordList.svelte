<script>
  /**
   * Generic list renderer used by the position, investment and pension screens.
   * `rows` items: { id, title, subtitle, amount, badges?: string[], raw }.
   */
  let {
    rows = [],
    emptyMessage = 'No records yet.',
    onEdit = null,
    onUpdate = null,
    onDelete = null,
    amountClass = ''
  } = $props();
</script>

{#if !rows.length}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="stack-list">
    {#each rows as row (row.id)}
      <div class="stack-row">
        <span>
          <strong>{row.title}</strong>
          {#if row.subtitle}<small>{row.subtitle}</small>{/if}
          {#if row.badges?.length}
            <span class="button-row" style="margin-top:4px">
              {#each row.badges as badge}
                <span class="badge {badge.tone || ''}">{badge.label}</span>
              {/each}
            </span>
          {/if}
        </span>
        <span>
          {#if row.amount}<strong class={amountClass}>{row.amount}</strong>{/if}
          {#if onUpdate}
            <button class="text-button" type="button" onclick={() => onUpdate(row.raw)}>Update</button>
          {/if}
          {#if onEdit}
            <button class="text-button" type="button" onclick={() => onEdit(row.raw)}>Edit</button>
          {/if}
          {#if onDelete}
            <button class="text-button danger" type="button" onclick={() => onDelete(row.raw)}>Delete</button>
          {/if}
        </span>
      </div>
    {/each}
  </div>
{/if}
