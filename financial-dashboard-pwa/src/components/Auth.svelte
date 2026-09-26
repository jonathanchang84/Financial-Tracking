<script>
  /**
   * Application-owned authentication: sign in, sign up, and password recovery.
   *
   * Every flow completes in-session. There is no email delivery anywhere, so
   * nothing waits on an inbox: signing up creates a usable account immediately,
   * and recovery proves identity with a secret answer the user already saved.
   */
  import Modal from './Modal.svelte';
  import AccountSettings from './AccountSettings.svelte';
  import {
    cloudEnabled,
    session,
    signIn,
    signUp,
    recoveryQuestions,
    recover,
    resetPassword
  } from '../services/appClient.js';
  import { hashRecoveryAnswer } from '../services/accountSecretCrypto.js';
  import { showToast } from '../stores/ui.js';

  let { onClose = () => {} } = $props();

  /** 'login' | 'signup' | 'recover' (choose question) | 'reset' (choose password) */
  let mode = $state('login');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let secretAnswer = $state('');
  let questions = $state([]);
  /** The question object the user selected, or null before they choose one. */
  let chosen = $state(null);
  let recoveryToken = $state('');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  const user = $derived($session);

  function switchMode(next) {
    mode = next;
    error = '';
    message = '';
    if (next !== 'recover') {
      questions = [];
      chosen = null;
      secretAnswer = '';
    }
    if (next !== 'reset') recoveryToken = '';
  }

  async function submit(event) {
    event.preventDefault();
    if (!cloudEnabled) {
      error = 'The application API is not configured. Set VITE_API_URL or deploy the Cloudflare Worker.';
      return;
    }
    error = '';
    message = '';
    busy = true;
    try {
      if (mode === 'signup') {
        await signUp(email, password);
        showToast('Account created and signed in');
        onClose();
        return;
      }

      if (mode === 'login') {
        await signIn(email, password);
        showToast('Signed in');
        onClose();
        return;
      }

      if (mode === 'recover') {
        if (!chosen) {
          error = 'Choose which secret answer you want to use.';
          return;
        }
        // Only the derived digest is sent; the answer itself never leaves the browser.
        const digest = await hashRecoveryAnswer(secretAnswer, { salt: chosen.salt, iterations: 310000 });
        recoveryToken = await recover(email, chosen.id, digest.answer_hash);
        password = '';
        confirmPassword = '';
        secretAnswer = '';
        mode = 'reset';
        message = 'That answer was accepted. Choose a new password.';
        return;
      }

      if (mode === 'reset') {
        if (password !== confirmPassword) {
          error = 'Passwords do not match.';
          return;
        }
        await resetPassword(recoveryToken, password);
        password = '';
        recoveryToken = '';
        showToast('Password updated — sign in with your new password');
        mode = 'login';
        message = 'Password updated. Sign in with your new password.';
      }
    } catch (caught) {
      error = typeof caught === 'string' ? caught : caught.message;
    } finally {
      busy = false;
    }
  }

  /** Load the secret questions this address may recover with. */
  async function loadQuestions() {
    if (!email) {
      error = 'Enter the email address on the account first.';
      return;
    }
    error = '';
    message = '';
    busy = true;
    try {
      questions = await recoveryQuestions(email);
      if (!questions.length) error = 'No recovery questions are available for that address.';
    } catch (caught) {
      error = caught.message;
    } finally {
      busy = false;
    }
  }
</script>

<Modal
  title={user
    ? 'Your profile'
    : mode === 'login'
      ? 'Sign in'
      : mode === 'signup'
        ? 'Create account'
        : mode === 'recover'
          ? 'Recover your account'
          : 'Set a new password'}
  eyebrow={user ? 'CLOUD PROFILE' : 'CLOUD ACCOUNT'}
  subtitle={user
    ? 'Manage your profile, sign-in details, and secret answers.'
    : 'Sync is optional — the app stays fully functional offline without an account.'}
  {onClose}
>
  {#if !cloudEnabled}
    <p class="error">The application API is not configured, so accounts and cloud sync are unavailable.</p>
    <p class="hint">Set VITE_API_URL for a separate API origin, or deploy the Cloudflare Worker alongside this site.</p>
  {:else if user}
    <AccountSettings {user} {onClose} />
  {:else if mode === 'reset'}
    <p class="hint">Choose a new password for <strong>{email}</strong>. This signs out every other session.</p>
    <form onsubmit={submit}>
      <label>New password
        <input type="password" bind:value={password} minlength="8" autocomplete="new-password" required />
      </label>
      <label>Confirm new password
        <input type="password" bind:value={confirmPassword} minlength="8" autocomplete="new-password" required />
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      {#if message}<p class="hint positive">{message}</p>{/if}
      <div class="modal-actions">
        <button class="secondary-button" type="button" onclick={() => switchMode('login')}>Back to sign in</button>
        <button class="primary-button" type="submit" disabled={busy}>
          {busy ? 'Saving…' : 'Save new password'}
        </button>
      </div>
    </form>
  {:else if mode === 'recover'}
    <p class="hint">
      Recovery uses a secret answer you saved, so it works without email. If you never added one, this
      cannot recover the account — add at least one from Profile.
    </p>
    <label>Email
      <input type="email" bind:value={email} autocomplete="email" required />
    </label>
    <div class="modal-actions">
      <button class="secondary-button" type="button" disabled={busy} onclick={loadQuestions}>
        {busy ? 'Checking…' : 'Find my secret questions'}
      </button>
    </div>

    {#if questions.length}
      <div class="panel" style="margin-top:12px">
        {#each questions as item (item.salt)}
          <label class="radio-row">
            <input
              type="radio"
              name="question"
              checked={chosen?.salt === item.salt}
              onchange={() => (chosen = item)}
            />
            <span>{item.question}</span>
          </label>
        {/each}
      </div>
    {/if}

    {#if chosen}
      <form onsubmit={submit}>
        <label>Answer to “{chosen.question}”
          <input type="password" bind:value={secretAnswer} autocomplete="off" required />
        </label>
        {#if error}<p class="error">{error}</p>{/if}
        {#if message}<p class="hint positive">{message}</p>{/if}
        <div class="modal-actions">
          <button class="secondary-button" type="button" onclick={() => switchMode('login')}>Back to sign in</button>
          <button class="primary-button" type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
        </div>
      </form>
    {:else if !error}
      {#if message}<p class="hint positive">{message}</p>{/if}
    {/if}
  {:else}
    <form onsubmit={submit}>
      <label>Email
        <input type="email" bind:value={email} autocomplete="email" required />
      </label>
      <label>Password
        <input
          type="password"
          bind:value={password}
          minlength="8"
          autocomplete={mode === 'login' ? 'current-password' : 'new-password'}
          required
        />
      </label>
      {#if error}<p class="error">{error}</p>{/if}
      {#if message}<p class="hint positive">{message}</p>{/if}
      <div class="modal-actions">
        {#if mode === 'login'}
          <button class="secondary-button" type="button" onclick={() => switchMode('signup')}>
            Need an account? Sign up
          </button>
          <button class="secondary-button" type="button" style="opacity:.75" onclick={() => switchMode('recover')}>
            Forgot password?
          </button>
        {:else}
          <button class="secondary-button" type="button" onclick={() => switchMode('login')}>
            Have an account? Sign in
          </button>
        {/if}
        <button class="primary-button" type="submit" disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
      </div>
    </form>
  {/if}
</Modal>
