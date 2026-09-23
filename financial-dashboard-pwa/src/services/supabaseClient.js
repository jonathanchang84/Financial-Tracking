/**
 * Official Supabase client + auth state.
 *
 * The anon/publishable key is safe in the browser bundle: every table is
 * protected by RLS policies that require `owner_id = auth.uid()`.
 * When the env vars are absent the app runs fully local (IndexedDB only) and
 * every cloud call short-circuits, so nothing throws offline.
 */

import { createClient } from '@supabase/supabase-js';
import { writable, get } from 'svelte/store';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true,
          storageKey: 'financial-health-auth'
        },
        global: { headers: { 'x-application-name': 'financial-dashboard-pwa' } }
      })
    : null;

export const cloudEnabled = Boolean(supabase);
export const cloudTarget = url || '';

/** Signed-in Supabase user, or `null` when running anonymously. */
export const session = writable(null);
export const authReady = writable(false);
export const authError = writable('');

export function currentUser() {
  return get(session);
}

export async function restoreSession() {
  if (!supabase) {
    authReady.set(true);
    return null;
  }
  try {
    const { data } = await supabase.auth.getSession();
    session.set(data?.session?.user ?? null);
  } catch {
    session.set(null);
  } finally {
    authReady.set(true);
  }
  return get(session);
}

export async function getSessionUser() {
  const cached = get(session);
  if (cached) return cached;
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user ?? null;
  session.set(user);
  return user;
}

/** True when the browser has a real Supabase config and the session is confirmed. */
export function hasConfirmedSession() {
  const user = get(session);
  if (!supabase || !user) return false;
  // Supabase Auth marks confirmed users explicitly.
  return Boolean(user.email_confirmed_at || user.confirmed_at);
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Cloud sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw friendlyAuthError(error);
  session.set(data.user ?? null);
  return data.user;
}

export async function signUp(email, password) {
  if (!supabase) throw new Error('Cloud sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw friendlyAuthError(error);
  // With email confirmation ON, data.session is null and the user must
  // click the emailed link before signing in. With confirmation OFF (the
  // app's intended setup), data.session exists and they are signed in
  // immediately — no email round-trip, no send limits, unlimited users.
  session.set(data.session?.user ?? null);
  return { user: data.user, needsConfirmation: !data.session };
}

/** Re-send the sign-up confirmation email (only used when confirmation is on). */
export async function resendConfirmation(email) {
  if (!supabase) throw new Error('Cloud sync is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  const { error } = await supabase.auth.resend({ type: 'signup', email });
  if (error) throw friendlyAuthError(error);
}

/**
 * Translate Supabase Auth errors into end-user copy. With email
 * confirmation disabled in Supabase (the app's default posture) these
 * paths are rare — they only surface if the project re-enables
 * confirmation or hits broader auth rate limits.
 */
export function friendlyAuthError(error) {
  const message = String(error?.message || error || '');
  const status = Number(error?.status ?? error?.code ?? 0);
  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    return 'Too many attempts in a short time — please wait a minute and try again.';
  }
  // Supabase project setting: "Allow new users to sign up" is switched off.
  if (/signups? not allowed|signups? are not allowed|not allowed to sign up/i.test(message)) {
    return 'New account sign-ups are currently disabled for this app. Please contact the app owner to get an invite.';
  }
  if (/not authorized/i.test(message)) {
    return 'This email address cannot be used to sign up right now. Please contact the app owner.';
  }
  if (/already registered|already been registered/i.test(message)) {
    return 'An account with this email already exists — switch to "Sign in".';
  }
  if (/invalid login credentials/i.test(message)) {
    return 'Email or password is incorrect.';
  }
  if (/password should be at least/i.test(message)) {
    return 'Password must be at least 6 characters.';
  }
  return message;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
  session.set(null);
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function onAuthChange(handler) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, next) => {
    session.set(next?.user ?? null);
    authReady.set(true);
    handler?.(event, next?.user ?? null);
  });
  return () => data?.subscription?.unsubscribe?.();
}
