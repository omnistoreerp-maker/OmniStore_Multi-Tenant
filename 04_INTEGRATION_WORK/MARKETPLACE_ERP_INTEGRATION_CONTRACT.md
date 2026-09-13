# Marketplace → ERP Integration Contract

## Purpose

This document defines the authoritative boundary between the OmniStore Marketplace module and the core ERP system. Drive 1 must use this contract to integrate the Marketplace without duplicating ERP business logic or violating tenant isolation.

---

## 1. Product Contract

### What Marketplace consumes from ERP

| Field | Source | Description |
| --- | --- | --- |
| `id` | `products` store | Unique product identifier (global across all tenants) |
| `name` | `products` store | Display name |
| `sku` | `products` store | Stock keeping unit (optional) |
| `barcode` | `products` store | Barcode (optional) |
| `categoryId` | `products` store | Category identifier (optional) |
| `brandId` | `products` store | Brand identifier (optional) |
| `sellPrice` | `products` store | Base selling price (server-authoritative) |
| `stockQty` | `products` store | Current stock quantity (server-authoritative) |
| `imageUrl` | `products` store | Product image URL (optional) |
| `description` | `products` store | Product description (optional) |
| `unit` | `products` store | Unit of measure (optional) |

### What Marketplace does NOT modify in ERP products

- `sellPrice` is READ-ONLY from the Marketplace perspective. Price overrides are stored in `marketConfig.priceOverrides` (per-tenant overlay), NOT in the `products` store.
- `stockQty` is MUTATED by the Marketplace (decrement on checkout, restore on cancel). This is the ONLY field the Marketplace writes to the `products` store.
- `categoryId`, `brandId`, `imageUrl`, `description`, `unit` are READ-ONLY.

### Tenant visibility overlay

The `products` store is GLOBAL (see `BaseRepository.GLOBAL_STORES`). Per-tenant visibility is expressed via `marketConfig.productVisibility`:

```json
{
  "productVisibility": {
    "includeAll": true,
    "excluded": ["P3", "P4"]
  }
}
```

or

```json
{
  "productVisibility": {
    "includeAll": false,
    "included": ["P1", "P2"]
  }
}
```

**The ERP must NOT filter products by tenant.** The filtering happens entirely in the Marketplace layer (`marketCatalog.service.js:_applyVisibility`).

---

## 2. Inventory Contract

### How availability/stock is obtained

Marketplace reads `products.stockQty` directly from the `products` store (same store the ERP uses). No separate inventory API is called.

### How stock changes are recorded

When stock is decremented (checkout) or restored (cancel), Marketplace writes:
1. `products.stockQty` — mutated directly
2. `inventoryTransactions` — appended with `type: 'out'` (checkout) or `type: 'in'` (cancel), `reason: 'market-checkout'` or `reason: 'market-cancel'`, `user: 'market'`

### Compensation

If checkout fails after stock decrement, the compensating rollback in `marketCheckout.service.js:_compensate` restores `stockQty` and removes the appended transactions.

---

## 3. Pricing Contract

### Server-authoritative price

The Marketplace NEVER trusts client-supplied prices. The server computes the price at checkout time:

1. Check `marketConfig.priceOverrides[productId]` — if present and >= 0, use it.
2. Otherwise, use `products.sellPrice`.

```javascript
// marketConfig.service.js:priceFor
function priceFor(product, cfg) {
  const override = cfg && cfg.priceOverrides && cfg.priceOverrides[String(product.id)];
  if (typeof override === 'number' && override >= 0) return override;
  return Number(product.sellPrice) || 0;
}
```

### Discounts

Discounts are computed server-side from `marketConfig.coupons`. The client supplies a `couponCode`; the server validates and computes the discount amount. The client cannot supply a discount value directly.

### Shipping

Shipping fees are computed server-side from `marketConfig.shippingZones`. The client supplies a `shippingZoneId`; the server looks up the fee and applies free-shipping thresholds.

### Totals

```text
total = subtotal - discount + shippingFee
```

All components are server-computed. The client cannot supply `subtotal`, `total`, or `discount`.

---

## 4. Order Contract

### What Marketplace creates

When checkout succeeds, Marketplace creates:
1. `marketOrders` order record
2. `sales` invoice record (via `salesService.create`)
3. `inventoryTransactions` records (stock decrement)
4. `products` stock update (decrement)

### Order fields (server-computed)

| Field | Source | Description |
| --- | --- | --- |
| `id` | UUID v4 | Order identifier |
| `orderCode` | `ORD-` + timestamp + hex | Human-readable order code |
| `trackingToken` | 24-byte random hex | Public tracking token (no auth required) |
| `tenantId` | `req.marketTenant` | Trusted tenant (from middleware) |
| `customerId` | `req.customer.id` | Trusted customer (from JWT) |
| `items` | Derived from products | `{ productId, name, qty, unitPrice, lineTotal }` |
| `subtotal` | Server-computed | Sum of `unitPrice * qty` |
| `discount` | Server-computed | From coupon validation |
| `shippingFee` | Server-computed | From shipping zone |
| `total` | Server-computed | `subtotal - discount + shippingFee` |
| `couponCode` | Client-supplied (validated) | Coupon code if applied |
| `paymentMethod` | Server-resolved | From `marketConfig.paymentMethods` |
| `paymentStatus` | `'pending'` | Fixed at creation |
| `status` | `'received'` | Fixed at creation |
| `shippingAddress` | Client-supplied | Shipping address |
| `saleId` | Sales invoice ID | Link to ERP sales record |
| `idempotencyKey` | Client-supplied (optional) | For idempotent retries |

### What ERP receives

The `sales` invoice created by `salesService.create` contains:
- `id`: `MKT-` + timestamp + UUID
- `items`: productId, name, qty, price
- `total`, `subtotal`, `discount`, `shippingFee`
- `customer`, `customerId`, `email`
- `payment`, `paymentType`
- `invoiceType`: `'market'`
- `tenantId`: stamped by sales service
- `status`: `'pending'`
- `date`: ISO timestamp

### Order cancellation

When a customer cancels an order (`POST /api/v1/market/orders/:id/cancel`):
1. `marketOrders` order is marked `status: 'cancelled'`, `paymentStatus: 'cancelled'`
2. `products.stockQty` is restored (incremented by item qty)
3. `inventoryTransactions` appends `type: 'in'` with `reason: 'market-cancel'`
4. The `sales` invoice is NOT modified (it remains in the ERP with `status: 'pending'`)

**ERP integration note:** The sales invoice is NOT voided on cancellation. If Drive 1 requires invoice voiding, that is a separate business rule to be implemented in the ERP or as a follow-up task.

---

## 5. Customer Contract

### What Marketplace requires

The Marketplace customer is a separate entity from the ERP user/employee. Marketplace customers:
- Register via `/api/v1/market/auth/register`
- Login via `/api/v1/market/auth/login`
- Receive a JWT with `sub` (customer id) and `ver` (token version)
- The JWT is signed with `JWT_SECRET` (same secret as ERP, but different token type)

### Customer fields stored in `marketAuth.service`

| Field | Description |
| --- | --- |
| `id` | UUID v4 |
| `tenantId` | Tenant identifier (from `X-Tenant-Id` at registration) |
| `email` | Customer email (unique per tenant) |
| `name` | Customer name |
| `password` | bcrypt hash |
| `tokenVersion` | Incremented on password change (invalidates old JWTs) |
| `createdAt` | ISO timestamp |

### No ERP customer sync

Marketplace customers are NOT synced to the ERP `customers` store. They are isolated to the Marketplace module. If Drive 1 requires a unified customer view, that is a separate integration task.

---

## 6. Tenant/Company Contract

### How trusted tenant context reaches Marketplace

1. `requireMarketTenant` middleware reads `X-Tenant-Id` header (or `query.tenant` or `body.tenantId` as fallback)
2. Validates the tenant exists in `marketConfig`
3. Sets `req.marketTenant`
4. All service calls use `req.marketTenant` — NEVER `req.body.tenantId`

### Tenant identity source

The `X-Tenant-Id` header is the tenant selector. It is NOT an authorization token. The authorization check is:
- The customer's JWT must have been issued for the same tenant (`customer.tenantId === req.marketTenant`)
- Cross-tenant customer access is rejected with 403

### Tenant config store

`backend/data/marketConfig.json` — per-tenant configuration:
- `enabled`: whether the storefront is active
- `storeName`: display name
- `currency`: currency code
- `locale`: locale code
- `shippingZones`: array of zone configs
- `paymentMethods`: array of payment method configs
- `coupons`: array of coupon configs
- `priceOverrides`: map of `productId -> overridePrice`
- `productVisibility`: per-tenant product visibility rules

---

## 7. Security Invariants

### Tenant isolation

- Tenant identity comes from `req.marketTenant` (trusted server context)
- Customer identity comes from `req.customer.id` (JWT, trusted)
- Products are filtered by `marketConfig.productVisibility` per request
- Orders are scoped to `tenantId` + `customerId` on every read
- Cross-tenant access returns 404 (not 403) to prevent existence leaks

### Price/total authority

- Server computes `unitPrice` from `products.sellPrice` or `marketConfig.priceOverrides`
- Server computes `subtotal`, `discount`, `shippingFee`, `total`
- Client-supplied `unitPrice`, `price`, `subtotal`, `total`, `discount` are IGNORED

### Quantity validation

- `qty` must be a positive integer
- `qty` > `stockQty` returns 409 (insufficient stock)
- Oversell prevention: stock is decremented atomically under `stockLock`

### IDOR protection

- Every server read/write verifies `order.tenantId === req.marketTenant` and `order.customerId === req.customer.id`
- Every server read/write verifies `server.tenantId === req.marketTenant` and `server.customerId === req.customer.id`
- Forged `tenantId` or `customerId` in request body is rejected or stamped from trusted context

---

## 8. Integration Order (Drive 1)

Recommended integration sequence:

1. **Marketplace backend** — deploy `device-2/marketplace-gamehosting` branch
   - Routes: `/api/v1/market/*`
   - Services: `marketCatalog`, `marketCheckout`, `marketOrder`, `marketOrderStateMachine`, `marketConfig`, `marketAuth`
   - Tests: 104 suites / 1572 tests (all pass)

2. **Marketplace ERP contracts** — verify:
   - `products` store read/write behavior matches ERP expectations
   - `inventoryTransactions` append behavior matches ERP expectations
   - `sales` invoice creation matches ERP expectations
   - `marketOrders` order lifecycle matches business requirements

3. **Marketplace frontend** — deploy `market.html` + `market/js/*`
   - Entry point: `market.html`
   - API base: `/api/v1/market`

4. **Game Hosting backend** — deploy after Marketplace
   - Routes: `/api/v1/game-hosting/*`
   - Services: `gameHosting` (data layer)
   - Controller: `gameHosting.controller`
   - Provider: BLOCKED (not integrated)
   - Billing: BLOCKED (not integrated)

5. **Game Hosting frontend** — requires `index.html` page-game-hosting (not yet implemented)

6. **Auth/tenant integration** — verify:
   - Market JWT and Game Hosting JWT use the same `JWT_SECRET`
   - Tenant config is shared via `marketConfig`
   - Customer accounts are isolated per module

7. **Final regression** — run full test suite against integrated environment
