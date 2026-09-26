-- Application-owned authentication, account metadata, and finance sync.
-- This database is managed by the Cloudflare Worker; Supabase Auth is not involved.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_algorithm TEXT NOT NULL,
  password_iterations INTEGER NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  email_verified_at TEXT,
  password_reset_required INTEGER NOT NULL DEFAULT 0 CHECK (password_reset_required IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL CHECK (purpose IN ('signup', 'password_reset', 'email_change')),
  new_email TEXT,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens(user_id, purpose);
CREATE INDEX IF NOT EXISTS auth_tokens_expiry_idx ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS account_secrets (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question TEXT NOT NULL CHECK (length(trim(question)) BETWEEN 1 AND 200),
  answer_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'PBKDF2-SHA-256'),
  iterations INTEGER NOT NULL CHECK (iterations BETWEEN 100000 AND 1000000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS account_secrets_owner_idx ON account_secrets(owner_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS account_secrets_owner_question_idx ON account_secrets(owner_id, lower(question));

CREATE TABLE IF NOT EXISTS finance_records (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN (
    'settings', 'bills', 'commitments', 'netWorthEntries', 'netWorthHistory', 'holdings',
    'portfolioHistory', 'pensions', 'pensionHistory', 'transactions', 'budgets', 'accounts', 'snapshots'
  )),
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, store, record_id)
);
CREATE INDEX IF NOT EXISTS finance_records_owner_updated_idx ON finance_records(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS finance_records_owner_store_idx ON finance_records(owner_id, store);
