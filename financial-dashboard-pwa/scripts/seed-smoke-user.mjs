/**
 * Local smoke-test seeding helper (development only).
 *
 * Creates a test user plus a known single-use recovery grant so the Worker's
 * in-session recovery flow can be exercised without going through the UI. The
 * raw token is written to stdout as JSON for the caller to use.
 *
 * This exists because the app sends no email: there is no mailbox to click a
 * link in, so a recovery grant has to be produced deliberately for testing.
 */
import { randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const token = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('base64url');

const recoveryToken = token();
const userId = randomBytes(12).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const nowIso = new Date().toISOString();
// Unique per run so repeated smoke tests never collide on a previous run's address.
const currentEmail = `flow-${userId.toLowerCase().slice(0, 8)}@example.com`;

const sql = `
INSERT OR REPLACE INTO users
  (id, email, password_algorithm, password_iterations, password_salt, password_hash,
   password_reset_required, created_at, updated_at)
VALUES ('${userId}', '${currentEmail}', 'PBKDF2-SHA-256', 100000,
        'AAAAAAAAAAAAAAAAAAAAAA', 'placeholder-hash', 0, '${nowIso}', '${nowIso}');

INSERT OR REPLACE INTO auth_tokens
  (token_hash, user_id, purpose, new_email, expires_at, consumed_at, created_at)
VALUES
  ('${hash(recoveryToken)}', '${userId}', 'recovery', NULL, ${now + 900}, NULL, ${now});
`;

writeFileSync('/tmp/seed-smoke.sql', sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'financial-tracking', '--local', '--file', '/tmp/seed-smoke.sql'], {
  stdio: 'ignore'
});

console.log(JSON.stringify({ userId, recoveryToken, currentEmail }));
