import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { assertEmailAvailable, assertUsableToken, decoyRecoveryQuestion } from '../worker/auth.js';
import { base64UrlToBytes } from '../worker/crypto.js';
import { AUTH_LIMITS, limitFor } from '../worker/limits.js';
import { normalizeTimestamp } from '../worker/sync.js';
import { AppError, SESSION_COOKIE, STORES, cleanSyncData, checkOrigin, cookieValue, normalizeIp, normalizeSecretPayload, rateLimit } from '../worker/support.js';

const futureStamp = () => Math.floor(Date.now() / 1000) + 3600;
const pastStamp = () => Math.floor(Date.now() / 1000) - 1;

test('rejects a token that was already consumed, even before it expires', () => {
  // Regression: a replayed email-change/reset token must report "used" rather
  // than being reprocessed as a fresh request.
  const consumed = { consumed_at: Math.floor(Date.now() / 1000), expires_at: futureStamp() };
  assert.throws(
    () => assertUsableToken(consumed),
    (error) => error instanceof AppError && error.status === 400 && error.code === 'token_expired'
  );
  assert.throws(() => assertUsableToken(consumed), /expired or was already used/i);
});

test('rejects an expired or missing token but accepts a live one', () => {
  assert.throws(() => assertUsableToken(null), /expired or was already used/i);
  assert.throws(() => assertUsableToken({ consumed_at: null, expires_at: pastStamp() }), /expired or was already used/i);
  const live = { consumed_at: null, expires_at: futureStamp() };
  assert.equal(assertUsableToken(live), live);
});

test('sends no email and gates nothing on verification', async () => {
  // Regression: this app once hard-blocked sign-in on a confirmed email address,
  // which turned any mail-provider misconfiguration into a total lockout. Email
  // delivery is now removed entirely, so the failure mode cannot recur and no
  // mail provider remains a dependency.
  const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
  const [auth, sync, index, client] = await Promise.all([
    read('../worker/auth.js'),
    read('../src/services/syncEngine.js'),
    read('../worker/index.js'),
    read('../src/services/appClient.js')
  ]);
  for (const [name, source] of Object.entries({ auth, index, client })) {
    assert.doesNotMatch(source, /brevo|emailoctopus|smtp/gi, `${name} still references a mail provider`);
  }
  assert.doesNotMatch(auth, /email_verified|email_not_verified|Confirm your email/i);
  assert.doesNotMatch(sync, /hasConfirmedSession\(/);
  // The link-based routes are removed, not merely unused.
  for (const route of ['confirm', 'confirm-email', 'resend-confirmation', 'forgot-password', 'request-email-change']) {
    assert.doesNotMatch(auth, new RegExp(`path === '${route}'`), `route ${route} still exists`);
  }
  assert.match(auth, /path === 'recovery-questions'/);
  assert.match(auth, /path === 'recover'/);
});

test('returns an indistinguishable recovery challenge for unknown addresses', () => {
  // Recovery starts from an email address. If the reply differed for "no such
  // account" versus "account with no secrets", this endpoint would reveal which
  // addresses are registered.
  const decoy = decoyRecoveryQuestion();
  assert.equal(decoy.id, null);
  assert.equal(typeof decoy.question, 'string');
  assert.ok(decoy.question.length > 0);
  assert.notEqual(decoy.salt, decoyRecoveryQuestion().salt, 'each decoy needs a fresh salt');
  assert.ok(base64UrlToBytes(decoy.salt).length >= 16);
});

test('does not report a false collision when the new address is the same account', () => {
  // Regression: confirming an email change to the account's own current address
  // used to fail with "already in use" because the user matched itself.
  assert.doesNotThrow(() => assertEmailAvailable({ id: 'user-1', email: 'me@example.com' }, 'user-1'));
  assert.doesNotThrow(() => assertEmailAvailable(null, 'user-1'));
  assert.throws(
    () => assertEmailAvailable({ id: 'someone-else', email: 'taken@example.com' }, 'user-1'),
    (error) => error instanceof AppError && error.status === 409 && error.code === 'account_exists'
  );
});

test('rate limits live in one table and every protected route has an entry', async () => {
  // The limits were literals at seven call sites, so a typo or a forgotten route
  // was invisible. They are now named policy, and this pins the routes that must
  // never fall through to the default.
  const routes = ['signup', 'signin', 'recovery-questions', 'recover', 'reset-password', 'change-password', 'email-change'];
  for (const route of routes) {
    const policy = AUTH_LIMITS[route];
    assert.ok(policy, `${route} has no entry in AUTH_LIMITS`);
    assert.ok(policy.attempts > 0, `${route} allows no attempts`);
    assert.ok(policy.windowSeconds >= 60, `${route} has a window under a minute`);
  }
  // Creating an account is not a credential guess; taking an existing password is.
  assert.ok(AUTH_LIMITS.signup.attempts > AUTH_LIMITS.signin.attempts, 'signup should be looser than signin');

  // Every route rateLimit() is actually called with must be a known key.
  const source = await readFile(new URL('../worker/auth.js', import.meta.url), 'utf8');
  const called = [...source.matchAll(/rateLimit\(env, request, '([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(called.length >= 7, `only ${called.length} rate-limited routes found`);
  for (const route of called) {
    assert.ok(limitFor(route) === AUTH_LIMITS[route], `${route} is rate limited but missing from the table`);
  }
});

test('an unknown rate-limit route falls back to the tightest policy', () => {
  // Failing closed matters more than convenience: a typo in a route name must not
  // silently grant unlimited attempts. Inherited object properties are not routes
  // either, so the lookup must not be a bare property read.
  const tightest = { attempts: 10, windowSeconds: 900 };
  assert.deepEqual(limitFor('not-a-route'), tightest);
  assert.deepEqual(limitFor('toString'), tightest, 'inherited object properties are not routes');
  assert.deepEqual(limitFor('constructor'), tightest);
  assert.deepEqual(limitFor(''), tightest);
  // The real entries are the table's own objects, not copies of the fallback.
  assert.equal(limitFor('signin'), AUTH_LIMITS.signin);
  assert.equal(limitFor('signup'), AUTH_LIMITS.signup);
});

test('a rate-limited request states how long to wait instead of an open-ended delay', async () => {
  // Regression: "please wait and try again" left the user with no idea when the
  // app would work again, which reads as a permanently broken signup.
  const env = {
    AUTH_RATE_LIMITER: {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 240 }) })
    }
  };
  await assert.rejects(
    () => rateLimit(env, new Request('https://app.example/api/auth/signup'), 'signup', 20, 3600),
    (error) => error instanceof AppError && error.status === 429 && /try again in 4 minutes/i.test(error.message)
  );
});

test('a rate limiter outage fails open so sign-in is never blocked', async () => {
  const env = { AUTH_RATE_LIMITER: { idFromName: () => 'id', get: () => ({ fetch: async () => { throw new Error('DO offline'); } }) } };
  await assert.doesNotReject(() => rateLimit(env, new Request('https://app.example/api/auth/signin'), 'signin', 10, 900));
});

test('the allowlist exempts the owner without handing the bypass to anyone else', async () => {
  // The owner must never be locked out of their own app by a flaky connection,
  // but the exemption has to be provable only for a Cloudflare-verified address.
  // X-Forwarded-For is caller controlled, so trusting it would hand every
  // attacker the owner's bypass with a single forged header.
  const calls = [];
  const env = {
    RATE_LIMIT_ALLOWLIST: '86.180.178.35, 203.0.113.9',
    AUTH_RATE_LIMITER: {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => { calls.push('fetch'); return Response.json({ allowed: false, retryAfter: 600 }); } })
    }
  };
  const signin = (headers) => new Request('https://app.example/api/auth/signin', { headers });
  const rateLimited = (error) => error instanceof AppError && error.status === 429 && error.code === 'rate_limited';

  await assert.doesNotReject(() => rateLimit(env, signin({ 'CF-Connecting-IP': '86.180.178.35' }), 'signin', 10, 900));
  assert.equal(calls.length, 0, 'an allowlisted address must never reach the limiter');

  await assert.doesNotReject(() => rateLimit(env, signin({ 'CF-Connecting-IP': '203.0.113.9' }), 'signin', 10, 900));
  assert.equal(calls.length, 0, 'every listed address is exempt, not only the first');

  await assert.rejects(() => rateLimit(env, signin({ 'X-Forwarded-For': '86.180.178.35' }), 'signin', 10, 900), rateLimited);
  assert.equal(calls.length, 1, 'a forged X-Forwarded-For must not buy the exemption');

  await assert.rejects(() => rateLimit(env, signin({ 'CF-Connecting-IP': '198.51.100.4' }), 'signin', 10, 900), rateLimited);
  assert.equal(calls.length, 2, 'an address that is not listed is still rate limited');
});

test('an unlisted or absent allowlist leaves rate limiting fully intact', async () => {
  const blocked = { idFromName: () => 'id', get: () => ({ fetch: async () => Response.json({ allowed: false, retryAfter: 60 }) }) };
  const signin = () => new Request('https://app.example/api/auth/signin', { headers: { 'CF-Connecting-IP': '86.180.178.35' } });
  for (const env of [{ AUTH_RATE_LIMITER: blocked }, { RATE_LIMIT_ALLOWLIST: '', AUTH_RATE_LIMITER: blocked }, { RATE_LIMIT_ALLOWLIST: '  ', AUTH_RATE_LIMITER: blocked }]) {
    await assert.rejects(() => rateLimit(env, signin(), 'signin', 10, 900), (error) => error instanceof AppError && error.status === 429);
  }
});

test('an IPv6 allowlist entry matches however the address happens to be spelled', () => {
  // A dual-stack client reaches the edge as IPv6, and the same address can be
  // written in several valid ways. Comparing the raw text would silently miss the
  // entry, which is indistinguishable from the allowlist not working at all.
  const owner = '2a00:23c8:9194:3e01:e1e7:229d:30a5:8afc';
  assert.equal(normalizeIp(owner), normalizeIp(owner.toUpperCase()));
  assert.equal(normalizeIp('  ' + owner + '  '), normalizeIp(owner));
  // Leading zeros in a group are optional, and :: stands for a run of zero groups.
  assert.equal(normalizeIp('2A00:23C8:9194:3E01:E1E7:229D:30A5:8AFC'), normalizeIp(owner));
  assert.equal(normalizeIp('2001:0DB8:0000:0000:0000:0000:0000:0001'), normalizeIp('2001:db8::1'));
  assert.equal(normalizeIp('::ffff:86.180.178.35'), '86.180.178.35');
  // The deprecated IPv4-compatible ::1.2.3.4 is a different address space and must
  // not be folded into 1.2.3.4, or the allowlist would quietly cover more than listed.
  assert.notEqual(normalizeIp('::86.180.178.35'), '86.180.178.35');
  assert.equal(normalizeIp('86.180.178.35'), '86.180.178.35');
  assert.equal(normalizeIp('[2001:db8::1]'), normalizeIp('2001:db8::1'));
  // Distinct addresses must stay distinct, or the allowlist would quietly widen.
  assert.notEqual(normalizeIp('2a00:23c8:9194:3e01:e1e7:229d:30a5:8afc'), normalizeIp('2a00:23c8:9194:3e01:e1e7:229d:30a5:8afd'));
  // Anything unparseable is passed through rather than treated as a wildcard.
  assert.equal(normalizeIp('not-an-ip'), 'not-an-ip');
  assert.equal(normalizeIp(''), '');
});

test('the owner is exempt over IPv6 and the neighbour next to them is not', async () => {
  const calls = [];
  const env = {
    RATE_LIMIT_ALLOWLIST: '86.180.178.35, 2a00:23c8:9194:3e01:e1e7:229d:30a5:8afc',
    AUTH_RATE_LIMITER: {
      idFromName: () => 'id',
      get: () => ({ fetch: async () => { calls.push('fetch'); return Response.json({ allowed: false, retryAfter: 600 }); } })
    }
  };
  const from = (ip) => new Request('https://app.example/api/auth/signin', { headers: { 'CF-Connecting-IP': ip } });

  // The edge may report IPv6 in upper case or compressed; the entry must still hit.
  await assert.doesNotReject(() => rateLimit(env, from('2A00:23C8:9194:3E01:E1E7:229D:30A5:8AFC'), 'signin', 10, 900));
  assert.equal(calls.length, 0, 'the allowlisted IPv6 address must never reach the limiter');

  await assert.rejects(
    () => rateLimit(env, from('2a00:23c8:9194:3e01:e1e7:229d:30a5:8afd'), 'signin', 10, 900),
    (error) => error instanceof AppError && error.status === 429,
    'a different address in the same prefix is still rate limited'
  );
  assert.equal(calls.length, 1);
});

test('normalizes sync timestamps to a single comparable format', () => {
  assert.equal(normalizeTimestamp('2026-01-02T03:04:05.000Z'), '2026-01-02T03:04:05.000Z');
  assert.equal(normalizeTimestamp('2026-01-02T04:04:05+01:00'), '2026-01-02T03:04:05.000Z');
  assert.throws(() => normalizeTimestamp('not-a-date'), /valid timestamp/i);
  assert.throws(() => normalizeTimestamp(''), /valid timestamp/i);
});

test('strips device-only fields from synced data', () => {
  const data = cleanSyncData({
    id: 'row-1',
    owner_id: 'someone-else',
    ownerID: 'someone-else',
    updated_at: '2026-01-01T00:00:00.000Z',
    pending_sync: true,
    synced_at: '2026-01-01T00:00:00.000Z',
    _deleted: true,
    amount: 10,
    name: 'Rent'
  });
  assert.deepEqual(data, { amount: 10, name: 'Rent' });
});

test('rejects oversized sync records', () => {
  assert.throws(() => cleanSyncData({ blob: 'x'.repeat(200_001) }), /too large/i);
});

test('exposes exactly the store names the sync engine sends', () => {
  assert.equal(STORES.has('netWorthHistory'), true);
  assert.equal(STORES.has('account_secrets'), false);
  assert.equal(STORES.has('auth_sessions'), false);
});

test('validates the secret-answer payload before storing it', () => {
  const digest = 'A'.repeat(43) + '=';
  const salt = 'B'.repeat(22) + '==';
  const payload = normalizeSecretPayload({ question: '  Mother’s   maiden name ', answer_hash: digest, salt, iterations: 310_000 });
  assert.equal(payload.question, 'Mother’s maiden name');
  assert.equal(payload.algorithm, 'PBKDF2-SHA-256');
  assert.throws(() => normalizeSecretPayload({ question: '', answer_hash: digest, salt, iterations: 310_000 }), /secret question/i);
  assert.throws(() => normalizeSecretPayload({ question: 'q', answer_hash: digest, salt, iterations: 10 }), /settings are invalid/i);
  assert.throws(() => normalizeSecretPayload({ question: 'q', answer_hash: 'short', salt, iterations: 310_000 }), /digest is invalid/i);
  assert.throws(() => normalizeSecretPayload({ question: 'q', answer_hash: digest, salt: 'short', iterations: 310_000 }), /digest is invalid/i);
});

test('parses the session cookie out of a request header', () => {
  const request = new Request('https://app.example/api/auth/session', {
    headers: { Cookie: 'other=1; fh_session=abc.def; another=2' }
  });
  assert.equal(SESSION_COOKIE, 'fh_session');
  assert.equal(cookieValue(request, SESSION_COOKIE), 'abc.def');
  assert.equal(cookieValue(request, 'missing'), '');
});

test('allows same-origin API calls and denies other origins', () => {
  const env = { APP_URL: 'https://app.example' };
  const sameOrigin = new Request('https://app.example/api/auth/session', {
    headers: { Origin: 'https://app.example' }
  });
  assert.equal(checkOrigin(sameOrigin, env), 'https://app.example');
  const otherOrigin = new Request('https://app.example/api/auth/session', {
    headers: { Origin: 'https://evil.example' }
  });
  assert.throws(() => checkOrigin(otherOrigin, env), (error) => error instanceof AppError && error.status === 403);
  assert.equal(checkOrigin(new Request('https://app.example/api/health'), env), '');
});
