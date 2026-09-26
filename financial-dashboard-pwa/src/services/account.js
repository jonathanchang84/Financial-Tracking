/** Application-owned account operations. Secret answers are hashed in the browser
 * before only their digest and verification metadata are sent to the Worker. */
import { apiRequest, getSessionUser, session } from './appClient.js';
import { friendlyAuthError } from './authErrors.js';
import { newId } from './recordHelpers.js';
import { hashRecoveryAnswer, validateRecoverySecret } from './accountSecretCrypto.js';

function cleanEmail(value) { return String(value || '').trim().toLowerCase(); }

async function requireUser() {
  const user = await getSessionUser();
  if (!user) throw new Error('Sign in to manage your account.');
  return user;
}

function accountError(error) {
  if (error?.status === 401) return 'Your session has expired. Sign in again and retry.';
  if (/already exists|secret_exists|UNIQUE|constraint/i.test(String(error?.message || error))) {
    return 'A secret answer with that question already exists.';
  }
  return friendlyAuthError(error);
}

export async function changePassword(currentPassword, newPassword) {
  await requireUser();
  if (!currentPassword) throw new Error('Enter your current password.');
  if (!newPassword || newPassword.length < 8) throw new Error('New password must be at least 8 characters.');
  const result = await apiRequest('/api/auth/change-password', {
    method: 'POST',
    body: { currentPassword, newPassword }
  });
  if (result.user) session.set(result.user);
  return result.user || getSessionUser();
}

export async function changeEmail(newEmail, currentPassword) {
  const user = await requireUser();
  const email = cleanEmail(newEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid email address.');
  if (email === cleanEmail(user.email)) throw new Error('The new email address is the same as the current one.');
  if (!currentPassword) throw new Error('Enter your current password to confirm the change.');
  // No confirmation email exists, so the current password is the re-authentication.
  const result = await apiRequest('/api/auth/change-email', { method: 'POST', body: { email, currentPassword } });
  if (result.user) session.set(result.user);
  return result;
}

export async function listAccountSecrets() {
  await requireUser();
  const result = await apiRequest('/api/auth/account-secrets');
  return result.secrets || [];
}

export async function saveAccountSecret({ id = '', question = '', answer = '' } = {}) {
  await requireUser();
  const values = validateRecoverySecret(question, answer);
  const digest = await hashRecoveryAnswer(values.answer);
  const payload = { question: values.question, ...digest };
  if (id) return (await apiRequest(`/api/auth/account-secrets/${encodeURIComponent(id)}`, { method: 'PUT', body: payload })).secret;
  return (await apiRequest('/api/auth/account-secrets', { method: 'POST', body: { ...payload, id: newId() } })).secret;
}

export async function deleteAccountSecret(id) {
  await requireUser();
  await apiRequest(`/api/auth/account-secrets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function verifyAccountSecret(id, answer, stored = null) {
  await requireUser();
  const metadata = stored || (await listAccountSecrets()).find((secret) => secret.id === id);
  if (!metadata?.salt || !metadata?.iterations) return false;
  const digest = await hashRecoveryAnswer(answer, { salt: metadata.salt, iterations: Number(metadata.iterations) });
  const result = await apiRequest(`/api/auth/account-secrets/${encodeURIComponent(id)}/verify`, {
    method: 'POST', body: { answer_hash: digest.answer_hash }
  });
  return Boolean(result.verified);
}
