-- Remove email delivery. Authentication is fully in-session.
--
-- The app no longer sends any email, so every flow that depended on a link
-- delivered to an inbox is gone:
--   * signup confirmation    -> the account is usable immediately
--   * password reset by link -> replaced by recovery with a secret answer
--   * email-change confirmation -> the address changes once the current
--     password is supplied
--
-- `auth_tokens` is rebuilt to carry only `recovery` grants, which are handed
-- back to the browser in the same response that verified the secret answer
-- rather than being emailed. The table is rebuilt rather than edited because
-- SQLite cannot alter a CHECK constraint in place.

CREATE TABLE auth_tokens_recovery (
  token_hash   TEXT PRIMARY KEY NOT NULL,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL CHECK (purpose = 'recovery'),
  new_email    TEXT,
  expires_at   INTEGER NOT NULL,
  consumed_at  INTEGER,
  created_at   INTEGER NOT NULL
);

-- Reset links already sent to inboxes stay valid, so those rows are carried over.
INSERT INTO auth_tokens_recovery (token_hash, user_id, purpose, new_email, expires_at, consumed_at, created_at)
  SELECT token_hash, user_id, purpose, new_email, expires_at, consumed_at, created_at
    FROM auth_tokens WHERE purpose = 'password_reset';

DROP TABLE auth_tokens;
ALTER TABLE auth_tokens_recovery RENAME TO auth_tokens;

CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens(expires_at);

-- Mail delivery health only existed to diagnose the mail provider.
DROP TABLE IF EXISTS service_health;

-- Email is now purely a login identifier, so it has no verified/unverified state.
ALTER TABLE users DROP COLUMN email_verified_at;
