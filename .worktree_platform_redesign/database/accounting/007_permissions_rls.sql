-- OmniStore Phase 11 Accounting Persistence Schema Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Purpose: future RLS and permissions policy drafts.

alter table accounting_chart_of_accounts enable row level security;
alter table accounting_fiscal_years enable row level security;
alter table accounting_fiscal_periods enable row level security;
alter table accounting_journal_vouchers enable row level security;
alter table accounting_journal_lines enable row level security;
alter table accounting_account_balances enable row level security;
alter table accounting_audit_log enable row level security;

create policy accounting_coa_read_policy on accounting_chart_of_accounts
  for select using (true);

create policy accounting_fiscal_read_policy on accounting_fiscal_years
  for select using (true);

create policy accounting_period_read_policy on accounting_fiscal_periods
  for select using (true);

create policy accounting_voucher_read_policy on accounting_journal_vouchers
  for select using (true);

create policy accounting_line_read_policy on accounting_journal_lines
  for select using (true);

create policy accounting_balance_read_policy on accounting_account_balances
  for select using (true);

create policy accounting_audit_read_policy on accounting_audit_log
  for select using (true);

-- Future write policies must be restricted to Owner/Admin/Accountant service roles.
-- This draft intentionally does not grant insert/update/delete policies.
