<script>
  export let rows = [];
  export let onEdit = null;
  export let onDelete = null;
  export let emptyMessage = 'No records yet.';
</script>

{#if rows.length === 0}
  <p class="muted">{emptyMessage}</p>
{:else}
  <div class="stack-list">
    {#each rows as row (row.id)}
      <div class="stack-row">
        <span>
          <strong>{row.title}</strong>
          <small>{row.subtitle}</small>
        </span>
        <span>
          {#if row.amount}<strong>{row.amount}</strong>{/if}
          {#if onEdit}
            <button class="text-button" type="button" on:click={() => onEdit(row.raw)}>Edit</button>
          {/if}
          {#if onDelete}
            <button class="text-button danger" type="button" on:click={() => onDelete(row.raw)}>Delete</button>
          {/if}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .stack-list {
    display: flex;
    flex-direction: column;
  }
  .stack-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    padding: 10px 0;
    border-bottom: 1px solid var(--line);
  }
  .stack-row:last-child {
    border-bottom: none;
  }
  .stack-row span:first-child {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }
  .stack-row small {
    color: var(--muted);
    font-size: 0.78rem;
  }
  .stack-row span:last-child {
    display: flex;
    align-items: center;
    gap: 8px;
    white-space: nowrap;
  }
  .muted {
    color: var(--muted);
  }
</style>
