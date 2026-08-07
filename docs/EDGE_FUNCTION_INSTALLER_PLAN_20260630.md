# Edge Function Installer Plan

The future installer is an admin-only server operation:

1. Authenticate the caller.
2. Resolve the caller's trusted role and require owner/admin.
3. Load privileged credentials only from Supabase server secrets.
4. Verify approved migration versions and checksums.
5. execute the reviewed setup transaction with a strict timeout.
6. Record redacted setup status and migration versions.
7. Return no secret material.
8. Run health and RLS isolation checks.
9. If validation fails, use the reviewed rollback plan.

No Edge Function, API request, SQL execution, or secret is implemented in Phase 24.
