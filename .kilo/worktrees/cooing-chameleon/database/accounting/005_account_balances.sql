-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: account balances by fiscal period, branch, cost center, project, and currency.

create table if not exists accounting_account_balances (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounting_chart_of_accounts(id),
  fiscal_year_id uuid references accounting_fiscal_years(id),
  fiscal_period_id uuid references accounting_fiscal_periods(id),
  branch_id text,
  cost_center_id text,
  project_id text,
  currency text not null default 'EGP',
  opening_balance numeric(18,4) not null default 0,
  debit_total numeric(18,4) not null default 0,
  credit_total numeric(18,4) not null default 0,
  closing_balance numeric(18,4) not null default 0,
  last_posted_voucher_id uuid references accounting_journal_vouchers(id),
  calculated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, fiscal_year_id, fiscal_period_id, branch_id, cost_center_id, project_id, currency)
);

create index if not exists idx_accounting_balances_account on accounting_account_balances(account_id);
create index if not exists idx_accounting_balances_period on accounting_account_balances(fiscal_year_id, fiscal_period_id);
