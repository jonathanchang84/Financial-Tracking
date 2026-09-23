-- Financial dashboard schema for the Supabase free tier.
-- Apply in the SQL editor. The anon key is safe only because RLS restricts every row to auth.uid().

create extension if not exists pgcrypto;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Generic shape used by every entity table. History tables add SCD Type 2 columns.
-- owner_id must equal auth.uid() on insert/update (set by the client from the session, enforced here).

create table if not exists public.net_worth_entries (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  institution text default '',
  kind text default 'Asset',
  value numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.net_worth_history (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  logical_id uuid not null,
  series text not null,
  date date not null,
  value numeric not null default 0,
  currency_code text not null default 'USD',
  valid_from date,
  valid_to date,
  current_flag boolean not null default true,
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.holdings (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  symbol text default '',
  type text default 'Fund',
  quantity numeric not null default 0,
  price numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.portfolio_history (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  logical_id uuid not null,
  series text not null,
  date date not null,
  value numeric not null default 0,
  currency_code text not null default 'USD',
  valid_from date,
  valid_to date,
  current_flag boolean not null default true,
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.pensions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text default '',
  value numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.pension_history (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  logical_id uuid not null,
  series text not null,
  date date not null,
  value numeric not null default 0,
  currency_code text not null default 'USD',
  valid_from date,
  valid_to date,
  current_flag boolean not null default true,
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.bills (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  category text default '',
  amount numeric not null default 0,
  currency_code text not null default 'USD',
  due_day int not null default 1,
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.commitments (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  date date,
  amount numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.transactions (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null default 'expense',
  name text default '',
  category text default '',
  date date,
  amount numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.budgets (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  "limit" numeric not null default 0,
  spent numeric not null default 0,
  currency_code text not null default 'USD',
  pending_sync boolean default false,
  updated_at timestamptz default now()
);

create table if not exists public.settings (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb,
  pending_sync boolean default false,
  updated_at timestamptz default now()


-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table public.net_worth_entries enable row level security;
alter table public.net_worth_history enable row level security;
alter table public.holdings enable row level security;
alter table public.portfolio_history enable row level security;
alter table public.pensions enable row level security;
alter table public.pension_history enable row level security;
alter table public.bills enable row level security;
alter table public.commitments enable row level security;
alter table public.transactions enable row level security;
alter table public.budgets enable row level security;
alter table public.settings enable row level security;

create policy "authenticated users may read their own net_worth_entries"
on public.net_worth_entries for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own net_worth_entries"
on public.net_worth_entries for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own net_worth_history"
on public.net_worth_history for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own net_worth_history"
on public.net_worth_history for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own holdings"
on public.holdings for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own holdings"
on public.holdings for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own portfolio_history"
on public.portfolio_history for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own portfolio_history"
on public.portfolio_history for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own pensions"
on public.pensions for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own pensions"
on public.pensions for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own pension_history"
on public.pension_history for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own pension_history"
on public.pension_history for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own bills"
on public.bills for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own bills"
on public.bills for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own commitments"
on public.commitments for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own commitments"
on public.commitments for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own transactions"
on public.transactions for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own transactions"
on public.transactions for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own budgets"
on public.budgets for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own budgets"
on public.budgets for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

create policy "authenticated users may read their own settings"
on public.settings for select
to authenticated using (auth.uid() = owner_id);

create policy "authenticated users may manage their own settings"
on public.settings for all
to authenticated using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_net_worth_entries_owner on public.net_worth_entries(owner_id);
create index if not exists idx_net_worth_history_owner_current on public.net_worth_history(owner_id, current_flag);
create index if not exists idx_holdings_owner on public.holdings(owner_id);
create index if not exists idx_portfolio_history_owner_current on public.portfolio_history(owner_id, current_flag);
create index if not exists idx_pensions_owner on public.pensions(owner_id);
create index if not exists idx_pension_history_owner_current on public.pension_history(owner_id, current_flag);
create index if not exists idx_bills_owner on public.bills(owner_id);
create index if not exists idx_commitments_owner on public.commitments(owner_id);
create index if not exists idx_transactions_owner on public.transactions(owner_id);
create index if not exists idx_budgets_owner on public.budgets(owner_id);
create index if not exists idx_settings_owner_key on public.settings(owner_id, key);

);
