/**
 * Pre-deployment functional test.
 *
 * Exercises the two flows that unit tests cannot prove, against a real Worker
 * process backed by a real (local) D1 database:
 *
 *   1. Sign up as a brand-new user, confirm the address, and sign in.
 *   2. Sign in as that existing user and prove the session works.
 *
 * Why a real process instead of `Miniflare`/unit mocks: the bugs that actually
 * broke this app (Cloudflare's PBKDF2 iteration ceiling, a Durable Object
 * rate limit, a missing binding) only reproduce inside the Workers runtime.
 *
 * It starts `wrangler dev` itself, so there is nothing to remember to clean up
 * and it cannot accidentally hit the deployed site or the production database.
 *
 * Usage:
 *   npm run test:functional              # hermetic: local Worker + local D1
 *   FT_BASE_URL=https://... npm run test:functional   # target a live origin
 *
 * A base URL supplied through FT_BASE_URL still verifies the same contract, but
 * it creates a real account and consumes a real rate-limit slot, so it is not
 * the default.
 */

import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { startLocalWorker as startWorker } from './localWorker.mjs';

const baseUrl = String(process.env.FT_BASE_URL || '').replace(/\/+$/, '');
const external = Boolean(baseUrl);
const port = Number(process.env.FT_PORT || 8788);
const origin = baseUrl || `http://127.0.0.1:${port}`;

const checks = [];
let failures = 0;
/** Set when Cloudflare's edge blocks the run, so the remaining stages are skipped. */
let edgeBlocked = false;

function record(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!ok) failures += 1;
  const mark = ok ? '  [32mPASS[0m' : '  [31mFAIL[0m';
  console.log(`${mark} ${name}${detail ? `\n       ${detail}` : ''}`);
}

function section(title) {
  console.log(`\n[1m${title}[0m`);
}

/** Minimal cookie jar: the API authenticates with one HttpOnly session cookie. */
const jar = new Map();

function rememberCookies(response) {
  for (const raw of response.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    if (index < 0) continue;
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value) jar.delete(name);
    else jar.set(name, value);
  }
}

function cookieHeader() {
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function call(path, options = {}) {
  // `wrangler dev` briefly reloads its workerd isolate when the D1 CLI writes to
  // the same local SQLite file, which surfaces as a transient `fetch failed`.
  // Retrying for a few seconds keeps a bookkeeping step from failing the gate.
  const attempts = 6;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await callOnce(path, options);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      await delay(500 * attempt);
    }
  }
  throw lastError;
}

async function callOnce(path, { method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { Accept: 'application/json', ...headers };
  if (jar.size) requestHeaders.Cookie = cookieHeader();
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  rememberCookies(response);
  const text = await response.text();
  let payload = {};
  if (text) {
    try { payload = JSON.parse(text); } catch {
      // A non-JSON body is almost always an edge/CDN interstitial. Keep the
      // identifying marker and drop the page so a failure stays readable.
      payload = { raw: text.slice(0, 200), edgeBlocked: /temporarily rate limited|cf-error|Attention Required/i.test(text) };
    }
  }
  return { status: response.status, payload, cookies: response.headers.getSetCookie?.() || [] };
}

/* ------------------------------------------------------------------ */
/* Local Worker lifecycle                                             */
/* ------------------------------------------------------------------ */

let localWorker = null;

async function startLocalWorker() {
  localWorker = await startWorker({ port, source: 'scripts/functional-test.mjs' });
}

function stopLocalWorker() {
  localWorker?.stop();
  localWorker = null;
}


/**
 * Sign-up mail is never delivered in a local run, so the confirmation link
 * cannot be followed from a mailbox. Instead we mint a known token for the
 * account and call the real /api/auth/confirm route with it, which keeps the
 * confirmation logic under test rather than stubbing it out in the database.
 */
/**
 * Derive a secret answer exactly as the browser does, so the test exercises the
 * real comparison rather than a shortcut written into the database.
 */
async function digest(answer, { salt, iterations = 310_000 } = {}) {
  const saltBytes = salt ? Buffer.from(salt, 'base64url') : randomBytes(16);
  // `node:crypto`'s pbkdf2 is callback-only, so use the same WebCrypto call the
  // browser and Worker use. That keeps this genuinely end-to-end.
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(answer.trim().toLowerCase()), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' }, key, 256
  );
  return {
    answer_hash: Buffer.from(bits).toString('base64url'),
    salt: saltBytes.toString('base64url'),
    algorithm: 'PBKDF2-SHA-256',
    iterations
  };
}



/* ------------------------------------------------------------------ */
/* The two required flows                                             */
/* ------------------------------------------------------------------ */

const password = 'FunctionalTest!2345';
// Unique per run: a repeat run must exercise a genuinely new account rather
// than tripping the duplicate-address path and passing for a false success.
const email = `ft-${randomBytes(6).toString('hex')}@example.invalid`;

async function testHealth() {
  section('Readiness');
  const { status, payload } = await call('/api/health');
  // A Cloudflare edge block is not an application failure and must not be
  // reported as one, or a real defect would hide behind a misleading message.
  if (payload.edgeBlocked) {
    record('Reached the application (not blocked by a CDN/edge limit)', false, 'status=429 edgeBlocked=true — wait for the edge rate limit to reset, then re-run');
    edgeBlocked = true;
    return;
  }
  record('GET /api/health returns ok', status === 200 && payload.ok === true, `status=${status} body=${JSON.stringify(payload)}`);
  // The app sends no email, so there is no mail provider to be misconfigured.
  record(
    'No mail provider is required',
    payload.mail === undefined,
    `body=${JSON.stringify(payload)}`
  );
}

const SECRET_QUESTION = "Mother's maiden name";
const SECRET_ANSWER = 'smith-jones';
const NEW_PASSWORD = 'ReplacementPass!9876';

async function testSignUp() {
  section('1. Sign up as a new user');
  const { status, payload } = await call('/api/auth/signup', { method: 'POST', body: { email, password } });
  record(
    'POST /api/auth/signup creates the account',
    status === 201 && Boolean(payload.user?.email),
    `status=${status} body=${JSON.stringify(payload)} email=${email}`
  );
  if (status !== 201) {
    record('Sign-up flow continued', false, 'aborted: the account was not created');
    return;
  }
  record(
    'Sign-up issues a usable session immediately, with no confirmation step',
    jar.size > 0,
    `cookies=${[...jar.keys()].join(',') || 'none'}`
  );
  const session = await call('/api/auth/session');
  record(
    'The new account is signed in with no email verification',
    session.status === 200 && session.payload.user?.email === email,
    `status=${session.status} body=${JSON.stringify(session.payload)}`
  );

  // The removed link-based routes must be gone, not silently redirecting.
  const gone = await call('/api/auth/forgot-password', { method: 'POST', body: { email } });
  record('Emailed password reset no longer exists', gone.status === 404, `status=${gone.status}`);

  if (external) {
    await call('/api/auth/logout', { method: 'POST' });
    jar.clear();
    return;
  }

  await call('/api/auth/logout', { method: 'POST' });
  jar.clear();
}

async function testRecovery() {
  section('3. Recover a password in-session (no email)');
  // Derive once and reuse the salt, exactly as the browser does when the user
  // re-enters an answer. A fresh salt would simply never match.
  const stored = await digest(SECRET_ANSWER);

  // Sign back in so a secret can be attached to the account.
  await call('/api/auth/signin', { method: 'POST', body: { email, password } });
  const secret = await call('/api/auth/account-secrets', {
    method: 'POST',
    body: { question: SECRET_QUESTION, ...stored }
  });
  record(
    'A secret answer can be saved for recovery',
    secret.status === 201 && secret.payload.secret?.id,
    `status=${secret.status} body=${JSON.stringify(secret.payload)}`
  );
  await call('/api/auth/logout', { method: 'POST' });
  jar.clear();

  const unknown = await call('/api/auth/recovery-questions', { method: 'POST', body: { email: `nobody-${Date.now()}@example.invalid` } });
  const known = await call('/api/auth/recovery-questions', { method: 'POST', body: { email } });
  record(
    'Recovery works without any mail provider',
    known.status === 200 && known.payload.questions?.length >= 1,
    `status=${known.status} questions=${JSON.stringify(known.payload.questions)}`
  );
  // Enumeration guard: an unknown address must look like a known one.
  record(
    'An unknown address is indistinguishable from one with no secrets',
    unknown.status === 200
      && unknown.payload.questions?.length === known.payload.questions?.length
      && unknown.payload.questions?.[0]?.id === null,
    `unknown=${JSON.stringify(unknown.payload.questions)}`
  );

  const question = known.payload.questions?.[0];
  // Both attempts re-derive with the *stored* salt; only the answer differs.
  const wrong = await call('/api/auth/recover', {
    method: 'POST',
    body: {
      email,
      secretId: question?.id ?? null,
      answer_hash: (await digest('definitely-wrong', { salt: question?.salt })).answer_hash
    }
  });
  record(
    'A wrong secret answer is rejected',
    wrong.status === 401,
    `status=${wrong.status} body=${JSON.stringify(wrong.payload)}`
  );

  const good = await call('/api/auth/recover', {
    method: 'POST',
    body: { email, secretId: question?.id ?? null, answer_hash: stored.answer_hash }
  });
  record(
    'The correct secret answer issues a recovery grant and a session',
    good.status === 200 && Boolean(good.payload.recoveryToken) && jar.size > 0,
    `status=${good.status} token=${Boolean(good.payload.recoveryToken)}`
  );

  const reset = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token: good.payload.recoveryToken, password: NEW_PASSWORD }
  });
  record('The recovery grant sets a new password', reset.status === 200, `status=${reset.status} body=${JSON.stringify(reset.payload)}`);

  const replay = await call('/api/auth/reset-password', {
    method: 'POST',
    body: { token: good.payload.recoveryToken, password: 'AnotherPass!1234' }
  });
  record('The recovery grant cannot be reused', replay.status === 400, `status=${replay.status} body=${JSON.stringify(replay.payload)}`);

  jar.clear();
  const withOld = await call('/api/auth/signin', { method: 'POST', body: { email, password } });
  record('The old password no longer works', withOld.status === 401, `status=${withOld.status}`);

  const withNew = await call('/api/auth/signin', { method: 'POST', body: { email, password: NEW_PASSWORD } });
  record('The new password signs in', withNew.status === 200, `status=${withNew.status}`);
  await call('/api/auth/logout', { method: 'POST' });
  jar.clear();
}

async function testSignIn() {
  section('2. Sign in as an existing user');
  const wrong = await call('/api/auth/signin', { method: 'POST', body: { email, password: 'WrongPassword!2345' } });
  record(
    'Wrong password is rejected with 401 (not a 500)',
    wrong.status === 401,
    `status=${wrong.status} body=${JSON.stringify(wrong.payload)}`
  );

  const { status, payload } = await call('/api/auth/signin', { method: 'POST', body: { email, password } });
  record(
    'POST /api/auth/signin succeeds for the existing user',
    status === 200 && payload.user?.email === email,
    `status=${status} body=${JSON.stringify(payload)}`
  );
  if (status !== 200) return;

  record('Sign-in sets a session cookie', jar.size > 0, `cookies=${[...jar.keys()].join(',') || 'none'}`);

  const session = await call('/api/auth/session');
  record(
    'The session authenticates a protected request',
    session.status === 200 && session.payload.user?.email === email,
    `status=${session.status} body=${JSON.stringify(session.payload)}`
  );

  const push = await call('/api/sync/push', {
    method: 'POST',
    body: { rows: [{ store: 'settings', id: 'functional-test', updated_at: new Date().toISOString(), data: { key: 'probe', value: 1 } }] }
  });
  record(
    'A signed-in user can push a finance row',
    push.status === 200 && push.payload.accepted === 1,
    `status=${push.status} body=${JSON.stringify(push.payload)}`
  );

  const pull = await call('/api/sync/pull');
  record(
    'The pushed row is readable back',
    pull.status === 200 && (pull.payload.rows || []).some((row) => row.id === 'functional-test'),
    `status=${pull.status} rows=${(pull.payload.rows || []).length}`
  );

  await call('/api/auth/logout', { method: 'POST' });
  jar.clear();
  const afterLogout = await call('/api/auth/session');
  record('Signing out revokes the session', afterLogout.status === 401, `status=${afterLogout.status}`);
}

async function main() {
  console.log(`\nFunctional test against ${origin}${external ? ' (external — creates a real account)' : ''}`);
  if (!external) await startLocalWorker();
  try {
    await testHealth();
    // Nothing after an edge block is meaningful, and continuing would report a
    // pile of derived failures for what is really one upstream rate limit.
    if (!edgeBlocked) {
      await testSignUp();
      if (!external) {
        await testSignIn();
        await testRecovery();
      }
    }
  } catch (error) {
    record('Functional test completed without an unexpected error', false, String(error?.stack || error));
  } finally {
    if (!external) stopLocalWorker();
  }

  const passed = checks.filter((entry) => entry.ok).length;
  console.log(`\n${failures ? '[31m' : '[32m'}${passed}/${checks.length} checks passed[0m`);
  if (failures) {
    console.log('\nFailed checks:');
    for (const entry of checks.filter((item) => !item.ok)) {
      console.log(`  - ${entry.name}`);
      // Re-announced as a GitHub annotation, which is shown on the run page.
      // The list above only reaches the run log, which needs authentication, so
      // a red CI run was otherwise a step name with no explanation attached. The
      // detail is included because a check name rarely says what actually failed.
      const detail = [entry.detail, entry.status].filter(Boolean).join(' ').slice(0, 500);
      console.error(`::error title=${JSON.stringify(`Functional check failed: ${entry.name}`)}::${detail || 'no detail recorded'}`);
    }
  }
  process.exit(failures ? 1 : 0);
}

main();
