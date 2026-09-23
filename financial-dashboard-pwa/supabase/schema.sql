-- =====================================================================
-- Financial Tracking — clean-slate Supabase schema + SCD archive
--
-- Run the WHOLE file once in the Supabase SQL Editor.
--
-- Part 1: drops and recreates the 13 synced tables to match exactly what
--         src/services/syncEngine.js writes:
--           * ids are TEXT (crypto.randomUUID with plain-string fallback)
--           * COLUMN_MAP: currencyCode/currency -> currency_code,
--             dueDay -> due_day, validFrom/validTo/currentFlag/logicalId
--             -> snake_case
--           * pending_sync / synced_at / _deleted stay local, never sent
--           * settings upserts on conflict (owner_id, id)
-- Part 2: record_history — one trigger-fed SCD Type 2 archive capturing
--         every superseded or deleted row from all 13 synced tables.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Eliminate the current structure
-- ---------------------------------------------------------------------
drop table if exists public.settings;
drop table if exists public.bills;
drop table if exists public.commitments;
drop table if exists public.net_worth_entries;
drop table if exists public.net_worth_history;
drop table if exists public.holdings;
drop table if exists public.portfolio_history;
drop table if exists public.pensions;
drop table if exists public.pension_history;
drop table if exists public.transactions;
drop table if exists public.budgets;
drop table if exists public.accounts;
drop table if exists public.snapshots;
drop table if exists public.record_history;
drop function if exists public.touch_updated_at();
drop function if exists public.archive_scd();

-- ---------------------------------------------------------------------
-- 2. Tables (13 — one per IndexedDB store in TABLE_MAP)
-- ---------------------------------------------------------------------

-- settings: local record is { id: <key>, key, value }; id is the setting name
create table public.settings (
  id         text        not null,
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  key        text        not null,
  value      jsonb,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table public.bills (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  category      text,
  amount        numeric     not null,
  due_day       smallint,
  currency_code text,
  updated_at    timestamptz not null default now()
);

-- commitments: named + dated (not due_date / is_recurring)
create table public.commitments (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  date          date,
  amount        numeric     not null,
  currency_code text,
  updated_at    timestamptz not null default now()
);

-- mutable entries carry SCD Type 2 version columns (written by addPosition)
create table public.net_worth_entries (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  institution   text,
  kind          text,
  value         numeric,
  currency_code text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.holdings (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  symbol        text,
  type          text,
  quantity      numeric,
  price         numeric,
  currency_code text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.pensions (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  provider      text,
  value         numeric,
  currency_code text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

-- dated valuation chains (app-managed SCD Type 2 — identical shapes)
create table public.net_worth_history (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  logical_id    text,
  series        text,
  date          date,
  value         numeric,
  currency_code text,
  notes         text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.portfolio_history (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  logical_id    text,
  series        text,
  date          date,
  value         numeric,
  currency_code text,
  notes         text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.pension_history (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  logical_id    text,
  series        text,
  date          date,
  value         numeric,
  currency_code text,
  notes         text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.transactions (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  type          text,
  name          text,
  date          date,
  amount        numeric,
  category      text,
  currency_code text,
  updated_at    timestamptz not null default now()
);

-- budgets: "limit" quoted because LIMIT is reserved in SQL
create table public.budgets (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text        not null,
  "limit"       numeric,
  spent         numeric,
  currency_code text,
  updated_at    timestamptz not null default now()
);

-- legacy/iOS stores still listed in TABLE_MAP (only a backup restore writes them)
create table public.accounts (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  name          text,
  institution   text,
  kind          text,
  value         numeric,
  currency_code text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean     default true,
  updated_at    timestamptz not null default now()
);

create table public.snapshots (
  id            text        not null primary key,
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  type          text,
  series        text,
  symbol        text,
  name          text,
  date          date,
  value         numeric,
  currency_code text,
  growth        numeric,
  notes         text,
  logical_id    text,
  valid_from    date,
  valid_to      date,
  current_flag  boolean,
  updated_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. Indexes — pull uses (owner_id, updated_at > last pull); the rest
--    match list ordering and the sync conflict targets
-- ---------------------------------------------------------------------
create index settings_updated_idx          on public.settings          (owner_id, updated_at desc);
create index bills_owner_due_day_idx       on public.bills             (owner_id, due_day);
create index bills_updated_idx             on public.bills             (owner_id, updated_at desc);
create index commitments_owner_date_idx    on public.commitments       (owner_id, date desc);
create index commitments_updated_idx       on public.commitments       (owner_id, updated_at desc);
create index net_worth_entries_owner_idx   on public.net_worth_entries (owner_id, name);
create index net_worth_entries_updated_idx on public.net_worth_entries (owner_id, updated_at desc);
create index net_worth_history_owner_idx   on public.net_worth_history (owner_id, series, date desc);
create index net_worth_history_updated_idx on public.net_worth_history (owner_id, updated_at desc);
create index holdings_owner_idx            on public.holdings          (owner_id, name);
create index holdings_updated_idx          on public.holdings          (owner_id, updated_at desc);
create index portfolio_history_owner_idx   on public.portfolio_history (owner_id, series, date desc);
create index portfolio_history_updated_idx on public.portfolio_history (owner_id, updated_at desc);
create index pensions_owner_idx            on public.pensions          (owner_id, name);
create index pensions_updated_idx          on public.pensions          (owner_id, updated_at desc);
create index pension_history_owner_idx     on public.pension_history   (owner_id, series, date desc);
create index pension_history_updated_idx   on public.pension_history   (owner_id, updated_at desc);
create index transactions_owner_date_idx   on public.transactions      (owner_id, date desc);
create index transactions_updated_idx      on public.transactions      (owner_id, updated_at desc);
create index budgets_owner_idx             on public.budgets           (owner_id, name);
create index budgets_updated_idx           on public.budgets           (owner_id, updated_at desc);
create index accounts_owner_idx            on public.accounts          (owner_id, name);
create index accounts_updated_idx          on public.accounts          (owner_id, updated_at desc);
create index snapshots_owner_date_idx      on public.snapshots         (owner_id, date desc);
create index snapshots_updated_idx         on public.snapshots         (owner_id, updated_at desc);

-- ---------------------------------------------------------------------
-- 4. Row Level Security — one owner-scoped policy per synced table
--    (the app requires sign-in, so anon reaches nothing)
-- ---------------------------------------------------------------------
alter table public.settings          enable row level security;
alter table public.bills             enable row level security;
alter table public.commitments       enable row level security;
alter table public.net_worth_entries enable row level security;
alter table public.net_worth_history enable row level security;
alter table public.holdings          enable row level security;
alter table public.portfolio_history enable row level security;
alter table public.pensions          enable row level security;
alter table public.pension_history   enable row level security;
alter table public.transactions      enable row level security;
alter table public.budgets           enable row level security;
alter table public.accounts          enable row level security;
alter table public.snapshots         enable row level security;

create policy "own rows" on public.settings          for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.bills             for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.commitments       for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.net_worth_entries for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.net_worth_history for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.holdings          for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.portfolio_history for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.pensions          for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.pension_history   for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.transactions      for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.budgets           for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.accounts          for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "own rows" on public.snapshots         for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

grant usage on schema public to anon, authenticated;
grant select, insert, update, delete
  on all tables in schema public
  to authenticated, service_role;


-- ---------------------------------------------------------------------
-- 5. SCD Type 2 archive — every superseded or deleted row from any synced
--    table lands in record_history. Not in TABLE_MAP: invisible to
--    pull/push, readable for reports, never writable by clients.
--    valid_from = the old version's client updated_at (when it became
--    current per the device); valid_to = DB now() (authoritative
--    supersede time), avoiding client-clock ordering races.
-- ---------------------------------------------------------------------
create table public.record_history (
  id           bigint generated always as identity primary key,
  table_name   text        not null,
  record_id    text        not null,
  owner_id     uuid        not null references auth.users (id) on delete cascade,
  row_data     jsonb       not null,
  valid_from   timestamptz not null,
  valid_to     timestamptz not null default now(),
  current_flag boolean     not null default false,
  operation    text        not null check (operation in ('update', 'delete'))
);

create index record_history_chain_idx
  on public.record_history (table_name, record_id, valid_from desc);
create index record_history_owner_idx
  on public.record_history (owner_id, valid_to desc);

alter table public.record_history enable row level security;
create policy "read own history"
  on public.record_history for select
  to authenticated using (auth.uid() = owner_id);

-- SECURITY DEFINER so the archive write never depends on the caller's
-- grants or RLS; owner is postgres (table owner, no FORCE RLS).
create or replace function public.archive_scd() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into record_history (table_name, record_id, owner_id, row_data, valid_from, operation)
    values (tg_table_name, old.id, old.owner_id, to_jsonb(old),
            coalesce(old.updated_at, now()), 'delete');
    return old;
  end if;
  -- archive only real data changes: ignore no-op re-pushes (updated_at)
  -- and pure valid_to/current_flag chain-close bookkeeping on the
  -- already-SCD valuation tables (their business data doesn't change)
  if (to_jsonb(old) - 'updated_at' - 'valid_to' - 'current_flag')
       is distinct from (to_jsonb(new) - 'updated_at' - 'valid_to' - 'current_flag') then
    insert into record_history (table_name, record_id, owner_id, row_data, valid_from, operation)
    values (tg_table_name, old.id, old.owner_id, to_jsonb(old),
            coalesce(old.updated_at, now()), 'update');
  end if;
  return new;
end; $$;

create trigger settings_scd          before update or delete on public.settings          for each row execute function public.archive_scd();
create trigger bills_scd             before update or delete on public.bills             for each row execute function public.archive_scd();
create trigger commitments_scd       before update or delete on public.commitments       for each row execute function public.archive_scd();
create trigger net_worth_entries_scd before update or delete on public.net_worth_entries for each row execute function public.archive_scd();
create trigger net_worth_history_scd before update or delete on public.net_worth_history for each row execute function public.archive_scd();
create trigger holdings_scd          before update or delete on public.holdings          for each row execute function public.archive_scd();
create trigger portfolio_history_scd before update or delete on public.portfolio_history for each row execute function public.archive_scd();
create trigger pensions_scd          before update or delete on public.pensions          for each row execute function public.archive_scd();
create trigger pension_history_scd   before update or delete on public.pension_history   for each row execute function public.archive_scd();
create trigger transactions_scd      before update or delete on public.transactions      for each row execute function public.archive_scd();
create trigger budgets_scd           before update or delete on public.budgets           for each row execute function public.archive_scd();
create trigger accounts_scd          before update or delete on public.accounts          for each row execute function public.archive_scd();
create trigger snapshots_scd         before update or delete on public.snapshots         for each row execute function public.archive_scd();

-- the archive is read-only for clients: take write privileges back after
-- the blanket grants above (the definer function runs as postgres)
revoke insert, update, delete on public.record_history from anon, authenticated;

commit;

-- ---------------------------------------------------------------------
-- 6. Verify — expect 14 tables (13 synced + record_history),
--    14 policies (13 "own rows" + "read own history"), 13 *_scd triggers
-- ---------------------------------------------------------------------
select table_name from information_schema.tables
 where table_schema = 'public' order by 1;

select tablename, policyname from pg_policies
 where schemaname = 'public' order by tablename;

select tgname from pg_trigger
 where not tgisinternal and tgname like '%\_scd' escape '\'
 order by 1;

