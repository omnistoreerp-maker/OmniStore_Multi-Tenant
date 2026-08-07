# Supabase RLS Security Report

Required controls for future activation:

- Enable RLS on every tenant-owned table.
- Compare each row's `tenant_id` with a trusted authenticated tenant claim.
- Apply isolation to select, insert, update, and delete.
- Validate role permissions for owner, admin, manager, accountant, and cashier.
- Reject tenant IDs supplied only by untrusted request bodies.
- Keep privileged secrets in server-managed configuration.
- Verify composite foreign keys never cross tenants.
- Test positive and negative isolation scenarios before production.

The supplied RLS file is a draft pattern and is not complete production authorization.
