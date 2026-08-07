# Phase 26 Migration Summary

Current version after Phase 27 extension: `20260701.002`

1. Core tenancy, installer metadata, profiles, role and permission templates.
2. ERP tables for business profiles, users, taxes, customers, suppliers, products, warehouses, inventory, sales, purchases, POS, accounting schema, settings, printing, currencies, branches, and audit logs.
3. Indexes, tenant helper functions, update triggers, and four RLS policies for every tenant table.
4. Default roles, permissions, currencies, and configuration templates.
5. Customer workspaces, subscriptions, tenant API credential hashes, cashboxes, report settings, storage usage, provision history, and workspace audit.

Migrations are bundled server-side in the Edge Function. The browser sends only migration identifiers and the expected version.
