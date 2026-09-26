/**
 * Secret-answer hashing helpers.
 *
 * Secret answers are never persisted as plaintext. The browser normalizes
 * each answer, derives a PBKDF2 key using a fresh random salt, and uploads only
 * the digest plus the parameters needed to verify it later.
 */

export const RECOVERY_HASH_ALGORITHM = 'PBKDF2-SHA-256';
export const RECOVERY_HASH_ITERATIONS = 310_000;

const SALT_BYTES = 16;
const KEY_BITS = 256;
const MIN_ITERATIONS = 100_000;
const MAX_ITERATIONS = 1_000_000;
const encoder = new TextEncoder();

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle || !api.getRandomValues) {
    throw new Error('Secure browser cryptography is unavailable. Open the app over HTTPS and try again.');
  }
  return api;
}

/** Case/whitespace-insensitive normalization for human-entered answers. */
export function normalizeRecoveryAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function normalizeRecoveryQuestion(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ');
}

export function validateRecoverySecret(question, answer) {
  const normalizedQuestion = normalizeRecoveryQuestion(question);
  const normalizedAnswer = normalizeRecoveryAnswer(answer);
  if (!normalizedQuestion) throw new Error('Enter a secret question.');
  if (normalizedQuestion.length > 200) throw new Error('Secret questions must be 200 characters or fewer.');
  if (!normalizedAnswer) throw new Error('Enter a secret answer.');
  if (normalizedAnswer.length > 500) throw new Error('Secret answers must be 500 characters or fewer.');
  return { question: normalizedQuestion, answer: normalizedAnswer };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64ToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = globalThis.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function validIterations(iterations) {
  return Number.isInteger(iterations) && iterations >= MIN_ITERATIONS && iterations <= MAX_ITERATIONS;
}

async function deriveAnswer(answer, salt, iterations) {
  const api = cryptoApi();
  const key = await api.subtle.importKey('raw', encoder.encode(answer), 'PBKDF2', false, ['deriveBits']);
  const bits = await api.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS
  );
  return new Uint8Array(bits);
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

/** Create a salted, non-reversible digest suitable for account_secrets. */
export async function hashRecoveryAnswer(answer, { salt, iterations = RECOVERY_HASH_ITERATIONS } = {}) {
  const normalized = normalizeRecoveryAnswer(answer);
  if (!normalized) throw new Error('Enter a secret answer.');
  if (!validIterations(iterations)) throw new Error('Unsupported secret-answer hash settings.');

  const saltBytes = salt ? base64ToBytes(salt) : cryptoApi().getRandomValues(new Uint8Array(SALT_BYTES));
  if (saltBytes.length < SALT_BYTES) throw new Error('The saved secret-answer salt is invalid.');
  const digest = await deriveAnswer(normalized, saltBytes, iterations);
  return {
    algorithm: RECOVERY_HASH_ALGORITHM,
    iterations,
    salt: bytesToBase64(saltBytes),
    answer_hash: bytesToBase64(digest)
  };
}

/** Verify an answer without sending or storing its plaintext value. */
export async function verifyRecoveryAnswer(answer, stored) {
  if (!stored || stored.algorithm !== RECOVERY_HASH_ALGORITHM) return false;
  if (!validIterations(Number(stored.iterations))) return false;
  const candidate = await hashRecoveryAnswer(answer, { salt: stored.salt, iterations: Number(stored.iterations) });
  return constantTimeEqual(base64ToBytes(candidate.answer_hash), base64ToBytes(stored.answer_hash));
}
