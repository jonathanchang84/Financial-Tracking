<script>
  /**
   * One-time nudge when there is real data and no account holding it.
   *
   * Deliberately a dismissible banner rather than a modal: a dialog on a finance
   * app gets dismissed reflexively and then never read, whereas a quiet line in
   * the page stays available. It also never appears once someone is protected, is
   * offline, or has a genuine sync failure to deal with instead.
   */
  let { pending = 0, onDismiss = () => {}, onSignIn = () => {} } = $props();
</script>

<aside class="protection-banner" role="status">
  <div>
    <p class="eyebrow">NOT IN YOUR ACCOUNT</p>
    <p class="hint">
      {pending} record{pending === 1 ? '' : 's'} on this device exist nowhere else. Sign in and they are committed
      automatically, so this browser stops being the only copy. Clearing site data, or losing this device, loses
      them.
    </p>
  </div>
  <div class="banner-actions">
    <button class="primary-button" type="button" onclick={onSignIn}>Sign in to protect this data</button>
    <button class="secondary-button" type="button" onclick={onDismiss}>Not now</button>
  </div>
</aside>
