# Multi-Tenant Preview Layer

Phase 24 models shared-project tenant isolation without connecting to a backend. `tenant_id` is required for every tenant-owned entity, while `TenantContext` exists in memory for preview operations only.

Flow: resolve mock tenant → create preview context → map workspace resources → validate schema/RLS isolation → report readiness. No tenant, user, session, or workspace is created.

Future production setup must authenticate an admin, call a protected Edge Function, read secrets only inside the server environment, validate permissions, execute reviewed migrations, record setup logs, and retain tested rollback scripts.
