-- ============================================================
-- Replenish Autopilot — Supabase schema + RLS  (8 tables)
-- Paste into Supabase SQL Editor, or: supabase db push
-- ============================================================
create extension if not exists "pgcrypto";

-- 1. users — RLS owner; id maps to auth.uid()
create table if not exists public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

-- 2. consumables — the minimized reorder signal (ONLY thing stored about you)
create table if not exists public.consumables (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  product_key    text not null,
  cadence_days   int  not null,
  last_delivery  date,
  est_empty_date date,
  source         text not null default 'recharge',
  created_at     timestamptz not null default now()
);

-- 3. shops — configured shops the agent may buy from
create table if not exists public.shops (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  name       text not null,
  base_url   text not null,
  scope      text not null default 'consumables',
  created_at timestamptz not null default now()
);

-- 4. price_findings — cross-shop comparison log (time-boxed retention)
create table if not exists public.price_findings (
  id            uuid primary key default gen_random_uuid(),
  consumable_id uuid not null references public.consumables(id) on delete cascade,
  shop_id       uuid not null references public.shops(id) on delete cascade,
  price         numeric(10,2) not null,
  currency      text not null default 'GBP',
  in_stock      boolean not null default true,
  evidence_url  text,            -- Tavily source
  found_at      timestamptz not null default now()
);

-- 5. spend_tokens — scoped spend authority (the guardrail)
create table if not exists public.spend_tokens (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  shop_id        uuid not null references public.shops(id) on delete cascade,
  max_amount     numeric(10,2) not null,
  category_scope text not null default 'consumables',
  issued_at      timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  status         text not null default 'active'   -- active | revoked | expired
);

-- 6. orders — real orders placed (Shopify ref)
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  consumable_id uuid not null references public.consumables(id) on delete cascade,
  shop_id       uuid not null references public.shops(id) on delete cascade,
  amount        numeric(10,2) not null,
  token_id      uuid references public.spend_tokens(id),
  order_ref     text,            -- Shopify order id
  placed_at     timestamptz not null default now()
);

-- 7. audit_log — the explainability trail powering the privacy panel
create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  action     text not null,
  inputs     jsonb,
  options    jsonb,
  choice     text,
  reason     text,
  created_at timestamptz not null default now()
);

-- 8. consent — opt-in per category + kill switch state
create table if not exists public.consent (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  category   text not null,
  granted    boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- ============================================================
-- RLS: every row scoped to its owner (auth.uid() = user_id)
-- ============================================================
alter table public.users          enable row level security;
alter table public.consumables    enable row level security;
alter table public.shops          enable row level security;
alter table public.price_findings enable row level security;
alter table public.spend_tokens   enable row level security;
alter table public.orders         enable row level security;
alter table public.audit_log      enable row level security;
alter table public.consent        enable row level security;

create policy "users_owner" on public.users
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "consumables_owner" on public.consumables
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "shops_owner" on public.shops
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- price_findings has no direct user_id (per the frozen contract),
-- so ownership is derived through the parent consumable.
create policy "price_findings_owner" on public.price_findings
  for all using (auth.uid() = (select user_id from consumables c where c.id = consumable_id))
  with check (auth.uid() = (select user_id from consumables c where c.id = consumable_id));

create policy "spend_tokens_owner" on public.spend_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "orders_owner" on public.orders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "audit_log_owner" on public.audit_log
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "consent_owner" on public.consent
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
