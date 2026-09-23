<script>
  import { toast } from '../stores/ui.js';
</script>

{#if $toast.message}
  <div class="toast show" class:error={$toast.tone === 'error'} role="status" aria-live="polite">
    {$toast.message}
  </div>
{/if}
