# Phase 27 Real Customer Provisioning

Phase 27 provisions a customer only through the validated Phase 26 installer connection.

Flow:

```text
Authenticated Admin → confirmation → Edge Function → ensure migrations
→ create Auth owner → tenant transaction → workspace/default data/RLS namespace
→ activate workspace → return login URL and one-time workspace API key
```

The implementation preserves the shared `omnistore` schema chosen in Phase 24. Each customer owns a logical workspace identified by immutable `tenant_id`; RLS policies and trusted JWT `app_metadata.tenant_id` isolate all settings, users, roles, products, inventory, POS, accounting schema, reports, and audit data.

The owner password is sent only to the authenticated Edge Function over HTTPS and is never returned or persisted by the browser. Workspace API secrets are stored only as SHA-256 hashes and returned once to the administrator.

Customer deletion requires an exact tenant-specific confirmation and deletes exactly one tenant row; cascading foreign keys remove only that tenant’s data. Provision and workspace audit records remain for server-side accountability.
