-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: fiscal years and fiscal periods.

create table if not exists accounting_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_code text not null unique,
  fiscal_year_name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by text,
  reopened_at timestamptz,
  reopened_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_date <= end_date)
);

create table if not exists accounting_fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  fiscal_year_id uuid not null references accounting_fiscal_years(id),
  period_code text not null,
  period_name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed')),
  closed_at timestamptz,
  closed_by text,
  reopened_at timestamptz,
  reopened_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (fiscal_year_id, period_code),
  check (start_date <= end_date)
);

create index if not exists idx_accounting_periods_year on accounting_fiscal_periods(fiscal_year_id);
create index if not exists idx_accounting_periods_dates on accounting_fiscal_periods(start_date, end_date);
