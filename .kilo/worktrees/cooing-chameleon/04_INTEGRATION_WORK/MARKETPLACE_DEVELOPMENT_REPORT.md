# Marketplace Development Report

## Status: M1 + M2 COMPLETE (recovered 2026-09-05)

### M0 — Audit (already on remote main)

The Marketplace MVP was committed to `main` as `ab565fa feat(market): release customer storefront MVP`. This is the baseline. The M0 audit identified three P0 issues:
- P0-1: Per-tenant product visibility overlay needed (global products store was leaking across tenants)
- P0-2: Market sales tenant stamping needed
- P0-3: Checkout compensating rollback needed

### M1 — P0 Hardening (recovered commit `106df49`)

**Commit:** `security(market): M1 hardening - per-tenant product visibility overlay`

- Added `resolveProductVisibility(cfg)` to `marketConfig.service.js`
- Supports `includeAll:true` with `excluded` list
- Supports `includeAll:false` with `included` list
- Default: allow all products
- Applied `_applyVisibility(products, cfg)` to `listProducts`, `getProduct`, `availability`, and `categories` in `marketCatalog.service.js`
- Products store remains global (no schema change required)

### M2 — Order State Machine (recovered commit `29ba0b4`)

**Commit:** `feat(market): harden order state machine (M2)`

- New service: `marketOrderStateMachine.service.js`
- States: `received` (initial), `cancelled` (terminal)
- Allowed transition: `received → cancelled`
- Pure helpers: `isValidOrderState`, `isTerminalOrderState`, `canTransition`, `validateTransition`, `getAllowedTransitions`
- Side-effecting: `cancelOrder({ orderId, customerId, tenantId, reason })`
- New route: `POST /api/v1/market/orders/:id/cancel` (behind `requireMarketTenant` + `requireCustomer`)
- `marketOrder.service.js` customer projection now includes `cancelledAt` and `cancellationReason`
- `marketOrderStateMachine.service.js` uses `BaseRepository('marketOrders')` for storage
- 28 tests in `marketM2.test.js` (15 pure + 9 side-effecting + 4 regression)

### Security invariants

- `customerId` from `req.customer.id` (JWT middleware), NEVER from body
- `tenantId` from `req.marketTenant` (middleware), NEVER from body
- Client-supplied `status`, `paymentStatus`, `tenantId`, `customerId` in body are IGNORED
- Cross-tenant or cross-customer access returns `404` (not `403`) to prevent existence leaks
- `cancellationReason` capped at 500 chars

### Test results

| Suite | Tests | Pass |
| --- | --- | --- |
| `tests/market.test.js` | (remote main baseline) | ✅ |
| `tests/marketM2.test.js` | 28 | ✅ |

### Remaining work

- M3: Checkout flow hardening (end-to-end verification, not just unit tests)
- M4: Inventory integration (when Market order is placed, decrement stock)
- M5: UX (Arabic localization, responsive layout, error states)
- M6: Regression suite (cross-tenant, cross-customer, race conditions)
- M7: ERP integration contract (documented, not yet enforced)
