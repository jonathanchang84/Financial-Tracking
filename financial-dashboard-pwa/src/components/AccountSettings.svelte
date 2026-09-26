<script>
  /** Signed-in profile controls rendered inside the existing auth modal. */
  import AccountSecrets from './AccountSecrets.svelte';
  import { changeEmail, changePassword } from '../services/account.js';
  import { session, signOut } from '../services/appClient.js';
  import { showToast } from '../stores/ui.js';

  let { user, onClose = () => {} } = $props();
  const currentEmail = $derived($session?.email || user?.email || '');

  let busy = $state('');
  let error = $state('');
  let message = $state('');
  let newEmail = $state('');
  let emailPassword = $state('');
  let currentPassword = $state('');
  let newPassword = $state('');
  let confirmPassword = $state('');

  function clearMessages() {
    error = '';
    message = '';
  }

  async function submitEmail(event) {
    event.preventDefault();
    clearMessages();
    busy = 'email';
    try {
      await changeEmail(newEmail, emailPassword);
      newEmail = '';
      emailPassword = '';
      message = 'Email address updated. Use it to sign in from now on.';
      showToast('Email address updated');
    } catch (caught) {
      error = caught.message;
    } finally {
      busy = '';
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    clearMessages();
    if (newPassword !== confirmPassword) {
      error = 'New passwords do not match.';
      return;
    }
    busy = 'password';
    try {
      await changePassword(currentPassword, newPassword);
      currentPassword = '';
      newPassword = '';
      confirmPassword = '';
      message = 'Password changed successfully.';
      showToast('Password changed');
    } catch (caught) {
      error = caught.message;
    } finally {
      busy = '';
    }
  }

  async function doSignOut() {
    busy = 'signout';
    try {
      await signOut();
      showToast('Signed out');
      onClose();
    } catch (caught) {
      error = caught.message;
    } finally {
      busy = '';
    }
  }
</script>

<div class="account-settings">
  <p class="hint">
    Signed in as <strong>{currentEmail}</strong>. Manage your profile and sign-in details below; your finance rows are isolated to your application account.
  </p>
  {#if error}<p class="error">{error}</p>{/if}
  {#if message}<p class="hint positive">{message}</p>{/if}

  <section class="account-section" aria-labelledby="email-heading">
    <div class="account-section-heading">
      <div>
        <h4 id="email-heading">Email address</h4>
        <p class="hint">Your current password is re-checked, then the address is changed. There is no confirmation email.</p>
      </div>
    </div>
    <form onsubmit={submitEmail}>
      <label>Current email
        <input type="email" value={currentEmail} readonly autocomplete="email" />
      </label>
      <label>New email
        <input type="email" bind:value={newEmail} autocomplete="email" required />
      </label>
      <label>Current password
        <input type="password" bind:value={emailPassword} autocomplete="current-password" required />
      </label>
      <div class="modal-actions">
        <button class="primary-button" type="submit" disabled={Boolean(busy)}>
          {busy === 'email' ? 'Updating…' : 'Update email address'}
        </button>
      </div>
    </form>
  </section>

  <section class="account-section" aria-labelledby="password-heading">
    <div class="account-section-heading">
      <div>
        <h4 id="password-heading">Password</h4>
        <p class="hint">Your current password is checked before the new one is saved.</p>
      </div>
    </div>
    <form onsubmit={submitPassword}>
      <label>Current password
        <input type="password" bind:value={currentPassword} autocomplete="current-password" required />
      </label>
      <label>New password
        <input type="password" bind:value={newPassword} minlength="8" autocomplete="new-password" required />
      </label>
      <label>Confirm new password
        <input type="password" bind:value={confirmPassword} minlength="8" autocomplete="new-password" required />
      </label>
      <div class="modal-actions">
        <button class="primary-button" type="submit" disabled={Boolean(busy)}>
          {busy === 'password' ? 'Changing…' : 'Change password'}
        </button>
      </div>
    </form>
  </section>

  <AccountSecrets />

  <div class="modal-actions account-footer-actions">
    <button class="secondary-button" type="button" onclick={onClose}>Close</button>
    <button class="danger-button" type="button" disabled={Boolean(busy)} onclick={doSignOut}>Sign out</button>
  </div>
</div>
