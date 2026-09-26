<script>
  /** Owner-scoped secret answers. Only questions and timestamps are displayed. */
  import { onMount } from 'svelte';
  import {
    deleteAccountSecret,
    listAccountSecrets,
    saveAccountSecret,
    verifyAccountSecret
  } from '../services/account.js';
  import { showToast } from '../stores/ui.js';

  let secrets = $state([]);
  let loading = $state(true);
  let busy = $state('');
  let formError = $state('');
  let formMessage = $state('');
  let question = $state('');
  let answer = $state('');
  let answerConfirmation = $state('');
  let editingId = $state('');

  let verifyId = $state('');
  let verifyAnswer = $state('');
  let verifyError = $state('');
  let verifyMessage = $state('');

  onMount(() => {
    loadSecrets();
  });

  async function loadSecrets() {
    loading = true;
    formError = '';
    try {
      secrets = await listAccountSecrets();
    } catch (error) {
      formError = error.message;
    } finally {
      loading = false;
    }
  }

  function resetForm() {
    question = '';
    answer = '';
    answerConfirmation = '';
    editingId = '';
    formError = '';
    formMessage = '';
  }

  function editSecret(secret) {
    editingId = secret.id;
    question = secret.question;
    answer = '';
    answerConfirmation = '';
    formError = '';
    formMessage = '';
  }

  async function submitSecret(event) {
    event.preventDefault();
    formError = '';
    formMessage = '';
    if (answer !== answerConfirmation) {
      formError = 'Secret answers do not match.';
      return;
    }

    const wasEditing = Boolean(editingId);
    busy = wasEditing ? 'replace' : 'add';
    try {
      const saved = await saveAccountSecret({ id: editingId, question, answer });
      resetForm();
      secrets = await listAccountSecrets();
      formMessage = wasEditing
        ? `Secret answer changed for “${saved.question}”.`
        : `Secret answer added for “${saved.question}”.`;
      showToast(wasEditing ? 'Secret answer changed' : 'Secret answer added');
    } catch (error) {
      formError = error.message;
    } finally {
      busy = '';
    }
  }

  async function removeSecret(secret) {
    if (!window.confirm(`Delete the secret answer for “${secret.question}”? This cannot be undone.`)) return;
    busy = `delete:${secret.id}`;
    formError = '';
    try {
      await deleteAccountSecret(secret.id);
      secrets = secrets.filter((item) => item.id !== secret.id);
      if (editingId === secret.id) resetForm();
      showToast('Secret answer deleted');
    } catch (error) {
      formError = error.message;
    } finally {
      busy = '';
    }
  }

  function startVerify(secret) {
    verifyId = secret.id;
    verifyAnswer = '';
    verifyError = '';
    verifyMessage = '';
  }

  function cancelVerify() {
    verifyId = '';
    verifyAnswer = '';
    verifyError = '';
    verifyMessage = '';
  }

  async function submitVerification(event, secret) {
    event.preventDefault();
    verifyError = '';
    verifyMessage = '';
    busy = `verify:${secret.id}`;
    try {
      const matches = await verifyAccountSecret(secret.id, verifyAnswer, secret);
      if (matches) {
        verifyMessage = `Secret answer verified for “${secret.question}”.`;
        verifyAnswer = '';
      } else {
        verifyError = 'That answer does not match.';
      }
    } catch (error) {
      verifyError = error.message;
    } finally {
      busy = '';
    }
  }

  function formatDate(value) {
    if (!value) return '';
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
  }
</script>
<section class="account-section" aria-labelledby="secret-answers-heading">
  <div class="account-section-heading">
    <div>
      <h4 id="secret-answers-heading">Secret answers</h4>
      <p class="hint">Add personal security answers for your profile. Answers are hashed in this browser before upload.</p>
    </div>
    <button class="text-button" type="button" onclick={loadSecrets} disabled={Boolean(busy)}>Refresh</button>
  </div>

  <p class="hint security-note">
    Your secret answers can be verified but can never be displayed or recovered. They are not encryption: a database breach could allow guessing of low-entropy answers. They are not included in local backups or finance sync, and email reset remains the way to regain access.
  </p>

  {#if formError}<p class="error">{formError}</p>{/if}
  {#if formMessage}<p class="hint positive">{formMessage}</p>{/if}

  {#if loading}
    <p class="hint">Loading secret answers…</p>
  {:else if secrets.length}
    <div class="account-secret-list">
      {#each secrets as secret (secret.id)}
        <div class="account-secret">
          <div class="account-secret-summary">
            <div>
              <strong>{secret.question}</strong>
              <small>Added {formatDate(secret.created_at)}</small>
            </div>
            <div class="button-row">
              <button class="text-button" type="button" onclick={() => startVerify(secret)}>Verify</button>
              <button class="text-button" type="button" onclick={() => editSecret(secret)}>Change</button>
              <button
                class="text-button danger"
                type="button"
                disabled={Boolean(busy)}
                onclick={() => removeSecret(secret)}
              >Delete</button>
            </div>
          </div>

          {#if verifyId === secret.id}
            <form class="account-inline-form" onsubmit={(event) => submitVerification(event, secret)}>
              <label>Answer to verify
                <input type="password" bind:value={verifyAnswer} autocomplete="off" required />
              </label>
              <div class="modal-actions">
                <button class="secondary-button" type="button" onclick={cancelVerify}>Cancel</button>
                <button class="primary-button" type="submit" disabled={busy === `verify:${secret.id}`}>
                  {busy === `verify:${secret.id}` ? 'Checking…' : 'Check answer'}
                </button>
              </div>
              {#if verifyError}<p class="error">{verifyError}</p>{/if}
              {#if verifyMessage}<p class="hint positive">{verifyMessage}</p>{/if}
            </form>
          {/if}
        </div>
      {/each}
    </div>
  {:else}
    <p class="hint">No secret answers saved yet. Add one using the form below.</p>
  {/if}

  <form class="account-secret-form" onsubmit={submitSecret}>
    <h4>{editingId ? 'Change secret answer' : 'Add secret answer'}</h4>
    <label>Secret question
      <input
        type="text"
        bind:value={question}
        maxlength="200"
        placeholder="Mother’s maiden name"
        autocomplete="off"
        required
      />
    </label>
    <label>Secret answer
      <input type="password" bind:value={answer} maxlength="500" autocomplete="off" required />
    </label>
    <label>Confirm secret answer
      <input type="password" bind:value={answerConfirmation} maxlength="500" autocomplete="off" required />
    </label>
    <div class="modal-actions">
      {#if editingId}<button class="secondary-button" type="button" onclick={resetForm}>Cancel</button>{/if}
      <button class="primary-button" type="submit" disabled={Boolean(busy)}>
        {busy === 'add' || busy === 'replace' ? 'Saving…' : editingId ? 'Save changes' : 'Add answer'}
      </button>
    </div>
  </form>
</section>

