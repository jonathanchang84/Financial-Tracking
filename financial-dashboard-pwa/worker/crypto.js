/** Small Web Crypto helpers shared by the Worker and Node tests. */
const encoder = new TextEncoder();
// Cloudflare's WebCrypto caps PBKDF2 at 100,000 iterations. Requesting more
// throws `iteration counts above 100000 are not supported`, so the Worker
// hashes at the ceiling and leans on the per-user salt plus AUTH_PEPPER.
// The browser-side secret-answer hash (src/services/accountSecretCrypto.js)
// is not bound by this limit and still uses 310,000.
export const PASSWORD_ITERATIONS = 100_000;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 100_000;
const PASSWORD_KEY_BITS = 256;

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle || !api.getRandomValues) throw new Error('Secure Web Crypto is unavailable.');
  return api;
}

export function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32) {
  return bytesToBase64Url(cryptoApi().getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(value) {
  const digest = await cryptoApi().subtle.digest('SHA-256', encoder.encode(String(value)));
  return bytesToBase64Url(new Uint8Array(digest));
}

export function normalizeEmail(value) {
  return String(value ?? '').normalize('NFKC').trim().toLowerCase();
}

export function isValidEmail(value) {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function validatePassword(value) {
  const password = String(value ?? '');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (password.length > 512) throw new Error('Password is too long.');
  return password;
}

/** Fail fast on counts this runtime cannot derive, rather than deep in WebCrypto. */
function assertIterations(iterations) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new Error(`Unsupported password hash settings: this runtime only allows ${MIN_ITERATIONS}-${MAX_ITERATIONS} PBKDF2 iterations.`);
  }
}

async function derivePassword(password, salt, iterations, pepper = '') {
  const api = cryptoApi();
  const key = await api.subtle.importKey('raw', encoder.encode(`${password}${pepper}`), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, PASSWORD_KEY_BITS);
  return new Uint8Array(bits);
}

export async function hashPassword(password, { salt, iterations = PASSWORD_ITERATIONS, pepper = '' } = {}) {
  validatePassword(password);
  assertIterations(iterations);
  const saltBytes = salt ? base64UrlToBytes(salt) : cryptoApi().getRandomValues(new Uint8Array(16));
  if (saltBytes.length < 16) throw new Error('The stored password salt is invalid.');
  const digest = await derivePassword(String(password), saltBytes, iterations, pepper);
  return { algorithm: 'PBKDF2-SHA-256', iterations, salt: bytesToBase64Url(saltBytes), password_hash: bytesToBase64Url(digest) };
}

export function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function verifyPassword(password, stored, { pepper = '' } = {}) {
  if (!stored || stored.algorithm !== 'PBKDF2-SHA-256') return false;
  const iterations = Number(stored.iterations);
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) return false;
  try {
    const expected = base64UrlToBytes(stored.password_hash);
    const actual = await derivePassword(String(password), base64UrlToBytes(stored.salt), iterations, pepper);
    return constantTimeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function publicUser(row) {
  if (!row) return null;
  return { id: String(row.id), email: String(row.email), createdAt: row.created_at || null };
}
