<script>
  /** Shared modal shell. Children are rendered via a snippet. */
  let { title = '', eyebrow = 'LOCAL ENTRY', subtitle = '', onClose = () => {}, children } = $props();

  function maybeClose() {
    onClose?.();
  }
</script>

<svelte:window onkeydown={(event) => { if (event.key === 'Escape') maybeClose(); }} />

<div
  class="modal-backdrop"
  role="presentation"
  onclick={(event) => {
    if (event.target === event.currentTarget) maybeClose();
  }}
>
  <div class="modal" role="dialog" aria-modal="true" aria-label={title}>
    <header class="section-heading">
      <div>
        <p class="eyebrow">{eyebrow}</p>
        <h3>{title}</h3>
        {#if subtitle}<p class="hint">{subtitle}</p>{/if}
      </div>
      <button class="text-button" type="button" onclick={maybeClose}>Close</button>
    </header>
    {@render children?.()}
  </div>
</div>
