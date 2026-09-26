import { writable, get } from 'svelte/store';
import { friendlyAuthError } from './authErrors.js';

const apiBase = String(import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');
const browserOrigin = typeof window === 'undefined' ? '' : window.location.origin;

export const session = writable(null);
export const authReady = writable(false);
export const authError = writable('');
export const cloudEnabled = Boolean(apiBase || (import.meta.env.PROD && browserOrigin && browserOrigin !== 'null'));
export const cloudTarget = apiBase || browserOrigin;

const authListeners = new Set();

export class ApiError extends Error {
  constructor(message, { status = 0, code = '' } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

function emit(event, user) {
  for (const listener of authListeners) {
    try { listener(event, user || null); } catch { /* a UI listener must not break auth state */ }
  }
}

function setSession(user) {
  const next = user || null;
  session.set(next);
  emit('SESSION_CHANGED', next);
}

function apiUrl(path) { return `${apiBase}${path}`; }

export async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');
  let body = options.body;
  if (body && typeof body !== 'string' && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(apiUrl(path), { ...options, body, headers, credentials: 'include' });
  } catch {
    throw new ApiError('The application service is unavailable. Check your connection and try again.', { code: 'service_unavailable' });
  }
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = {}; }
  }
  if (!response.ok) {
    const code = payload.code || payload.error || '';
    throw new ApiError(friendlyAuthError({ ...payload, code, status: response.status }), { status: response.status, code });
  }
  return payload;
}

export function currentUser() { return get(session); }

export async function restoreSession() {
  try {
    const result = await apiRequest('/api/auth/session');
    setSession(result.user);
  } catch (error) {
    if (error?.status !== 401) authError.set(friendlyAuthError(error));
    setSession(null);
  } finally {
    authReady.set(true);
  }
  return get(session);
}


export async function getSessionUser() {
  const cached = get(session);
  if (cached) return cached;
  try {
    const result = await apiRequest('/api/auth/session');
    setSession(result.user);
    return result.user;
  } catch (error) {
    if (error?.status !== 401) authError.set(friendlyAuthError(error));
    setSession(null);
    return null;
  }
}

export async function signIn(email, password) { const result = await apiRequest('/api/auth/signin', { method: 'POST', body: { email, password } }); setSession(result.user); return result.user; }
/** Sign-up returns a usable, already-signed-in account; there is nothing to confirm. */
export async function signUp(email, password) {
  const result = await apiRequest('/api/auth/signup', { method: 'POST', body: { email, password } });
  setSession(result.user);
  return { user: result.user || null };
}

/**
 * Step one of recovery: which secret answers may be used for this address.
 * The server answers the same way for unknown addresses, so this cannot be used
 * to discover which email addresses have an account.
 */
export async function recoveryQuestions(email) {
  const result = await apiRequest('/api/auth/recovery-questions', { method: 'POST', body: { email } });
  return result.questions || [];
}

/**
 * Step two: prove one secret answer. On success the server signs this device in
 * and returns a single-use token that authorises setting a new password.
 */
export async function recover(email, secretId, answerHash) {
  const result = await apiRequest('/api/auth/recover', { method: 'POST', body: { email, secretId, answer_hash: answerHash } });
  setSession(result.user);
  return result.recoveryToken || '';
}

/** Consume a recovery grant. The server revokes every session, including this one. */
export async function resetPassword(token, password) {
  await apiRequest('/api/auth/reset-password', { method: 'POST', body: { token, password } });
  setSession(null);
  return { ok: true };
}

export async function signOut() {
  try { await apiRequest('/api/auth/logout', { method: 'POST' }); } finally { setSession(null); }
}

export function onAuthChange(handler) { authListeners.add(handler); return () => authListeners.delete(handler); }

