-- Credit Cards module (Nov 2026).
-- Data comes only from HDFC emails, pushed in by the Gmail Apps Script
-- (scripts/gmail-card-sync.gs) to /api/cards/ingest. All tables are read and
-- written server-side with the service-role key, so RLS is ON with no
-- policies: the anon key cannot read card data.

create table if not exists cc_cards (
  id bigserial primary key,
  last4 text not null unique,            -- "1947"; EMI/loan rows use a pseudo key like "EMI-DC" / "LOAN-PL"
  name text not null,                    -- "HDFC Swiggy"
  kind text not null default 'card',     -- card | emi | loan
  status text not null default 'active', -- active | closed
  credit_limit numeric,
  monthly_rate numeric not null default 3.75,  -- % per month on revolve
  emi_amount numeric,                    -- for kind emi/loan
  emi_due_day int,                       -- day of month, for kind emi/loan
  annual_fee numeric,
  fee_waiver_spend numeric,
  card_year_start date,
  created_at timestamptz not null default now()
);

create table if not exists cc_transactions (
  id bigserial primary key,
  external_id text not null unique,      -- Gmail message id
  card_last4 text,
  txn_at timestamptz not null,
  amount numeric not null,
  merchant text,
  kind text not null,                    -- purchase | refund | cash | payment | mandate_paid | mandate_upcoming | mandate_declined | bank_debit | bank_credit
  category text,
  bank_balance numeric,                  -- available balance quoted in a savings-account alert, if any
  subject text,
  created_at timestamptz not null default now()
);
create index if not exists cc_transactions_txn_at on cc_transactions (txn_at desc);
create index if not exists cc_transactions_card on cc_transactions (card_last4, txn_at desc);

create table if not exists cc_statements (
  id bigserial primary key,
  external_id text not null unique,      -- Gmail message id, or "manual:<uuid>"
  card_last4 text not null,
  statement_date date,
  due_date date,
  total_due numeric,
  min_due numeric,
  finance_charges numeric,
  fees numeric,
  credit_limit numeric,
  parsed_ok boolean not null default false,
  parse_note text,
  created_at timestamptz not null default now()
);
create index if not exists cc_statements_due on cc_statements (due_date desc);

create table if not exists cc_payments (
  id bigserial primary key,
  external_id text not null unique,      -- Gmail message id, or "manual:<uuid>"
  card_last4 text,
  paid_at timestamptz not null,
  amount numeric not null,
  source text not null default 'email',  -- email | manual
  note text,
  created_at timestamptz not null default now()
);

create table if not exists cc_reminder_log (
  id bigserial primary key,
  dedupe_key text not null unique,       -- e.g. "stmt:12:T-3" or "short:12:2026-12-05"
  sent_at timestamptz not null default now()
);

create table if not exists cc_settings (
  id int primary key default 1,
  spend_cap numeric,
  pdf_password_enc text,                 -- AES-GCM via APP_ENCRYPTION_KEY
  reminder_email text,
  last_sync_at timestamptz,
  constraint cc_settings_single check (id = 1)
);
insert into cc_settings (id) values (1) on conflict (id) do nothing;

alter table cc_cards enable row level security;
alter table cc_transactions enable row level security;
alter table cc_statements enable row level security;
alter table cc_payments enable row level security;
alter table cc_reminder_log enable row level security;
alter table cc_settings enable row level security;

-- Loans & EMIs on the Credit page (Nov 2026). Safe to re-run.
alter table cc_cards
  add column if not exists principal numeric,
  add column if not exists annual_rate numeric,
  add column if not exists tenure_months int,
  add column if not exists first_emi_date date,
  add column if not exists last_emi_date date,
  add column if not exists interest_only boolean not null default false,
  add column if not exists track_from date,          -- dues before this date are history
  add column if not exists note text;
-- status: active | closed | check (confirm it is still running) | pending
alter table cc_statements
  add column if not exists prev_dues numeric,
  add column if not exists payments_received numeric;
