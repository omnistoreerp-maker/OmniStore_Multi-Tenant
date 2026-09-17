# Supabase Execution Guide — Future Manual Step

Do not execute Phase 11 automatically.

When execution is authorized in a future phase:

1. Create a full database backup.
2. Review every file in `database/accounting/`.
3. Execute drafts manually in order:
   - `001_chart_of_accounts.sql`
   - `002_fiscal_years_periods.sql`
   - `003_journal_vouchers.sql`
   - `004_journal_lines.sql`
   - `005_account_balances.sql`
   - `006_audit_log.sql`
   - `007_permissions_rls.sql`
4. Verify RLS policies with test roles.
5. Run a dry-run posting mapper before enabling real posting.
6. Keep posting disabled until business owner approval.

Rollback, if approved, uses:

- `database/accounting/rollback_accounting_schema.sql`
