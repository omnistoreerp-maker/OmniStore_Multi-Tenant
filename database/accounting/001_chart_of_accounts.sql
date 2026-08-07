-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: chart of accounts structure for future accounting posting.

create table if not exists accounting_chart_of_accounts (
  id uuid primary key default gen_random_uuid(),
  account_code text not null unique,
  account_name text not null,
  account_name_ar text,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','cost_of_sales','expense','other_income','other_expense')),
  account_group text not null,
  account_category text,
  parent_account_id uuid references accounting_chart_of_accounts(id),
  normal_side text not null check (normal_side in ('debit','credit')),
  currency text default 'EGP',
  branch_id text,
  cost_center_id text,
  project_id text,
  customer_reference text,
  supplier_reference text,
  inventory_account boolean default false,
  cash_account boolean default false,
  bank_account boolean default false,
  tax_account boolean default false,
  discount_account boolean default false,
  is_active boolean not null default true,
  is_read_only boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_accounting_coa_type on accounting_chart_of_accounts(account_type);
create index if not exists idx_accounting_coa_parent on accounting_chart_of_accounts(parent_account_id);
create index if not exists idx_accounting_coa_branch on accounting_chart_of_accounts(branch_id);
