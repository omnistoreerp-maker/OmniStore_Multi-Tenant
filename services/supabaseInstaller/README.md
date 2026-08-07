# Phase 26 Real Supabase Installer

This module is the first opt-in real network layer. It performs no request on page load. An administrator must enter the public project configuration, already have an authenticated Supabase session with trusted `app_metadata.role` equal to `owner` or `admin`, click **Validate Connection**, and then confirm **Install Database**.

`DeploymentInstallerBridge` links the Phase 25 Deployment Engine to the real installer without changing the existing deployment engine.

## Security boundary

```text
Browser (URL + anon key + admin JWT)
  → authenticated Edge Function
  → server-only Supabase secrets
  → SUPABASE_DB_URL
  → transactional migrations in schema omnistore
```

The browser never receives the server secret or database URL. The Edge Function accepts one exact origin from `INSTALLER_ALLOWED_ORIGIN`, validates the JWT using Supabase Auth, reads only trusted `app_metadata`, acquires a Postgres advisory lock, verifies migration checksums, and runs pending migrations in a transaction.

## Deployment prerequisites

1. Deploy `supabase/functions/omnistore-installer`.
2. Set `INSTALLER_ALLOWED_ORIGIN` to the exact ERP origin.
3. Confirm the hosted function has `SUPABASE_URL`, `SUPABASE_DB_URL`, and a server secret available through Supabase Edge Function secrets.
4. Create/sign in the installation administrator and set trusted `app_metadata.role` to `owner` or `admin`.
5. Open Reports → Database Installer and validate the connection.
6. Review the snapshot and project target, then confirm Install Database.

No SQL is sent from the browser. The frontend sends only migration IDs/version; SQL is bundled in the Edge Function.

## Installed scope

The isolated `omnistore` schema includes tenancy, business profiles, users/profiles, role and permission templates, tenant roles and permissions, currencies, taxes, branches, customers, suppliers, categories, products, warehouses, inventory transactions, sales, purchases, POS, chart of accounts, journal schema, settings, printing, and audit logs. This phase installs schema only and performs no accounting or inventory posting.
