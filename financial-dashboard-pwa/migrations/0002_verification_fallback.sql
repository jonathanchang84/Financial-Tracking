-- Observability for the mail provider.
--
-- Superseded by `0003_remove_email.sql`, which drops this table along with the
-- rest of the mail pipeline. It is left unchanged because this migration has
-- already been applied to production and Wrangler tracks migrations by name.

CREATE TABLE IF NOT EXISTS service_health (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
