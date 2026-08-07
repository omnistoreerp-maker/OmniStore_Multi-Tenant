# Accounting Persistence Schema Draft

Phase 11 prepares a future accounting persistence schema for OmniStore.

These files are draft migration designs only. They are not imported by the app and must not be executed automatically.

## Files

- `001_chart_of_accounts.sql`
- `002_fiscal_years_periods.sql`
- `003_journal_vouchers.sql`
- `004_journal_lines.sql`
- `005_account_balances.sql`
- `006_audit_log.sql`
- `007_permissions_rls.sql`
- `rollback_accounting_schema.sql`

## Supported Data Model

- Chart of accounts
- Fiscal years
- Fiscal periods
- Journal vouchers
- Journal lines
- Posting status
- Reverse vouchers
- Audit log
- Branch
- Cost center
- Project
- Currency
- Exchange rate
- Customer reference
- Supplier reference
- Inventory transaction reference
- Sales invoice reference
- Purchase invoice reference

## Safety Boundary

Do not run these files until a manual Supabase execution review is completed.
