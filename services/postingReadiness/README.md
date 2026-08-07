# Posting Readiness & Reconciliation Center

Phase 14 adds a read-only readiness layer that evaluates whether OmniStore is safe for real posting in a future phase.

No posting, saving, SQL, Supabase, inventory write, accounting write, or localStorage write is performed.

## Checks

- Missing product costs
- Products without accounting accounts
- Invoices without product links
- Negative stock risks
- Unbalanced preview journals
- Missing customers
- Missing suppliers
- Missing fiscal year
- Missing chart of accounts
- Missing tax accounts
- Missing cash/bank accounts
- Inventory/accounting mismatch risks
- Duplicate document references
- Unsupported operations
- Incomplete business profile accounting configuration

## Output

- Readiness Score
- Critical Errors
- Warnings
- Safe Items
- Required Fixes Before Posting
- Reconciliation Summary
- Risk Level
- Recommended Next Actions
