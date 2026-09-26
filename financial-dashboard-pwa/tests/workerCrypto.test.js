import test from 'node:test';
import assert from 'node:assert/strict';

import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  publicUser,
  randomToken,
  sha256,
  validatePassword,
  verifyPassword
} from '../worker/crypto.js';

const PEPPER = 'a'.repeat(48);
const OPTIONS = { iterations: 100_000, pepper: PEPPER };

test('hashes a password with the configured pepper and verifies it', async () => {
  const stored = await hashPassword('correct horse battery', OPTIONS);
  assert.equal(stored.algorithm, 'PBKDF2-SHA-256');
  assert.equal(stored.iterations, 100_000);
  assert.equal(base64UrlToBytes(stored.password_hash).length, 32);
  assert.equal(await verifyPassword('correct horse battery', stored, { pepper: PEPPER }), true);
  assert.equal(await verifyPassword('wrong password entirely', stored, { pepper: PEPPER }), false);
});

test('rejects a stored password hash when the pepper does not match', async () => {
  const stored = await hashPassword('pepper sensitive value', OPTIONS);
  assert.equal(await verifyPassword('pepper sensitive value', stored, { pepper: 'b'.repeat(48) }), false);
});

test('uses a fresh salt for every password hash', async () => {
  const first = await hashPassword('same password here', OPTIONS);
  const second = await hashPassword('same password here', OPTIONS);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.password_hash, second.password_hash);
});

test('never stores the plaintext password', async () => {
  const stored = await hashPassword('plaintext should vanish', OPTIONS);
  const serialized = JSON.stringify(stored);
  assert.equal(serialized.includes('plaintext should vanish'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(stored, 'password'), false);
});

test('normalizes and validates email addresses', () => {
  assert.equal(normalizeEmail('  Person@Example.COM '), 'person@example.com');
  assert.equal(isValidEmail('person@example.com'), true);
  assert.equal(isValidEmail('person+tag@sub.example.co.uk'), true);
  assert.equal(isValidEmail('person@example'), false);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail(`${'a'.repeat(250)}@example.com`), false);
});

test('enforces the documented password policy', () => {
  assert.equal(validatePassword('longenough'), 'longenough');
  assert.throws(() => validatePassword('short'), /at least 8/i);
  assert.throws(() => validatePassword('x'.repeat(513)), /too long/i);
});

test('rejects unsupported stored password metadata during verification', async () => {
  assert.equal(await verifyPassword('anything at all', { algorithm: 'bcrypt', iterations: 1, salt: 'x', password_hash: 'y' }, { pepper: PEPPER }), false);
  assert.equal(await verifyPassword('anything at all', { algorithm: 'PBKDF2-SHA-256', iterations: 10, salt: 'x', password_hash: 'y' }, { pepper: PEPPER }), false);
  assert.equal(await verifyPassword('anything at all', null, { pepper: PEPPER }), false);
});

test('produces url-safe base64 that round-trips', () => {
  const bytes = new Uint8Array([0, 1, 250, 251, 252, 253, 254, 255]);
  const encoded = bytesToBase64Url(bytes);
  assert.equal(/^[A-Za-z0-9_-]+$/.test(encoded), true);
  assert.deepEqual(Array.from(base64UrlToBytes(encoded)), Array.from(bytes));
});

test('generates distinct random tokens and stable digests', async () => {
  const first = randomToken(32);
  const second = randomToken(32);
  assert.notEqual(first, second);
  assert.ok(first.length >= 40);
  assert.equal(await sha256('abc'), await sha256('abc'));
  assert.notEqual(await sha256('abc'), await sha256('abd'));
});

test('compares digests in constant time without length confusion', () => {
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});

test('projects a database row into a safe public user', () => {
  const user = publicUser({
    id: 'user-1',
    email: 'person@example.com',
    created_at: '2025-12-01T00:00:00.000Z',
    password_hash: 'should-not-leak',
    password_salt: 'should-not-leak'
  });
  // Email is only a login identifier now, so there is no verification flag.
  assert.deepEqual(user, {
    id: 'user-1',
    email: 'person@example.com',
    createdAt: '2025-12-01T00:00:00.000Z'
  });
  assert.equal(JSON.stringify(user).includes('should-not-leak'), false);
  assert.equal(publicUser(null), null);
});