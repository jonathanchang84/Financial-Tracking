<script>
  /** Supabase Auth gateway: email + password sign in / sign up, or sign out. */
  import Modal from './Modal.svelte';
  import { cloudEnabled, session, signIn, signUp, signOut } from '../services/supabaseClient.js';
  import { showToast } from '../stores/ui.js';

  let { onClose = () => {} } = $props();

        let mode = $state('login');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');
  let needsConfirmation = $state(false);

  const user = $derived($session);

  async function submit(event) {
    event.preventDefault();
    if (!cloudEnabled) {
      error = 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.';
      return;
    }
    busy = true;
    error = '';
    message = '';
        try {
      if (mode === 'signup') {
        const result = await signUp(email, password);
        if (result.needsConfirmation) {
          needsConfirmation = true;
          message = 'Account created — check your email to confirm your address, then sign in.';
        } else {
          needsConfirmation = false;
          showToast('Account created and signed in');
          onClose();
        }
      } else {
        await signIn(email, password);
        showToast('Signed in');
        onClose();
      }
    } catch (caught) {
      error = caught.message;
      needsConfirmation = false;
    } finally {
      busy = false;
    }
  }

  async function doSignOut() {
    busy = true;
    try {
      await signOut();
      showToast('Signed out');
      onClose();
    } finally {
      busy = false;
    }
  }
</script>

<Modal
  title={user ? 'Your account' : mode === 'login' ? 'Sign in' : 'Create account'}
  eyebrow="CLOUD ACCOUNT"
  subtitle="Sync is optional — the app stays fully functional offline without an account."
  {onClose}
>
  {#if !cloudEnabled}
    <p class="error">Supabase keys are missing from this build, so cloud sync stays off.</p>
    <p class="hint">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file and rebuild.</p>
  {:else if user}
    <p class="hint">Signed in as <strong>{user.email}</strong></p>
    <p class="hint">Rows are stored with owner_id = {user.id.slice(0, 8)}… and protected by row level security.</p>
    <div class="modal-actions">
      <button class="secondary-button" type="button" onclick={onClose}>Close</button>
      <button class="danger-button" type="button" disabled={busy} onclick={doSignOut}>Sign out</button>
    </div>
  {:else}
    <form onsubmit={submit}>
      <label>Email
        <input type="email" bind:value={email} autocomplete="email" required />
      </label>
      <label>Password
        <input
          type="password"
          bind:value={password}
          minlength="6"
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      {#if message}<p class="hint">{message}</p>{/if}
      <div class="modal-actions">
        <button
          class="secondary-button"
          type="button"
          onclick={() => {
            mode = mode === 'login' ? 'signup' : 'login';
            error = '';
            message = '';
          }}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        <button class="primary-button" type="submit" disabled={busy}>
          {mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
