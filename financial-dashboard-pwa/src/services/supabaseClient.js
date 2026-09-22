import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Official Supabase client. When env vars are absent the app runs fully
 * offline/local-only (IndexedDB) and cloud sync is silently disabled.
 */
export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export const cloudEnabled = Boolean(supabase);

export async function getSessionUser() {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data?.session?.user ?? null;
}

export async function signIn(email, password) {
  if (!supabase) throw new Error('Cloud sync not configured');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signUp(email, password) {
  if (!supabase) throw new Error('Cloud sync not configured');
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  return data.user;
}

export async function signOut() {
  if (!supabase) return;
  await supabase.auth.signOut();
}
