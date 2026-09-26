import test from 'node:test';
import assert from 'node:assert/strict';

import {
  hashRecoveryAnswer,
  normalizeRecoveryAnswer,
  validateRecoverySecret,
  verifyRecoveryAnswer
} from '../src/services/accountSecretCrypto.js';

const TEST_HASH_OPTIONS = { iterations: 100_000 };

test('normalizes secret answers without storing the entered form', () => {
  assert.equal(normalizeRecoveryAnswer('  Smith   Jones  '), 'smith jones');
  const values = validateRecoverySecret('  Mother’s   maiden name ', ' Smith   Jones ');
  assert.deepEqual(values, { question: 'Mother’s maiden name', answer: 'smith jones' });
});

test('creates a salted PBKDF2 digest and verifies the answer', async () => {
  const stored = await hashRecoveryAnswer('  Smith   Jones ', TEST_HASH_OPTIONS);
  assert.equal(stored.algorithm, 'PBKDF2-SHA-256');
  assert.equal(stored.iterations, 100_000);
  assert.notEqual(stored.salt, '');
  assert.notEqual(stored.answer_hash, 'smith jones');
  assert.equal(await verifyRecoveryAnswer('smith jones', stored), true);
  assert.equal(await verifyRecoveryAnswer('SMITH JONES', stored), true);
  assert.equal(await verifyRecoveryAnswer('different answer', stored), false);
});

test('uses a fresh salt for each secret answer', async () => {
  const first = await hashRecoveryAnswer('same answer', TEST_HASH_OPTIONS);
  const second = await hashRecoveryAnswer('same answer', TEST_HASH_OPTIONS);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.answer_hash, second.answer_hash);
});

test('rejects empty secret questions and answers', () => {
  assert.throws(() => validateRecoverySecret('', 'answer'), /question/i);
  assert.throws(() => validateRecoverySecret('question', '   '), /answer/i);
});

test('enforces the documented secret question and answer limits', () => {
  assert.throws(() => validateRecoverySecret('q'.repeat(201), 'answer'), /200 characters/i);
  assert.throws(() => validateRecoverySecret('question', 'a'.repeat(501)), /500 characters/i);
  assert.doesNotThrow(() => validateRecoverySecret('q'.repeat(200), 'a'.repeat(500)));
});

