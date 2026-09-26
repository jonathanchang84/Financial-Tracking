import {
  base64UrlToBytes,
  bytesToBase64Url,
  constantTimeEqual,
  hashPassword,
  isValidEmail,
  normalizeEmail,
  randomToken,
  sha256,
  validatePassword,
  verifyPassword
} from './crypto.js';
import {
  AppError,
  createSession,
  createToken,
  expiredCookie,
  getSession,
  json,
  normalizeSecretPayload,
  passwordPepper,
  readJson,
  requireUser,
  rateLimit,
  sessionCookie,
  userResponse
} from './support.js';

const PASSWORD_FIELDS = 'password_algorithm AS algorithm, password_iterations AS iterations, password_salt AS salt, password_hash AS password_hash';
const USER_FIELDS = 'id, email, created_at';
/** How long a proved recovery stays usable. Short, because it needs no inbox round trip. */
const RECOVERY_TTL_SECONDS = 15 * 60;

function authResponse(payload, status, request, token) {
  const response = json(payload, status);
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', sessionCookie(request, token));
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function addCookie(response, cookie) {
  const headers = new Headers(response.headers);
  headers.append('Set-Cookie', cookie);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

async function findUserByEmail(env, email) {
  return env.DB.prepare(
    `SELECT id, email, created_at, ${PASSWORD_FIELDS} FROM users WHERE email = ? COLLATE NOCASE`
  ).bind(email).first();
}

async function findToken(env, token) {
  if (!token) throw new AppError('This recovery is missing its token. Start again.', 400, 'invalid_token');
  return env.DB.prepare(
    `SELECT token_hash, user_id, purpose, expires_at, consumed_at
       FROM auth_tokens WHERE token_hash = ? AND purpose = 'recovery'`
  ).bind(await sha256(token)).first();
}

async function consumeToken(env, row) {
  const result = await env.DB.prepare(
    'UPDATE auth_tokens SET consumed_at = ? WHERE token_hash = ? AND consumed_at IS NULL'
  ).bind(Math.floor(Date.now() / 1000), row.token_hash).run();
  if (!result.meta?.changes) throw new AppError('This recovery has already been used. Start again.', 400, 'token_used');
}

function safeDigest(value) {
  try {
    const bytes = base64UrlToBytes(value);
    return bytes.length === 32 ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * A recovery grant is usable only while it exists, is unconsumed, and is inside
 * its short window. Exported so the single-use rules stay unit-testable.
 */
export function assertUsableToken(row, label = 'recovery') {
  const now = Math.floor(Date.now() / 1000);
  if (!row || row.consumed_at || Number(row.expires_at) <= now) {
    throw new AppError(`This ${label} has expired or was already used. Start again.`, 400, 'token_expired');
  }
  return row;
}

/**
 * An email change may not land on an address owned by a different account.
 * Comparing the owner id prevents a false collision when the new address is
 * already this account's own current address.
 */
export function assertEmailAvailable(existing, ownerId) {
  if (existing && existing.id !== ownerId) {
    throw new AppError('That email address is already in use.', 409, 'account_exists');
  }
}

function validatedPassword(value) {
  try {
    return validatePassword(value);
  } catch (error) {
    throw new AppError(error instanceof Error ? error.message : 'Enter a valid password.', 400, 'invalid_password');
  }
}

/** Store a new password and close every existing session for that account. */
async function replacePassword(env, userId, password) {
  const stored = await hashPassword(password, { pepper: passwordPepper(env) });
  await env.DB.prepare(
    `UPDATE users
        SET password_algorithm = ?, password_iterations = ?, password_salt = ?, password_hash = ?,
            password_reset_required = 0, updated_at = ?
      WHERE id = ?`
  ).bind(stored.algorithm, stored.iterations, stored.salt, stored.password_hash, new Date().toISOString(), userId).run();
  await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ?').bind(userId).run();
}

/**
 * Questions that may be used to recover an account, with the salt and iteration
 * count the browser needs to re-derive the same digest.
 *
 * The decoy entry is deliberate. Recovery starts with an email address, and a
 * reply that differs for "no such account" versus "account with no secrets set"
 * would let anyone enumerate who has an account here. Returning a plausible
 * question and a fresh random salt either way makes the two cases
 * indistinguishable, and the digest simply fails to match.
 */
const DECOY_QUESTION = 'Your security question';

export function decoyRecoveryQuestion() {
  return {
    id: null,
    question: DECOY_QUESTION,
    salt: bytesToBase64Url(crypto.getRandomValues(new Uint8Array(16)))
  };
}

export async function recoveryQuestions(env, email) {
  const user = await findUserByEmail(env, email);
  if (!user) return [decoyRecoveryQuestion()];
  const rows = await env.DB.prepare(
    'SELECT id, question, salt FROM account_secrets WHERE owner_id = ? ORDER BY created_at ASC LIMIT 5'
  ).bind(user.id).all();
  if (!rows.results?.length) return [decoyRecoveryQuestion()];
  return rows.results;
}

export async function handleAuth(request, env, path) {
  if (path === 'session' && request.method === 'GET') {
    const session = await getSession(request, env);
    if (!session) throw new AppError('No active session.', 401, 'unauthorized');
    return json({ user: session.user });
  }

  if (path === 'signup' && request.method === 'POST') {
    await rateLimit(env, request, 'signup');
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw new AppError('Enter a valid email address.', 400, 'invalid_email');
    const password = validatedPassword(body.password);
    const stored = await hashPassword(password, { pepper: passwordPepper(env) });
    const existing = await findUserByEmail(env, email);
    if (existing) {
      // Equalize the response cost whether or not the address is already taken.
      await verifyPassword(password, existing, { pepper: passwordPepper(env) });
      throw new AppError('An account with this email already exists — switch to "Sign in".', 409, 'account_exists');
    }
    const id = randomToken(16);
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO users
           (id, email, password_algorithm, password_iterations, password_salt, password_hash,
            password_reset_required, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      ).bind(id, email, stored.algorithm, stored.iterations, stored.salt, stored.password_hash, now, now).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error))) {
        throw new AppError('An account with this email already exists — switch to "Sign in".', 409, 'account_exists');
      }
      throw error;
    }
    // The account is complete and usable the moment it exists, so a session is
    // issued immediately. There is no confirmation step to wait for.
    const user = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).bind(id).first();
    return authResponse({ user: userResponse(user) }, 201, request, await createSession(env, id));
  }

  if (path === 'signin' && request.method === 'POST') {
    await rateLimit(env, request, 'signin');
    const body = await readJson(request);
    const user = await findUserByEmail(env, normalizeEmail(body.email));
    const candidate = String(body.password || '');
    const derivable = candidate.length >= 8 && candidate.length <= 512;
    // Always run a password derivation so a missing account, a short password
    // and a wrong password all take a comparable amount of time.
    const derived = await hashPassword(derivable ? candidate : 'invalid-password-placeholder', { pepper: passwordPepper(env) });
    const valid = user && derivable
      ? await verifyPassword(candidate, user, { pepper: passwordPepper(env) })
      : constantTimeEqual(derived.password_hash, derived.password_hash);
    if (!user || !valid) throw new AppError('Email or password is incorrect.', 401, 'invalid_credentials');
    return authResponse({ user: userResponse(user) }, 200, request, await createSession(env, user.id));
  }

  if (path === 'logout' && request.method === 'POST') {
    const session = await getSession(request, env);
    if (session) await env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(session.tokenHash).run();
    return addCookie(json({ ok: true }), expiredCookie(request));
  }

  // --- Password recovery, entirely in-session -------------------------
  // There is no inbox involved, so recovery proves identity with a secret
  // answer instead. The browser derives the digest locally and only the digest
  // ever reaches the Worker.
  if (path === 'recovery-questions' && request.method === 'POST') {
    await rateLimit(env, request, 'recovery-questions');
    const body = await readJson(request);
    const questions = await recoveryQuestions(env, normalizeEmail(body.email));
    return json({ questions });
  }

  if (path === 'recover' && request.method === 'POST') {
    await rateLimit(env, request, 'recover');
    const body = await readJson(request);
    const user = await findUserByEmail(env, normalizeEmail(body.email));
    // Run a real comparison even when there is no account, so an attacker
    // cannot distinguish "no such account" from "wrong answer" by timing.
    const row = user && body.secretId
      ? await env.DB.prepare('SELECT answer_hash FROM account_secrets WHERE id = ? AND owner_id = ?')
          .bind(String(body.secretId), user.id).first()
      : null;
    const expected = safeDigest(row?.answer_hash);
    const actual = safeDigest(body.answer_hash);
    if (!expected || !actual || !constantTimeEqual(expected, actual)) {
      throw new AppError('That secret answer is not correct.', 401, 'recovery_failed');
    }
    const token = await createToken(env, user.id, 'recovery', RECOVERY_TTL_SECONDS);
    const updated = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).bind(user.id).first();
    return authResponse({ user: userResponse(updated), recoveryToken: token }, 200, request, await createSession(env, user.id));
  }

  if (path === 'reset-password' && request.method === 'POST') {
    await rateLimit(env, request, 'reset-password');
    const body = await readJson(request);
    const row = assertUsableToken(await findToken(env, body.token));
    await replacePassword(env, row.user_id, validatedPassword(body.password));
    await consumeToken(env, row);
    return json({ ok: true });
  }

  if (path === 'change-password' && request.method === 'POST') {
    const { user, tokenHash } = await requireUser(request, env);
    await rateLimit(env, request, 'change-password');
    const body = await readJson(request);
    const row = await findUserByEmail(env, user.email);
    if (!row || !await verifyPassword(String(body.currentPassword || ''), row, { pepper: passwordPepper(env) })) {
      throw new AppError('Current password is incorrect.', 401, 'invalid_credentials');
    }
    const stored = await hashPassword(validatedPassword(body.newPassword), { pepper: passwordPepper(env) });
    await env.DB.prepare(
      `UPDATE users
          SET password_algorithm = ?, password_iterations = ?, password_salt = ?, password_hash = ?, updated_at = ?
        WHERE id = ?`
    ).bind(stored.algorithm, stored.iterations, stored.salt, stored.password_hash, new Date().toISOString(), user.id).run();
    await env.DB.prepare('DELETE FROM auth_sessions WHERE user_id = ? AND token_hash != ?').bind(user.id, tokenHash).run();
    return json({ ok: true });
  }


  if (path === 'change-email' && request.method === 'POST') {
    const { user, tokenHash } = await requireUser(request, env);
    await rateLimit(env, request, 'email-change');
    const body = await readJson(request);
    const email = normalizeEmail(body.email);
    if (!isValidEmail(email)) throw new AppError('Enter a valid email address.', 400, 'invalid_email');
    if (email === user.email) throw new AppError('The new email address is the same as the current one.', 400, 'same_email');
    assertEmailAvailable(await findUserByEmail(env, email), user.id);
    const row = await findUserByEmail(env, user.email);
    if (!row || !await verifyPassword(String(body.currentPassword || ''), row, { pepper: passwordPepper(env) })) {
      throw new AppError('Current password is incorrect.', 401, 'invalid_credentials');
    }
    // Without email there is no link to confirm, so the address is re-authenticated
    // with the current password and then applied. Sessions stay valid because the
    // account identity, not the address, is what they belong to.
    try {
      await env.DB.prepare('UPDATE users SET email = ?, updated_at = ? WHERE id = ?')
        .bind(email, new Date().toISOString(), user.id).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error))) throw new AppError('That email address is already in use.', 409, 'account_exists');
      throw error;
    }
    const updated = await env.DB.prepare(`SELECT ${USER_FIELDS} FROM users WHERE id = ?`).bind(user.id).first();
    return json({ user: userResponse(updated), tokenHash }, 200);
  }

  if (path === 'account-secrets' && request.method === 'GET') {
    const { user } = await requireUser(request, env);
    const result = await env.DB.prepare('SELECT id, question, salt, algorithm, iterations, created_at, updated_at FROM account_secrets WHERE owner_id = ? ORDER BY created_at ASC').bind(user.id).all();
    return json({ secrets: result.results || [] });
  }

  if (path === 'account-secrets' && request.method === 'POST') {
    const { user } = await requireUser(request, env);
    const body = await readJson(request);
    const payload = normalizeSecretPayload(body);
    const id = String(body.id || randomToken(16));
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        `INSERT INTO account_secrets (id, owner_id, question, answer_hash, salt, algorithm, iterations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(id, user.id, payload.question, payload.answer_hash, payload.salt, payload.algorithm, payload.iterations, now, now).run();
    } catch (error) {
      if (/UNIQUE|constraint/i.test(String(error))) throw new AppError('A secret answer with that question already exists.', 409, 'secret_exists');
      throw error;
    }
    return json({ secret: { id, question: payload.question, created_at: now, updated_at: now } }, 201);
  }


  if (path.startsWith('account-secrets/') && path.endsWith('/verify') && request.method === 'POST') {
    const { user } = await requireUser(request, env);
    const id = decodeURIComponent(path.slice('account-secrets/'.length, -'/verify'.length));
    const body = await readJson(request);
    const row = await env.DB.prepare('SELECT answer_hash, salt, algorithm, iterations FROM account_secrets WHERE id = ? AND owner_id = ?').bind(id, user.id).first();
    const expected = row ? safeDigest(row.answer_hash) : null;
    const actual = safeDigest(body.answer_hash);
    return json({ verified: Boolean(expected && actual && constantTimeEqual(expected, actual)) });
  }

  if (path.startsWith('account-secrets/') && request.method === 'PUT') {
    const { user } = await requireUser(request, env);
    const id = decodeURIComponent(path.slice('account-secrets/'.length));
    const payload = normalizeSecretPayload(await readJson(request));
    const now = new Date().toISOString();
    const result = await env.DB.prepare(
      `UPDATE account_secrets SET question = ?, answer_hash = ?, salt = ?, algorithm = ?, iterations = ?, updated_at = ? WHERE id = ? AND owner_id = ?`
    ).bind(payload.question, payload.answer_hash, payload.salt, payload.algorithm, payload.iterations, now, id, user.id).run();
    if (!result.meta?.changes) throw new AppError('That secret answer no longer exists.', 404, 'not_found');
    return json({ secret: { id, question: payload.question, updated_at: now } });
  }

  if (path.startsWith('account-secrets/') && request.method === 'DELETE') {
    const { user } = await requireUser(request, env);
    const id = decodeURIComponent(path.slice('account-secrets/'.length));
    await env.DB.prepare('DELETE FROM account_secrets WHERE id = ? AND owner_id = ?').bind(id, user.id).run();
    return json({ ok: true });
  }

  throw new AppError('Authentication route not found.', 404, 'not_found');
}

