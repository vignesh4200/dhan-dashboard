-- On-demand Analyst Desk reports (run once in the Supabase SQL editor).
-- One row per report you request from /dashboard/analyst-desk.

create table if not exists analyst_desk_reports (
  id bigint generated always as identity primary key,
  user_id uuid references users(id) on delete cascade,
  symbol text not null,
  company text,
  status text not null default 'running',   -- 'running' | 'done' | 'error'
  decision text,                            -- BUY | ACCUMULATE | HOLD | AVOID | SELL
  conviction numeric,                       -- 0-100
  current_price numeric,
  fair_value_low numeric,
  fair_value_high numeric,
  horizon text,
  summary text,
  report_markdown text,
  sources jsonb,
  model text,
  error text,
  created_at timestamptz default now(),
  completed_at timestamptz
);
create index if not exists idx_desk_reports_user_time on analyst_desk_reports(user_id, created_at desc);
