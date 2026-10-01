-- Add the `balanceHistory` store to the CHECK constraint.
--
-- `finance_records` stores every syncable record in one table, discriminated by
-- `store`, so introducing a new client-side store needs a migration even though
-- no new table is created. Without this the CHECK rejects every push for the
-- new store with an integrity error.
--
-- The table is rebuilt rather than edited because SQLite cannot alter a CHECK
-- constraint in place. Every row is carried over unchanged: the new constraint
-- is a strict superset, so all existing store names still satisfy it and no
-- record is lost or rewritten.
CREATE TABLE finance_records_rebuilt (
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store TEXT NOT NULL CHECK (store IN (
    'settings', 'bills', 'commitments', 'netWorthEntries', 'netWorthHistory', 'holdings',
    'portfolioHistory', 'pensions', 'pensionHistory', 'transactions', 'budgets', 'accounts',
    'snapshots', 'balanceHistory'
  )),
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, store, record_id)
);

INSERT INTO finance_records_rebuilt
  (owner_id, store, record_id, data_json, updated_at, deleted, created_at)
  SELECT owner_id, store, record_id, data_json, updated_at, deleted, created_at
    FROM finance_records;

DROP TABLE finance_records;
ALTER TABLE finance_records_rebuilt RENAME TO finance_records;

CREATE INDEX IF NOT EXISTS finance_records_owner_updated_idx ON finance_records(owner_id, updated_at);
CREATE INDEX IF NOT EXISTS finance_records_owner_store_idx ON finance_records(owner_id, store);
