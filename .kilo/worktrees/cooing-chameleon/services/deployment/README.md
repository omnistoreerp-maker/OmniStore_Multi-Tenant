# Phase 25 Deployment Engine

Phase 25 prepares a one-button customer deployment pipeline while keeping real invocation disabled.

## Production boundary

```text
Browser → authenticated owner/admin → Edge Function → server-only privileged credential
        → schema/RLS transaction → tenant bootstrap → default data → redacted result
```

The browser receives only the public project URL, anonymous key, and Edge Function URL in the future activation phase. It never receives the privileged server credential or raw executable SQL.

## Current behavior

- Validates customer fields and administrator context.
- Discards password input immediately after validation; no password is returned or stored.
- Generates deployment, schema, RLS, bootstrap, seed, report, and rollback plans.
- Simulates the Edge Function request.
- Creates no tenant, user, session, table, or data.

Phase 26 can activate the transport by supplying `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `EDGE_FUNCTION_URL` to a reviewed adapter. Real invocation remains subject to authenticated admin authorization and server-side validation.
