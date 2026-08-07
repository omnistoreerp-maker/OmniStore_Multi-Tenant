# Phase 35 AI Business Copilot

Phase 35 adds the isolated `services/aiCopilot/` package and twelve Analytics pages. No Accounting, Inventory, Sales, Purchases, POS, Posting, business logic, Supabase logic, or Production Mode implementation was changed.

## Architecture

```mermaid
flowchart LR
  P[Injected read-only ERP snapshot] --> C[Business Copilot Engine]
  C --> N[Arabic / English Intent Registry]
  C --> S[Smart Search]
  C --> I[Advisory Insight Engines]
  C --> K[Knowledge and Training]
  C --> H[Read-only Chat]
  C --> R[Advisory Reports]
  G[Security Validator] --> C
```

The package uses no external model, API key, fetch, SQL, Supabase client, write method, posting method, or business-module import.
