# Phase 33 Performance & Scale

Phase 33 adds the isolated `services/performanceScale/` package and ten Reports pages. It does not modify Accounting, Inventory, Sales, Purchases, POS, Posting, Licensing, Authentication, Provisioning, customer data, Supabase data, or business behavior.

## Architecture

```mermaid
flowchart LR
  P[Injected read-only metrics provider] --> E[Performance Scale Engine]
  E --> U[Virtual / Lazy / Chunk / Pagination Plans]
  E --> M[Memory and CPU Snapshots]
  E --> C[Cache / Bundle / Assets]
  E --> D[Database Performance Preview]
  E --> R[Realtime / Network Preview]
  E --> S[100K / 1M Scale Simulation]
  E --> X[Read-only Reports]
```

The package contains no SQL executor, Supabase client, Worker constructor, network connection, cache mutation, database writer, or business-module import.
