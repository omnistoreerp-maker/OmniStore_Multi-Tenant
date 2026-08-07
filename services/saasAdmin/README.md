# Phase 28 SaaS Administration

This package is independent from POS, Sales, Purchases, Inventory, Accounting and Customer Provisioning.

The browser connects only after an ERP platform owner enters the public Supabase configuration. The server validates `app_metadata.platform_role = erp_owner`; a tenant `owner` role is not sufficient.

The separate `omnistore_admin` schema stores plan definitions, configurable limits, hashed licenses, subscriptions, billing previews, metrics, notification previews, and audit history. It has RLS enabled with no direct browser policies, so all access goes through the platform-owner Edge Function.

License keys are generated server-side, stored only as SHA-256 hashes, and returned once. Billing remains preview-only and has no payment gateway.

## Runtime flow

1. The platform owner opens **SaaS Administration Center** and enters the public URL, anon key, Edge Function URL, and project name.
2. The existing Supabase session is read in memory. The browser requires `platform_role = erp_owner`.
3. The Edge Function verifies the bearer token again with Supabase Auth and rejects tenant owners.
4. Server secrets and the PostgreSQL connection remain Edge Function environment variables.
5. Customer status, plans, licenses, usage, and reports are handled in the separate `omnistore_admin` schema.

The browser never receives `service_role` or the database URL. Configuration is not written to localStorage, cookies, or IndexedDB. Customer provisioning code is not imported or changed.

## Plans and limits

Supported plans are Trial, Monthly, Quarterly, Yearly, Lifetime, and Custom. Each plan can define limits for users, branches, warehouses, POS devices, products, customers, suppliers, invoices, and storage bytes.

## Deployment

Deploy `supabase/functions/omnistore-saas-admin` through the existing protected server deployment workflow, then set `SUPABASE_URL`, one server secret key variable, `SUPABASE_DB_URL`, `SAAS_ADMIN_ALLOWED_ORIGIN`, and optionally `APP_PASSWORD_RESET_URL`. Grant `app_metadata.platform_role = erp_owner` only through a trusted server-side administrator process.
