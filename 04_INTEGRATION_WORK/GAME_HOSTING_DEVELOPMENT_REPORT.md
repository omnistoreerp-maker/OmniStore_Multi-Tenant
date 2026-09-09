# Game Hosting Development Report

## Status: Phase A COMPLETE (recovered 2026-09-05) | Phase B NOT STARTED

### Phase A — Data Layer (recovered commit `d4be68e`)

**Commit:** `feat(game-hosting): Phase A data layer`

- New service: `backend/services/gameHosting.service.js` (414 lines)
- Data model: plans, servers, provisioning requests
- Tenant isolation enforced at every read and write
- Clean API surface for Phase B controller + routes
- 22 tests in `backend/tests/gameHosting.service.test.js` (all passing)

### What Phase A does NOT do (per the handoff plan)

- Does NOT modify `server.js` (no new mounts; routes deferred to Phase B)
- Does NOT modify `permissions/registry.js` (no new permissions)
- Does NOT modify `eventBus.js`
- Does NOT implement real provisioning, billing, or external provider integration
- Does NOT touch existing Market / ERP / PlayStation services

### Ownership chain (documented intent)

```
Customer (auth via marketAuth-style JWT, separate type: 'hosting_customer')
  ↓
Company / Tenant (server-authoritative, from req.tenantContext)
  ↓
Hosting Account (per-tenant, per-customer)
  ↓
Server (per-tenant, per-account)
```

### Phase A test results

| Suite | Tests | Pass |
| --- | --- | --- |
| `tests/gameHosting.service.test.js` | 22 | ✅ |
| `tests/gameHosting.shell.test.js` | 10 | ❌ EXCLUDED (orphan — requires index.html DOM not in remote) |

### Phase B — Required (NOT IMPLEMENTED)

Per the recovery protocol, Phase B must remain behind a backend abstraction:

```
Customer Auth
→ API
→ Ownership
→ Authorization
→ Hosting Account
→ Provisioning Boundary
→ Server Status
→ Billing Boundary
→ Tests
```

Infrastructure/provider behavior must NOT be faked and called production-ready. The provider contract must be defined first, then a real implementation or a clearly-marked stub.

### Frontend

The Game Hosting UI shell (`index.html` `id="page-game-hosting"`) was never committed. The test that validates it (`gameHosting.shell.test.js`) was excluded from the recovery commit because the DOM it expects does not exist on `main`. The frontend shell is a separate workstream.

### Boundaries

- **Game Hosting ≠ PS4 Host.** These are separate workstreams per the recovery protocol.
- Game Hosting is a multi-tenant SaaS product offering.
- PS4 Host is a specific infrastructure integration (Raspberry Pi game server).
- They share some concepts (game catalog) but the catalog is in `ps4Host`/`gamesCatalog` for PS4 and in `gameHosting` for Game Hosting.
