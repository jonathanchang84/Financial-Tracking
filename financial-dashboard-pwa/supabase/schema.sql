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
);
