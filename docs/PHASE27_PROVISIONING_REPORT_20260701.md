# Phase 27 Provisioning Flow

1. Validate a Phase 26 Supabase connection and authenticated owner/admin.
2. Validate customer fields and explicit confirmation.
3. Ensure server migrations through version `20260701.002`.
4. Generate tenant/workspace IDs and a hashed API credential.
5. Create the owner through the server-only Auth Admin API.
6. Insert the tenant, workspace and defaults in one Postgres transaction.
7. Activate the workspace.
8. Return tenant ID, workspace ID, login URL, versions, setup report and one-time API key.

Provision requests use an idempotency UUID. Retrying a completed request does not duplicate the customer.
