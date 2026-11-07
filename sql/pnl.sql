-- Realized P&L page (/dashboard/pnl, /api/pnl).
-- Run once in the Supabase SQL editor.
--
-- Caches the raw equity trade history from Dhan's paginated Trade History
-- API, so the P&L page doesn't re-download years of trades on every visit.
-- /api/pnl tops it up incrementally (last few days) when older than 6h.
create table if not exists trade_history_cache (
  user_id uuid primary key references users(id) on delete cascade,
  trades jsonb not null default '[]'::jsonb,
  history_from date,
  fetched_at timestamptz not null default now()
);
alter table trade_history_cache enable row level security;

-- Resumable sync: how far the history backfill has reached (applied Nov 2026).
alter table trade_history_cache add column if not exists synced_to date;

-- Saved cost for shares Dhan credits as ₹0 BUYs (IPO allotments, transfers
-- in), keyed by ISIN + credit date. Edited from the P&L page's Tax
-- statement tab via /api/pnl/cost-basis. (Applied Nov 2026.)
create table if not exists cost_basis_overrides (
  user_id uuid not null references users(id) on delete cascade,
  isin text not null,
  credit_date date not null,
  price numeric not null check (price >= 0),
  note text,
  updated_at timestamptz not null default now(),
  primary key (user_id, isin, credit_date)
);
alter table cost_basis_overrides enable row level security;
