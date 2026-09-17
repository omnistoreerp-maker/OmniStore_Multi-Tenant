# Phase 34 Controlled Production Execution

The browser package implements Preview → Validation → Estimate → Confirmation → Execution → Verification → Audit → Rollback Point.

Production Mode begins OFF and is authoritative on the server. Both `PRODUCTION_EXECUTION_ALLOWED=true` and an explicit `erp_owner` mode confirmation are required. Every operation then requires its own request-specific confirmation.

The browser contains only the public anon key and authenticated owner bearer token. Database URLs, Supabase secret keys, executor endpoints, and executor tokens remain server environment values.

The Edge Function delegates ten operation types to trusted server executors implementing `prepare`, `execute`, `verify`, `rollback`, and `verifyRollback`. Idempotency, queue state, errors, duration, audit records, and rollback points are stored in the isolated `omnistore_control` schema.

No executor is configured or called by the test suite. No production mode is enabled during implementation.
