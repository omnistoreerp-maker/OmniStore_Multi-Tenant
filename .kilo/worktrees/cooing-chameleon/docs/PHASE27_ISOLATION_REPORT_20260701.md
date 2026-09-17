# Phase 27 Workspace Isolation

All customer data remains in the shared `omnistore` schema selected in Phase 24 and is logically isolated by immutable `tenant_id`.

- Trusted Auth `app_metadata` carries `tenant_id`, `workspace_id`, and role.
- 34 tenant-owned tables plus the root `tenants` table enable RLS.
- Each table has select, insert, update and delete tenant policies.
- Workspace health verifies tenant columns, RLS tables, policies, owner, roles, warehouse, and accounts.
- Tenant API credentials, provisioning history, and workspace audit are restricted to tenant owner/admin roles.
- Tenant deletion targets exactly one tenant primary key and relies on tenant-scoped cascading foreign keys.
- History and audit records remain server-readable after deletion.

No customer receives another customer’s API credential or workspace identifier.
