# OmniStore Production Executor

This Edge Function is disabled by default.

Required controls:

- Exact `PRODUCTION_EXECUTION_ALLOWED_ORIGIN`.
- Authenticated user with `app_metadata.platform_role = erp_owner`.
- Server environment `PRODUCTION_EXECUTION_ALLOWED=true`.
- Explicit initialization and production-mode confirmation.
- Exact per-request execution or rollback confirmation phrase.
- Server-only `SUPABASE_DB_URL`, Supabase secret, executor endpoint map, and executor tokens.

`PRODUCTION_EXECUTOR_ENDPOINTS` maps the ten operation IDs to trusted HTTPS server endpoints. The browser never receives endpoint tokens or service-role credentials. Each executor must implement `prepare`, `execute`, `verify`, `rollback`, and `verifyRollback`.
