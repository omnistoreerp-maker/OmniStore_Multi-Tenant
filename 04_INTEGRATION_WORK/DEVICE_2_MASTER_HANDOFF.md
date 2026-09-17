# Device 2 — Master Handoff

## RECOVERY NOTE

**Date:** 2026-09-05
**Authoritative remote:** `https://github.com/omnistoreerp-maker/OmniStore_Multi-Tenant.git`
**Recovery clone path:** `C:\Users\ZBOOK G6\Desktop\OmniStore_Device2_RECOVERY`
**Recovered branch:** `device-2/marketplace-gamehosting`
**Recovered HEAD:** `56227b1`

See `DEVICE_2_MARKETPLACE_GAMEHOSTING_HANDOFF.md` for the full recovery narrative.

---

## WHAT EXISTS

### Marketplace (COMPLETE for Drive 1)

| Component | Status | Path |
| --- | --- | --- |
| Catalog | ✅ COMPLETE | `backend/services/marketCatalog.service.js` |
| Config | ✅ COMPLETE | `backend/services/marketConfig.service.js` |
| Auth | ✅ COMPLETE | `backend/services/marketAuth.service.js` |
| Checkout | ✅ COMPLETE | `backend/services/marketCheckout.service.js` |
| Orders | ✅ COMPLETE | `backend/services/marketOrder.service.js` |
| State Machine | ✅ COMPLETE | `backend/services/marketOrderStateMachine.service.js` |
| Controller | ✅ COMPLETE | `backend/controllers/market.controller.js` |
| Routes | ✅ COMPLETE | `backend/routes/market.routes.js` |
| Frontend | ✅ COMPLETE | `market.html`, `market/js/*`, `market/css/*` |
| Tests | ✅ 28 M2 + 17 M4 | `backend/tests/marketM2.test.js`, `marketM4.test.js` |

### Game Hosting (COMPLETE for Drive 1)

| Component | Status | Path |
| --- | --- | --- |
| Data Layer (Phase A) | ✅ COMPLETE | `backend/services/gameHosting.service.js` |
| Controller (Phase B) | ✅ COMPLETE | `backend/controllers/gameHosting.controller.js` |
| Routes (Phase B) | ✅ COMPLETE | `backend/routes/gameHosting.routes.js` |
| State Machine | ✅ COMPLETE | `backend/controllers/gameHostingStateMachine.js` |
| Provider Adapter | ⛔ BLOCKED | `backend/controllers/gameHostingProvider.js` |
| Billing | ⛔ BLOCKED | Not implemented |
| Frontend | ⛔ BLOCKED | `index.html` page-game-hosting not implemented |
| Tests | ✅ 23 Phase B | `backend/tests/gameHosting.phaseB.test.js` |

### PS4 Host / RPI (DEFERRED — separate workstream)

| Component | Status | Path |
| --- | --- | --- |
| Game Catalog | ✅ COMPLETE | `backend/services/gamesCatalog.service.js` |
| Host Service | ✅ COMPLETE | `backend/services/ps4Host.service.js` |
| RPI Client | ⛔ BLOCKED | `backend/services/ps4Host/rpiClient.js` |
| Tests | ✅ 80 tests | `backend/tests/gamesCatalog.service.test.js`, `ps4Host.service.test.js` |

---

## WHAT IS COMPLETE

### Marketplace

- **M0**: Architecture/security audit (documented in `OMNISTORE_MARKET_PHASE_M0_AUDIT.md`)
- **M1**: Per-tenant product visibility overlay (fail-closed default, includeAll:true opt-in)
- **M2**: Order state machine (received → cancelled, customer-initiated cancel)
- **M3**: Inventory restoration on order cancellation (stock returned, 'in' transactions appended)
- **M4**: Cross-tenant + forged-field security regression (17 tests)
- **Checkout**: Server-authoritative pricing, quantity validation, oversell prevention, compensating rollback
- **Tenant isolation**: Verified at catalog, checkout, order, and server layers
- **IDOR protection**: Cross-tenant/cross-customer access returns 404

### Game Hosting

- **Phase A**: Data layer (plans, servers, provisioning requests, tenant isolation)
- **Phase B**: HTTP layer (controller, routes, state machine, ownership checks)
- **Provider**: Explicitly BLOCKED with transparent status endpoint
- **Billing**: Explicitly BLOCKED (not implemented)

---

## WHAT IS PARTIAL

### Game Hosting

- **Provisioning**: Requests are recorded but NOT executed (provider BLOCKED)
- **Server lifecycle**: Status transitions are validated and recorded, but NO actual infrastructure operation happens (provider BLOCKED)
- **Frontend**: `index.html` page-game-hosting does NOT exist

---

## WHAT IS BLOCKED

### Game Hosting

- Provider integration (Raspberry Pi, cloud VM, etc.)
- Real provisioning engine
- Real server start/stop/terminate
- Billing integration
- Frontend shell

### PS4 Host

- RPI protocol (stub returns `{ status: 'deferred' }`)
- Real game server hosting
- Frontend shell

---

## WHAT DRIVE 1 SHOULD INTEGRATE

### Marketplace (PRIORITY 1)

1. Deploy `device-2/marketplace-gamehosting` branch
2. Mount `/api/v1/market` routes (already in `server.js`)
3. Deploy `market.html` frontend
4. Verify `products` store behavior matches ERP expectations
5. Verify `sales` invoice creation matches ERP expectations
6. Verify `inventoryTransactions` append behavior matches ERP expectations
7. Run full test suite (104 suites / 1572 tests)

### Game Hosting (PRIORITY 2)

1. Deploy `device-2/marketplace-gamehosting` branch
2. Mount `/api/v1/game-hosting` routes (already in `server.js`)
3. Do NOT present provider/billing as functional — they are BLOCKED
4. Frontend integration requires `index.html` page-game-hosting (NOT YET IMPLEMENTED)
5. Run Game Hosting tests (23 Phase B tests)

---

## WHAT DRIVE 1 MUST NOT REIMPLEMENT

- Marketplace catalog, checkout, order state machine, M1/M2/M3/M4 work
- Game Hosting data layer, controller, routes, state machine
- Tenant isolation logic
- Compensating rollback logic
- Security regression tests

---

## API CONTRACTS

### Marketplace

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/v1/market/config` | requireMarketTenant | Storefront config |
| GET | `/api/v1/market/products` | requireMarketTenant, publicLimiter | List products (with visibility filter) |
| GET | `/api/v1/market/products/:id` | requireMarketTenant, publicLimiter | Get product |
| GET | `/api/v1/market/categories` | requireMarketTenant, publicLimiter | List categories |
| GET | `/api/v1/market/search` | requireMarketTenant, publicLimiter | Search products |
| GET | `/api/v1/market/availability` | requireMarketTenant, publicLimiter | Check stock |
| POST | `/api/v1/market/auth/register` | requireMarketTenant, authLimiter | Register customer |
| POST | `/api/v1/market/auth/login` | requireMarketTenant, authLimiter | Login |
| POST | `/api/v1/market/auth/logout` | requireMarketTenant, requireCustomer | Logout |
| GET | `/api/v1/market/auth/me` | requireMarketTenant, requireCustomer | Current customer |
| POST | `/api/v1/market/checkout` | requireMarketTenant, optionalCustomer, checkoutLimiter | Place order |
| GET | `/api/v1/market/track/:token` | trackLimiter | Track order (public) |
| GET | `/api/v1/market/orders` | requireMarketTenant, requireCustomer | List my orders |
| GET | `/api/v1/market/orders/:id` | requireMarketTenant, requireCustomer | Get my order |
| POST | `/api/v1/market/orders/:id/cancel` | requireMarketTenant, requireCustomer | Cancel order |

### Game Hosting

| Method | Path | Auth | Description | Status |
| --- | --- | --- | --- | --- |
| GET | `/api/v1/game-hosting/provider/status` | requireMarketTenant, requireCustomer | Provider status | IMPLEMENTED |
| GET | `/api/v1/game-hosting/plans` | requireMarketTenant, requireCustomer | List plans | IMPLEMENTED |
| GET | `/api/v1/game-hosting/plans/:id` | requireMarketTenant, requireCustomer | Get plan | IMPLEMENTED |
| POST | `/api/v1/game-hosting/plans` | requireMarketTenant, requireCustomer | Create plan | IMPLEMENTED |
| PUT | `/api/v1/game-hosting/plans/:id` | requireMarketTenant, requireCustomer | Update plan | IMPLEMENTED |
| DELETE | `/api/v1/game-hosting/plans/:id` | requireMarketTenant, requireCustomer | Delete plan | IMPLEMENTED |
| GET | `/api/v1/game-hosting/servers` | requireMarketTenant, requireCustomer | List servers | IMPLEMENTED |
| GET | `/api/v1/game-hosting/servers/:id` | requireMarketTenant, requireCustomer | Get server | IMPLEMENTED |
| POST | `/api/v1/game-hosting/servers` | requireMarketTenant, requireCustomer | Create server | IMPLEMENTED |
| PUT | `/api/v1/game-hosting/servers/:id` | requireMarketTenant, requireCustomer | Update server | IMPLEMENTED |
| DELETE | `/api/v1/game-hosting/servers/:id` | requireMarketTenant, requireCustomer | Delete server | IMPLEMENTED |
| POST | `/api/v1/game-hosting/servers/:id/start` | requireMarketTenant, requireCustomer | Start server | PARTIALLY (provider BLOCKED) |
| POST | `/api/v1/game-hosting/servers/:id/stop` | requireMarketTenant, requireCustomer | Stop server | PARTIALLY (provider BLOCKED) |
| POST | `/api/v1/game-hosting/servers/:id/terminate` | requireMarketTenant, requireCustomer | Terminate server | PARTIALLY (provider BLOCKED) |
| GET | `/api/v1/game-hosting/provisioning-requests` | requireMarketTenant, requireCustomer | List requests | PARTIALLY (provider BLOCKED) |
| POST | `/api/v1/game-hosting/provisioning-requests` | requireMarketTenant, requireCustomer | Create request | PARTIALLY (provider BLOCKED) |

---

## SECURITY MODEL

### Tenant isolation

- Tenant identity: `req.marketTenant` (from `X-Tenant-Id` header + middleware validation)
- Customer identity: `req.customer.id` (from JWT)
- Cross-tenant access: 404 (not 403) — prevents existence leaks
- Product visibility: per-tenant overlay on global products store

### IDOR protection

- Every order operation verifies `order.tenantId === req.marketTenant` AND `order.customerId === req.customer.id`
- Every server operation verifies `server.tenantId === req.marketTenant` AND `server.customerId === req.customer.id`
- Forged `tenantId`/`customerId` in body: rejected or stamped from trusted context

### Price authority

- Server computes all prices, discounts, shipping, totals
- Client-supplied price/total/discount/subtotal are IGNORED

### State machine

- Marketplace orders: `received` → `cancelled` (terminal)
- Game Hosting servers: `pending` → `provisioning` → `running` ⇄ `stopped` → `terminated` (terminal)
- Invalid transitions return 409

---

## TENANT MODEL

### Marketplace tenants

- Defined in `backend/data/marketConfig.json`
- One config per tenant (`tenantId` string)
- Config includes: enabled, storeName, currency, locale, shippingZones, paymentMethods, coupons, priceOverrides, productVisibility
- Default tenant: `default` (seeded on boot with `includeAll: true`)

### Game Hosting tenants

- Same `marketConfig` store as Marketplace
- Plans and servers are scoped to `tenantId`
- Cross-tenant data access is filtered at the service layer

### PS4 Host tenants

- Separate stores: `games_catalog` (gamesCatalog.service.js)
- Tenant isolation enforced per request
- NOT shared with Marketplace or Game Hosting

---

## FILES

### Marketplace

- `backend/services/marketConfig.service.js`
- `backend/services/marketCatalog.service.js`
- `backend/services/marketCheckout.service.js`
- `backend/services/marketOrder.service.js`
- `backend/services/marketOrderStateMachine.service.js`
- `backend/services/marketAuth.service.js`
- `backend/controllers/market.controller.js`
- `backend/routes/market.routes.js`
- `backend/middleware/marketAuth.js`
- `backend/utils/marketJwt.js`
- `backend/data/marketConfig.json`
- `backend/tests/marketM2.test.js`
- `backend/tests/marketM4.test.js`
- `market.html`
- `market/css/market.css`
- `market/js/api.js`
- `market/js/app.js`
- `market/js/locales.js`
- `market/js/store.js`

### Game Hosting

- `backend/services/gameHosting.service.js`
- `backend/controllers/gameHosting.controller.js`
- `backend/controllers/gameHostingProvider.js`
- `backend/controllers/gameHostingStateMachine.js`
- `backend/routes/gameHosting.routes.js`
- `backend/server.js` (modified to mount game-hosting routes)
- `backend/tests/gameHosting.service.test.js`
- `backend/tests/gameHosting.phaseB.test.js`

### PS4 Host (deferred)

- `backend/services/gamesCatalog.service.js`
- `backend/services/ps4Host.service.js`
- `backend/services/ps4Host/rpiClient.js`
- `backend/tests/gamesCatalog.service.test.js`
- `backend/tests/ps4Host.service.test.js`

---

## COMMITS

```
56227b1 feat(game-hosting): Phase B HTTP layer (controller + routes + state machine)
2966ac3 security(market): M4 cross-tenant + forged-field security regression
d8f4a19 feat(market): M3 inventory restoration on order cancellation
d4be68e feat(game-hosting): Phase A data layer
29ba0b4 feat(market): harden order state machine (M2)
106df49 security(market): M1 hardening - per-tenant product visibility overlay
9371bcb (main) feat(platform): expose platform admins management UI
```

6 commits on top of main (`9371bcb`).

---

## TESTS

| Suite | Tests | Pass | Fail |
| --- | --- | --- | --- |
| Total | 104 | 1572 | 0 |

### Marketplace

| Suite | Tests | Pass |
| --- | --- | --- |
| `tests/market.test.js` | (remote baseline) | ✅ |
| `tests/marketM2.test.js` | 28 | ✅ |
| `tests/marketM4.test.js` | 17 | ✅ |

### Game Hosting

| Suite | Tests | Pass |
| --- | --- | --- |
| `tests/gameHosting.service.test.js` | 22 | ✅ |
| `tests/gameHosting.phaseB.test.js` | 23 | ✅ |

### PS4 Host

| Suite | Tests | Pass |
| --- | --- | --- |
| `tests/gamesCatalog.service.test.js` | 44 | ✅ |
| `tests/ps4Host.service.test.js` | 36 | ✅ |

### Regression

- All pre-existing remote tests pass (no regressions)
- Presence flake: NOT reproduced

---

## RISKS

1. **Game Hosting frontend NOT implemented** — `index.html` page-game-hosting does not exist. The backend API is ready but there is no customer-facing UI.
2. **Game Hosting provider/billing BLOCKED** — provisioning and lifecycle endpoints return `status: BLOCKED`. Drive 1 must not present these as functional.
3. **PS4 Host RPI BLOCKED** — RPI protocol is a stub. Not production-ready.
4. **M1/M2/M3/M4 reconstructed from corrupted working copy** — logic matches documented intent but no pre-corruption committed version to diff against.
5. **Recovery branch based on main 9371bcb** — remote main may have moved since clone time.
6. **Sales invoice NOT voided on order cancellation** — the ERP sales record remains in `pending` status. If Drive 1 requires invoice voiding, that is a separate business rule.

---

## NEXT TASKS

1. **Marketplace M5**: UX polish (Arabic localization, error states, responsive layout)
2. **Marketplace M6**: Full regression suite (cross-tenant, race conditions, load)
3. **Marketplace M7**: ERP integration contract enforcement (verify sales invoice behavior matches ERP expectations)
4. **Game Hosting frontend**: Implement `index.html` page-game-hosting
5. **Game Hosting provider**: Implement real provider adapter (Raspberry Pi, cloud VM)
6. **Game Hosting billing**: Integrate real billing provider
7. **PS4 Host**: Implement real RPI protocol (deferred)

---

## DRIVE 1 INTEGRATION INSTRUCTIONS

### Marketplace entry points

- **Backend routes**: `backend/routes/market.routes.js` — mounted at `/api/v1/market` in `server.js:171`
- **Backend services**: `backend/services/market*.service.js`
- **Frontend entry**: `market.html` (static file served from repo root)
- **Data stores**: `backend/data/marketConfig.json`, `backend/data/marketOrders.json`, `backend/data/sales.json`

### Game Hosting entry points

- **Backend routes**: `backend/routes/gameHosting.routes.js` — mounted at `/api/v1/game-hosting` in `server.js:173`
- **Backend services**: `backend/services/gameHosting.service.js`
- **Frontend entry**: NOT YET IMPLEMENTED (requires `index.html` page-game-hosting)
- **Data stores**: `backend/data/gameHostingPlans.json`, `backend/data/gameHostingServers.json`, `backend/data/gameHostingRequests.json`

### Shared dependencies

- `backend/repositories/BaseRepository.js` — file-based storage adapter
- `backend/utils/apiResponse.js` — success/error response helpers
- `backend/utils/asyncHandler.js` — async error wrapper
- `backend/utils/logger.js` — logging
- `backend/utils/marketJwt.js` — customer JWT
- `backend/utils/tokenStore.js` — token revocation
- `backend/middleware/marketAuth.js` — tenant resolution + customer auth
- `backend/config/index.js` — app config

### Integration order

1. Marketplace backend (routes + services)
2. Marketplace frontend (`market.html`)
3. Marketplace ERP contracts (verify products, sales, inventory behavior)
4. Game Hosting backend (routes + services)
5. Game Hosting frontend (BLOCKED — not implemented)
6. Auth/tenant integration (verify JWT secret, tenant config)
7. Final regression (full test suite)

---

## HANDOFF DOCUMENTS

1. `04_INTEGRATION_WORK/DEVICE_2_MARKETPLACE_GAMEHOSTING_HANDOFF.md` — recovery narrative
2. `04_INTEGRATION_WORK/MARKETPLACE_DEVELOPMENT_REPORT.md` — M1/M2/M3/M4 status
3. `04_INTEGRATION_WORK/GAME_HOSTING_DEVELOPMENT_REPORT.md` — Phase A/B status
4. `04_INTEGRATION_WORK/MARKETPLACE_ERP_INTEGRATION_CONTRACT.md` — ERP contract (this document)
5. `08_TEST_REPORTS/DEVICE_2_MARKETPLACE_GAMEHOSTING_TEST_REPORT.md` — test results
6. `07_MARKETPLACE_RELEASE/DEVICE_2_RELEASE_CHECKLIST.md` — pre-push checklist

---

## FINAL STATUS

```
DEVICE 2 — DRIVE 1 DELIVERY STATUS

Branch:
  device-2/marketplace-gamehosting (local, NOT pushed)

HEAD:
  56227b1 feat(game-hosting): Phase B HTTP layer (controller + routes + state machine)

Working tree:
  clean

MARKETPLACE
Status: COMPLETE for Drive 1
Completed: M0 (audit), M1 (product visibility), M2 (order state machine), M3 (inventory restoration on cancel), M4 (security regression), checkout (server-authoritative, compensating rollback), catalog, auth, tracking
Partial: None
Blocked: None

GAME HOSTING
Status: COMPLETE for Drive 1 (backend only)
Completed: Phase A (data layer), Phase B (HTTP layer, state machine, ownership), provider/billing boundaries documented as BLOCKED
Partial: Provisioning (recorded but not executed), server lifecycle (validated but not executed)
Blocked: Provider integration, billing integration, frontend shell

SECURITY
Tenant isolation: VERIFIED (cross-tenant returns 404)
IDOR: VERIFIED (cross-customer returns 404)
Authorization: VERIFIED (forged tenantId/customerId rejected or stamped from trusted context)
Price authority: VERIFIED (server-computed, client cannot forge)
State machine: VERIFIED (invalid transitions return 409)

TESTS
Suites: 104 passed / 0 failed
Tests: 1572 passed / 0 failed
Skipped: 0
Regression: All pre-existing tests pass. No regressions.

INTEGRATION
Marketplace: Backend + frontend ready for integration
Game Hosting: Backend ready; frontend BLOCKED
ERP contracts: Documented in MARKETPLACE_ERP_INTEGRATION_CONTRACT.md
Platform contracts: Shared JWT secret, marketConfig, middleware

REMAINING WORK
1. Game Hosting frontend (index.html page-game-hosting)
2. Game Hosting provider integration (real adapter)
3. Game Hosting billing integration
4. PS4 Host RPI protocol (deferred)
5. Marketplace UX polish (Arabic, error states)
6. Marketplace full regression suite (cross-tenant race conditions)

DRIVE 1 NEXT TASKS
1. Deploy Marketplace backend + frontend
2. Verify ERP contracts (products, sales, inventory)
3. Deploy Game Hosting backend (no frontend yet)
4. Do NOT present provider/billing as functional
5. Run full integration regression

FINAL STATUS:
READY FOR INTEGRATION REVIEW
```
