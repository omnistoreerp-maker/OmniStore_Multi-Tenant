# Supabase Setup Preview Guide

Phase 24 prepares a reviewable installation plan; it does not connect to Supabase or execute the draft files.

## Future controlled flow

1. Review and version every SQL draft.
2. Back up the target environment and test rollback in an isolated project.
3. Authenticate an owner/admin.
4. Call an admin-only Edge Function.
5. Validate the admin permission inside the function.
6. Read privileged credentials from server-managed secrets only.
7. Verify migration checksums, execute one reviewed transaction, and record a redacted setup log.
8. Run tenant-isolation tests before provisioning customers.

Never put Supabase service_role key inside frontend code. The current browser UI only displays plans and comments.
