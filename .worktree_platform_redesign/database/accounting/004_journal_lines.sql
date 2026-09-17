-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: journal voucher lines.

create table if not exists accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  voucher_id uuid not null references accounting_journal_vouchers(id),
  line_number integer not null,
  account_id uuid not null references accounting_chart_of_accounts(id),
  debit numeric(18,4) not null default 0 check (debit >= 0),
  credit numeric(18,4) not null default 0 check (credit >= 0),
  currency text not null default 'EGP',
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  base_debit numeric(18,4) not null default 0 check (base_debit >= 0),
  base_credit numeric(18,4) not null default 0 check (base_credit >= 0),
  branch_id text,
  cost_center_id text,
  project_id text,
  customer_reference text,
  supplier_reference text,
  inventory_transaction_reference text,
  sales_invoice_reference text,
  purchase_invoice_reference text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (voucher_id, line_number),
  check (not (debit > 0 and credit > 0)),
  check (debit > 0 or credit > 0)
);

create index if not exists idx_accounting_lines_voucher on accounting_journal_lines(voucher_id);
create index if not exists idx_accounting_lines_account on accounting_journal_lines(account_id);
create index if not exists idx_accounting_lines_branch on accounting_journal_lines(branch_id);
create index if not exists idx_accounting_lines_cost_center on accounting_journal_lines(cost_center_id);
create index if not exists idx_accounting_lines_project on accounting_journal_lines(project_id);
