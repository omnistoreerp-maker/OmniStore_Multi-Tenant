-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: journal voucher headers and posting/reversal references.

create table if not exists accounting_journal_vouchers (
  id uuid primary key default gen_random_uuid(),
  voucher_number text not null unique,
  voucher_type text not null,
  posting_date date not null,
  fiscal_year_id uuid references accounting_fiscal_years(id),
  fiscal_period_id uuid references accounting_fiscal_periods(id),
  reference text,
  description text,
  posting_status text not null default 'draft' check (posting_status in ('draft','posted','unposted','reversed','void')),
  business_type text default 'computer_shop',
  branch_id text,
  cost_center_id text,
  project_id text,
  currency text not null default 'EGP',
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  customer_reference text,
  supplier_reference text,
  inventory_transaction_reference text,
  sales_invoice_reference text,
  purchase_invoice_reference text,
  reversed_from_voucher_id uuid references accounting_journal_vouchers(id),
  reversal_voucher_id uuid references accounting_journal_vouchers(id),
  posted_at timestamptz,
  posted_by text,
  unposted_at timestamptz,
  unposted_by text,
  reversed_at timestamptz,
  reversed_by text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by text,
  updated_at timestamptz not null default now(),
  updated_by text
);

create index if not exists idx_accounting_vouchers_posting_date on accounting_journal_vouchers(posting_date);
create index if not exists idx_accounting_vouchers_status on accounting_journal_vouchers(posting_status);
create index if not exists idx_accounting_vouchers_sales_ref on accounting_journal_vouchers(sales_invoice_reference);
create index if not exists idx_accounting_vouchers_purchase_ref on accounting_journal_vouchers(purchase_invoice_reference);
create index if not exists idx_accounting_vouchers_inventory_ref on accounting_journal_vouchers(inventory_transaction_reference);
