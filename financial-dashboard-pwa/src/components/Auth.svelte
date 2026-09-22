<script>
  import { fly } from 'svelte/transition';
  import { supabase } from '../services/supabaseClient.js';

  let { onClose } = $props();
  let mode = $state('login');
  let email = $state('');
  let password = $state('');
  let busy = $state(false);
  let message = $state('');
  let error = $state('');

  async function submit(ev) {
    ev.preventDefault();
    if (!supabase) { error = 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.'; return; }
    busy = true; error = ''; message = '';
    try {
      if (mode === 'signup') {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        message = data.session ? 'Account created. Signed in.' : 'Check your email to confirm your account.';
        if (data.session) onClose();
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onClose();
      }
    } catch (e) {
      error = e.message;
    } finally {
      busy = false;
    }
  }
</script>

<div class="modal-backdrop" onclick={(e) => { if (e.target === e.currentTarget) onClose(); }} transition:fly={{ duration: 160 }}>
  <section class="modal" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'Sign in' : 'Create account'}>
    <div class="section-heading">
      <div><p class="eyebrow">ACCOUNT</p><h3>{mode === 'login' ? 'Sign in' : 'Create account'}</h3></div>
      <button class="text-button" onclick={onClose}>Close</button>
    </div>
    <form onsubmit={submit}>
      <label>Email<input type="email" name="email" bind:value={email} required autocomplete="email"></label>
      <label>Password<input type="password" name="password" bind:value={password} required minlength="6" autocomplete={mode === 'login' ? 'current-password' : 'new-password'}></label>
      {#if error}<p class="error">{error}</p>{/if}
      {#if message}<p class="muted">{message}</p>{/if}
      <div class="modal-actions">
        <button type="button" class="secondary-button" onclick={() => { mode = mode === 'login' ? 'signup' : 'login'; error = ''; message = ''; }}>
          {mode === 'login' ? 'Need an account? Sign up' : 'Have an account? Sign in'}
        </button>
        <button type="submit" class="primary-button" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Sign up'}</button>
      </div>
    </form>
    <p class="muted">Sync is optional — the app stays fully functional offline without an account.</p>
  </section>
</div>
