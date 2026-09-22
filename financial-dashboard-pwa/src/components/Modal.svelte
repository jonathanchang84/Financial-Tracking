<script>
  import { createEventDispatcher } from 'svelte';
  export let title = '';
  const dispatch = createEventDispatcher();

  function close() {
    dispatch('close');
  }
</script>

<div class="backdrop" on:click|self={close} role="presentation">
  <section class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header>
      <div>
        <p class="eyebrow">LOCAL ENTRY</p>
        <h3>{title}</h3>
      </div>
      <button class="text-button" type="button" on:click={close}>Close</button>
    </header>
    <slot />
  </section>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    z-index: 60;
  }
  .modal {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 20px;
    width: min(440px, 100%);
    max-height: 88vh;
    overflow-y: auto;
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 12px;
  }
  .eyebrow {
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    color: var(--muted);
    margin: 0 0 4px;
  }
  h3 {
    margin: 0;
    font-size: 1.05rem;
  }
</style>
