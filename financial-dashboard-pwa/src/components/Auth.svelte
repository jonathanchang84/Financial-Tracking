<script>
  /** Supabase Auth gateway: email + password sign in / sign up, forgot/reset password, or sign out. */
  import Modal from './Modal.svelte';
  import {
    cloudEnabled,
    session,
    signIn,
    signUp,
    signOut,
    resendConfirmation,
    resetPassword,
    updatePassword,
    passwordRecovery,
    clearPasswordRecovery
  } from '../services/supabaseClient.js';
  import { showToast } from '../stores/ui.js';

  let { onClose = () => {} } = $props();

        let mode = $state('login');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');
  let needsConfirmation = $state(false);

  // Arriving from a password-recovery email link → open straight into
  // the "set new password" form (even though a temporary session exists).
  if ($passwordRecovery) mode = 'reset';

  const user = $derived($session);

  $effect(() => {
    if ($passwordRecovery) mode = 'reset';
  });

  function switchMode(next) {
    mode = next;
    error = '';
    message = '';
    needsConfirmation = false;
  }

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
          message =
            'Account created — confirmation email required. Confirm the link, then sign in (or tap resend below).';
        } else {
          needsConfirmation = false;
          showToast('Account created and signed in');
          onClose();
        }
      } else if (mode === 'forgot') {
        await resetPassword(email);
        message = 'If an account exists for that email, a reset link is on its way — check your inbox (and spam).';
        showToast('Password reset email sent');
      } else if (mode === 'reset') {
        if (password !== confirmPassword) {
          error = 'Passwords do not match.';
          busy = false;
          return;
        }
        await updatePassword(password);
        showToast('Password updated — sign in with your new password');
        switchMode('login');
      } else {
        await signIn(email, password);
        showToast('Signed in');
        onClose();
      }
    } catch (caught) {
      error = typeof caught === 'string' ? caught : caught.message;
      needsConfirmation = false;
    } finally {
      busy = false;
    }
  }

  /** Re-send the confirmation email, only relevant when Supabase email confirmation is on. */
  async function resend() {
    busy = true;
    error = '';
    message = '';
    try {
      await resendConfirmation(email);
      message = 'Confirmation email sent again — check your inbox (and spam).';
      showToast('Confirmation email re-sent');
    } catch (caught) {
      error = typeof caught === 'string' ? caught : caught.message;
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

  async function sendPasswordReset() {
    if (!user?.email) return;
    busy = true;
    error = '';
    message = '';
    try {
      await resetPassword(user.email);
      message = `Password reset instructions sent to ${user.email}. Check your inbox and spam folder.`;
      showToast('Password reset email sent');
    } catch (caught) {
      error = typeof caught === 'string' ? caught : caught.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal
  title={mode === 'reset'
    ? 'Set new password'
    : mode === 'forgot'
      ? 'Reset your password'
      : user
        ? 'Your account'
        : mode === 'login'
          ? 'Sign in'
          : 'Create account'}
  eyebrow="CLOUD ACCOUNT"
  subtitle="Sync is optional — the app stays fully functional offline without an account."
  {onClose}
>
  {#if !cloudEnabled}
    <p class="error">Supabase keys are missing from this build, so cloud sync stays off.</p>
    <p class="hint">Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file and rebuild.</p>
  {:else if mode === 'reset'}
    <p class="hint">Choose a new password for <strong>{user?.email ?? email}</strong>.</p>
    <form onsubmit={submit}>
      <label>New password
        <input
          type="password"
          bind:value={password}
          minlength="6"
          autocomplete="new-password"
          required
        />
      </label>
      <label>Confirm new password
        <input
          type="password"
          bind:value={confirmPassword}
          minlength="6"
          autocomplete="new-password"
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
            clearPasswordRecovery();
            switchMode('login');
          }}
        >
          Back to sign in
        </button>
        <button class="primary-button" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </div>
    </form>
  {:else if user}
    <p class="hint">Signed in as <strong>{user.email}</strong></p>
    <p class="hint">Rows are stored with owner_id = {user.id.slice(0, 8)}… and protected by row level security.</p>
    {#if error}<p class="error">{error}</p>{/if}
    {#if message}<p class="hint">{message}</p>{/if}
    <div class="modal-actions">
      <button class="secondary-button" type="button" onclick={onClose}>Close</button>
      <button class="secondary-button" type="button" disabled={busy} onclick={sendPasswordReset}>Reset password</button>
      <button class="danger-button" type="button" disabled={busy} onclick={doSignOut}>Sign out</button>
    </div>
  {:else}
    <form onsubmit={submit}>
      <label>Email
        <input type="email" bind:value={email} autocomplete="email" required />
      </label>
      {#if mode !== 'forgot'}
      <label>Password
        <input
          type="password"
          bind:value={password}
          minlength="6"
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </label>
      {/if}
        {#if error}<p class="error">{error}</p>{/if}
        {#if message}<p class="hint">{message}</p>{/if}
        {#if mode === 'signup' && needsConfirmation && email}
          <div class="modal-actions">
            <button class="secondary-button" type="button" disabled={busy} onclick={resend}>
              Resend confirmation email
            </button>
          </div>
        {/if}
      <div class="modal-actions">
        {#if mode === 'login'}
          <button class="secondary-button" type="button" onclick={() => switchMode('signup')}>
            Need an account? Sign up
          </button>
          <button
            class="secondary-button"
            type="button"
            style="opacity:.75"
            onclick={() => switchMode('forgot')}
          >
            Forgot password?
          </button>
        {:else if mode === 'signup'}
          <button class="secondary-button" type="button" onclick={() => switchMode('login')}>
            Have an account? Sign in
          </button>
        {:else}
          <!-- forgot mode -->
          <button class="secondary-button" type="button" onclick={() => switchMode('login')}>
            Back to sign in
          </button>
        {/if}
        <button class="primary-button" type="submit" disabled={busy}>
          {mode === 'login' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Sign up'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
