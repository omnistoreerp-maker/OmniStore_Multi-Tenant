# Phase 29 Platform Operations

An isolated, read-only operations package for platform-wide monitoring. Data enters through an injected `readSnapshot()` provider; the package opens no network or database connection itself.

- Health: CPU, memory, storage, database size, workspace, API, Edge Functions, Realtime, Storage, and connection state.
- Backup: schedule, manual, restore, retention, verification, and snapshot previews. Execution is disabled.
- Update: version comparison, release notes, update and rollback previews. Execution is disabled.
- Errors and notifications are normalized in memory only.

The package imports no Accounting, Inventory, POS, Sales, Purchases, Licensing, Provisioning, or Deployment service.
