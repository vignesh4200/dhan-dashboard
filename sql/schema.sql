-- Run this once in the Supabase SQL editor.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  firebase_uid text unique not null,
  phone text unique not null,
  whatsapp_number text,               -- defaults to phone if null, set in Settings
  created_at timestamptz default now()
);

create table if not exists dhan_credentials (
  user_id uuid primary key references users(id) on delete cascade,
  dhan_client_id text not null,
  access_token_encrypted text not null,  -- AES-256-GCM, see lib/crypto.ts
  updated_at timestamptz default now()
);

create table if not exists portfolio_snapshots (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete cascade,
  captured_at timestamptz default now(),
  holdings jsonb not null,           -- array of per-stock computed figures
  total_invested numeric not null,
  total_current numeric not null,
  total_pnl numeric not null,
  day_pnl numeric not null
);
create index if not exists idx_snapshots_user_time on portfolio_snapshots(user_id, captured_at desc);

create table if not exists alert_log (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete cascade,
  symbol text not null,
  tier text not null,                -- 'approach' (7-8%) or 'sell' (8%+)
  pnl_pct numeric not null,
  sent_at timestamptz default now(),
  alert_date date default current_date
);
-- one alert per stock/tier/day so a 15-min job doesn't spam you
create unique index if not exists idx_alert_dedupe on alert_log(user_id, symbol, tier, alert_date);
