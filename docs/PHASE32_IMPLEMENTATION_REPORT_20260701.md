# Phase 32 Recovery Platform

Phase 32 adds the isolated `services/recoveryPlatform/` package and nine administration pages. No Accounting, Inventory, Sales, Purchases, POS, Posting, business logic, customer data, Supabase data, Authentication, Licensing, or Provisioning implementation was changed.

## Architecture

```mermaid
flowchart LR
  P[Read-only recovery snapshot provider] --> E[Recovery Platform Engine]
  E --> B[Backup Preview Engine]
  E --> R[Restore Compare and Validation]
  E --> U[Update Compatibility Preview]
  E --> V[Version and Snapshot Browser]
  E --> H[Recovery Health]
  E --> A[In-memory Audit Preview]
  E --> X[Read-only Reports]
```

There is no backup writer, restore executor, update installer, SQL executor, Supabase client, file writer, or customer-data mutation path.
