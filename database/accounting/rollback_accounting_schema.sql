-- OmniStore Phase 11 Accounting Persistence Rollback Design
-- DRAFT ONLY. DO NOT EXECUTE AUTOMATICALLY.
-- Drops accounting draft schema objects in dependency-safe order.

drop policy if exists accounting_audit_read_policy on accounting_audit_log;
drop policy if exists accounting_balance_read_policy on accounting_account_balances;
drop policy if exists accounting_line_read_policy on accounting_journal_lines;
drop policy if exists accounting_voucher_read_policy on accounting_journal_vouchers;
drop policy if exists accounting_period_read_policy on accounting_fiscal_periods;
drop policy if exists accounting_fiscal_read_policy on accounting_fiscal_years;
drop policy if exists accounting_coa_read_policy on accounting_chart_of_accounts;

drop table if exists accounting_audit_log;
drop table if exists accounting_account_balances;
drop table if exists accounting_journal_lines;
drop table if exists accounting_journal_vouchers;
drop table if exists accounting_fiscal_periods;
drop table if exists accounting_fiscal_years;
drop table if exists accounting_chart_of_accounts;
