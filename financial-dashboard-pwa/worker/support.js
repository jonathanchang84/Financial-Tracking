import { base64UrlToBytes, sha256, publicUser, randomToken } from './crypto.js';

export const SESSION_COOKIE = 'fh_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const STORES = new Set([
  'settings', 'bills', 'commitments', 'netWorthEntries', 'netWorthHistory', 'holdings',
  'portfolioHistory', 'pensions', 'pensionHistory', 'transactions', 'budgets', 'accounts', 'snapshots'
]);
const CLIENT_ONLY = new Set(['pending_sync', 'synced_at', '_deleted', 'table', 'owner_id', 'ownerID']);
const MAX_RECORD_BYTES = 200_000;

export class AppError extends Error {
  constructor(message, status = 400, code = 'request_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }
  });
}

export function errorResponse(error) {
  if (error instanceof AppError) return json({ error: error.code, message: error.message }, error.status);
  console.error('Unhandled application API error', error instanceof Error ? error.message : String(error));
  return json({ error: 'server_error', message: 'The application service could not complete that request.' }, 500);
}

export function requiredEnv(env, name) {
  const value = String(env?.[name] || '').trim();
  if (!value) throw new AppError(`The application service is missing ${name}.`, 503, 'service_misconfigured');
  return value;
}

export function passwordPepper(env) {
  const pepper = requiredEnv(env, 'AUTH_PEPPER');
  if (pepper.length < 32) throw new AppError('AUTH_PEPPER must be at least 32 characters.', 503, 'service_misconfigured');
  return pepper;
}

export function cookieValue(request, name) {
  for (const item of String(request.headers.get('Cookie') || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator > 0 && item.slice(0, separator).trim() === name) return decodeURIComponent(item.slice(separator + 1).trim());
  }
  return '';
}

function secureCookie(request) {
  try { return new URL(request.url).protocol === 'https:'; } catch { return true; }
}

export function sessionCookie(request, token) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`;
}

export function expiredCookie(request) {
  const secure = secureCookie(request) ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

/**
 * The Cloudflare-supplied client IP, or an empty string. Unlike `clientIp` this
 * never falls back to `X-Forwarded-For`, which the caller sets freely, so it is
 * the only value safe to base a security decision such as the rate-limit
 * allowlist on.
 */
export function trustedClientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

/**
 * Canonical form of an IP address, for comparing two addresses that may have
 * been written differently. The same IPv6 address has many valid spellings
 * (hex case, `::` zero compression, an embedded IPv4 tail), so a raw string
 * compare silently fails to match an allowlisted address that the edge reported
 * in another notation. IPv4 is returned unchanged. Anything that does not look
 * like an address is returned as-is so a typo cannot widen the allowlist.
 */
export function normalizeIp(value) {
  const address = String(value ?? '').trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!address) return '';
  // ::ffff:1.2.3.4 is the IPv4 address 1.2.3.4 in IPv6 clothing, so a dual-stack
  // client must match a bare IPv4 allowlist entry. Only the mapped form is folded
  // in: the deprecated IPv4-compatible ::1.2.3.4 is a genuinely different address
  // space, and treating it as 1.2.3.4 would widen the allowlist for no real gain.
  const mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!address.includes(':')) return address;
  // An embedded IPv4 tail such as ::1.2.3.4 stands for two 16-bit groups, not one.
  // Folding it to hex first keeps the group arithmetic below honest, and means the
  // result is always a valid address rather than a half-expanded string.
  const tail = address.replace(/:(\d{1,3}(?:\.\d{1,3}){3})$/, (match, quad) => {
    const octets = quad.split('.').map(Number);
    if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return match;
    return `:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  });
  const halves = tail.split('::');
  if (halves.length > 2) return address;
  // An address with no `::` is already fully written and must have 8 groups.
  if (halves.length === 1) {
    const full = halves[0].split(':');
    return full.length === 8 ? stripLeadingZeros(full) : address;
  }
  const head = halves[0] ? halves[0].split(':') : [];
  const back = halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - back.length;
  if (missing < 0) return address;
  return stripLeadingZeros([...head, ...new Array(missing).fill('0'), ...back]);
}

function stripLeadingZeros(groups) {
  return groups.map((group) => group.replace(/^0+(?=.)/, '')).join(':');
}

export function checkOrigin(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin) return '';
  const allowed = new Set([new URL(request.url).origin]);
  if (env.APP_URL) allowed.add(new URL(requiredEnv(env, 'APP_URL')).origin);
  if (!allowed.has(origin)) throw new AppError('Cross-origin application requests are not allowed.', 403, 'origin_denied');
  return origin;
}

export async function readJson(request) {
  let value;
  try { value = await request.json(); } catch { throw new AppError('Send a valid JSON request body.', 400, 'invalid_json'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Send a JSON object.', 400, 'invalid_json');
  return value;
}

export function cleanSyncData(record) {
  const data = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (CLIENT_ONLY.has(key) || key === 'id' || key === 'updated_at') continue;
    data[key] = value;
  }
  if (JSON.stringify(data).length > MAX_RECORD_BYTES) throw new AppError('That record is too large to sync.', 413, 'record_too_large');
  return data;
}

export function normalizeSecretPayload(body) {
  const question = String(body.question || '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  const answerHash = String(body.answer_hash || '');
  const salt = String(body.salt || '');
  const algorithm = String(body.algorithm || 'PBKDF2-SHA-256');
  const iterations = Number(body.iterations);
  if (!question || question.length > 200) throw new AppError('Enter a secret question.', 400, 'invalid_secret');
  if (algorithm !== 'PBKDF2-SHA-256' || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000) throw new AppError('The secret-answer settings are invalid.', 400, 'invalid_secret');
  try {
    if (base64UrlToBytes(answerHash).length !== 32 || base64UrlToBytes(salt).length < 16) throw new Error('digest');
  } catch { throw new AppError('The secret-answer digest is invalid.', 400, 'invalid_secret'); }
  return { question, answer_hash: answerHash, salt, algorithm, iterations };
}

export async function getSession(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.created_at, u.password_reset_required
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
  if (!row) return null;
  await env.DB.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE token_hash = ?')
    .bind(Math.floor(Date.now() / 1000), tokenHash).run();
  return { user: publicUser(row), tokenHash };
}

export async function requireUser(request, env) {
  const session = await getSession(request, env);
  if (!session) throw new AppError('Sign in to continue.', 401, 'unauthorized');
  return session;
}

/**
 * Addresses exempt from rate limiting, from the comma separated RATE_LIMIT_ALLOWLIST
 * var. Each entry is normalised so that an IPv6 address matches regardless of the
 * hex case or `::` compression used to write it.
 */
function rateLimitAllowlist(env) {
  return String(env.RATE_LIMIT_ALLOWLIST || '')
    .split(',')
    .map((entry) => normalizeIp(entry))
    .filter(Boolean);
}

export async function rateLimit(env, request, bucket, limit, windowSeconds) {
  // The owner's own connection is exempt so a flaky line, a proxy retry loop, or
  // a scripted run can never lock them out of their own app. The address must be
  // Cloudflare-verified, so a forged X-Forwarded-For cannot claim the exemption.
  const ip = normalizeIp(trustedClientIp(request));
  if (ip && rateLimitAllowlist(env).includes(ip)) return;
  if (!env.AUTH_RATE_LIMITER) return;
  const key = `${bucket}:${clientIp(request)}`;
  try {
    const id = env.AUTH_RATE_LIMITER.idFromName(key);
    const response = await env.AUTH_RATE_LIMITER.get(id).fetch('https://rate-limit.internal/', {
      method: 'POST', body: JSON.stringify({ key, limit, windowSeconds })
    });
    const result = await response.json();
    if (!result.allowed) {
      // Surface the real wait so the UI can say "try again in 4 minutes" instead of
      // an open-ended "wait a minute", which is what made this look like a dead app.
      const wait = Math.max(1, Math.ceil(Number(result.retryAfter || 60) / 60));
      throw new AppError(
        `Too many attempts in a short time — please try again in ${wait} minute${wait === 1 ? '' : 's'}.`,
        429,
        'rate_limited'
      );
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    // A limiter outage must not block sign-in, so log loudly and fail open.
    console.error('Rate limiter unavailable; allowing request', error instanceof Error ? error.message : String(error));
  }
}

export async function createSession(env, userId) {
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(await sha256(token), userId, now + SESSION_TTL_SECONDS, now, now).run();
  return token;
}

/**
 * Store a single-use grant, returning the raw value for the caller to hand back
 * to the browser. Only the hash is persisted, so a database leak cannot be
 * replayed as a valid grant.
 */
export async function createToken(env, userId, purpose, ttlSeconds) {
  const token = randomToken(32);
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO auth_tokens (token_hash, user_id, purpose, new_email, expires_at, created_at) VALUES (?, ?, ?, NULL, ?, ?)`
  ).bind(await sha256(token), userId, purpose, now + ttlSeconds, now).run();
  return token;
}

export async function userById(env, id) {
  return env.DB.prepare('SELECT id, email, created_at, password_reset_required FROM users WHERE id = ?').bind(id).first();
}

export function userResponse(row) {
  return publicUser(row);
}
