const { v4: uuidv4 } = require('uuid');
const BaseRepository = require('../repositories/BaseRepository');
const repository = new BaseRepository('marketConfig');
const config = require('../config');
const logger = require('../utils/logger');

function _defaultDoc() {
  return { configs: [] };
}

async function _load() {
  const db = await repository.readAsync();
  if (!db || typeof db !== 'object') return _defaultDoc();
  if (!Array.isArray(db.configs)) db.configs = [];
  return db;
}

function _loadSync() {
  const db = repository.read();
  if (!db || typeof db !== 'object') return _defaultDoc();
  if (!Array.isArray(db.configs)) db.configs = [];
  return db;
}

async function _save(db) {
  return repository.writeAsync(db);
}

function get(tenantId) {
  const db = _loadSync();
  return db.configs.find((c) => String(c.tenantId) === String(tenantId)) || null;
}

function exists(tenantId) {
  return get(tenantId) != null;
}

function priceFor(product, cfg) {
  const override = cfg && cfg.priceOverrides && cfg.priceOverrides[String(product.id)];
  if (typeof override === 'number' && override >= 0) return override;
  return Number(product.sellPrice) || 0;
}

function resolveCoupon(cfg, code, subtotal) {
  if (!cfg || !Array.isArray(cfg.coupons) || !code) return null;
  const normalized = String(code).trim().toLowerCase();
  const coupon = cfg.coupons.find((c) => c && c.code && String(c.code).toLowerCase() === normalized && c.active !== false);
  if (!coupon) return null;
  const min = Number(coupon.minSubtotal) || 0;
  if (subtotal < min) return null;
  let discount = 0;
  if (coupon.type === 'percent') {
    discount = (subtotal * (Number(coupon.value) || 0)) / 100;
    if (coupon.maxDiscount != null) discount = Math.min(discount, Number(coupon.maxDiscount) || 0);
  } else if (coupon.type === 'fixed') {
    discount = Number(coupon.value) || 0;
  }
  discount = Math.round(discount * 100) / 100;
  if (discount <= 0) return null;
  return { code: coupon.code, type: coupon.type, discount };
}

function resolveShipping(cfg, zoneId, subtotal) {
  if (!cfg || !Array.isArray(cfg.shippingZones)) return null;
  const zone = cfg.shippingZones.find((z) => z && String(z.id) === String(zoneId));
  if (!zone) return null;
  const freeAbove = Number(zone.freeAbove) || 0;
  const fee = freeAbove > 0 && subtotal >= freeAbove ? 0 : Number(zone.fee) || 0;
  return { id: zone.id, name: zone.name, fee };
}

function resolvePayment(cfg, methodId) {
  if (!cfg || !Array.isArray(cfg.paymentMethods)) return null;
  return cfg.paymentMethods.find((m) => m && String(m.id) === String(methodId) && m.active !== false) || null;
}

// P0-1 — Per-tenant product visibility.
//
// The `products` store is intentionally GLOBAL across the codebase
// (see backend/repositories/BaseRepository.js GLOBAL_STORES and the
// 'products list is visible to both tenants (GLOBAL)' test in
// backend/tests/inventoryAsync.test.js). The Market must NOT break
// that contract.
//
// Per-tenant visibility is therefore expressed as a filter overlay in
// the per-tenant marketConfig (NOT a field on the product record).
//
// M1.1 — FAIL-CLOSED DEFAULT. The required security invariant is:
//
//   A tenant must NEVER receive another tenant's private product.
//
// If the default were "include all when no config", a tenant that has
// not configured productVisibility would see every product in the
// global store — including products that another tenant has marked
// private via { includeAll: false, included: [...] }. That violates
// the invariant.
//
// The default is therefore "include none". A tenant that wants the
// pre-M1.1 behavior of "include all" MUST explicitly set
// productVisibility: { includeAll: true }. The ensureSeeded() function
// below does this for the default tenant so the existing 1508-test
// baseline continues to pass.
//
// Shape (all keys optional; default = "include none" / fail-closed):
//   productVisibility: {
//     includeAll: true | false,   // default false (fail-closed)
//     included:    ["P1","P2"],  // used when includeAll === false
//     excluded:    ["P3"]        // used when includeAll === true
//   }
//
// Semantics:
//   - missing / no productVisibility     -> NO product is visible
//   - non-object productVisibility       -> NO product is visible
//   - { includeAll: true }               -> every product EXCEPT excluded
//   - { includeAll: false, included: [] }-> NO product is visible
//   - { includeAll: false, included: ['P1'] } -> only P1
//
// The result is a filter function (productId) -> boolean that the
// catalog service applies after the global products list is read.
// `included` / `excluded` are compared as strings, case-preserving,
// trimmed — matching the existing _normalizeId style.
function resolveProductVisibility(cfg) {
  if (!cfg || !cfg.productVisibility || typeof cfg.productVisibility !== 'object') {
    // M1.1 — FAIL-CLOSED. A missing or malformed productVisibility
    // means "no products are visible". The default tenant gets
    // includeAll: true via ensureSeeded(); every other tenant must
    // opt in explicitly. This guarantees the cross-tenant privacy
    // invariant: a tenant that has not configured visibility cannot
    // accidentally receive another tenant's private products.
    return function allowNone() { return false; };
  }
  const v = cfg.productVisibility;
  if (v.includeAll === true) {
    const denied = new Set(
      (Array.isArray(v.excluded) ? v.excluded : []).map((x) => String(x).trim()).filter(Boolean)
    );
    return function denylist(productId) { return !denied.has(String(productId).trim()); };
  }
  // includeAll === false (or undefined) — allowlist mode.
  // If `included` is missing/empty, NO product is visible (fail-closed
  // on the allowlist too — an empty allowlist must not be interpreted
  // as "include all").
  const allowed = new Set(
    (Array.isArray(v.included) ? v.included : []).map((x) => String(x).trim()).filter(Boolean)
  );
  return function allowlist(productId) { return allowed.has(String(productId).trim()); };
}

function ensureSeeded() {
  try {
    const db = _loadSync();
    const defaultId = config.defaultTenantId || 'default';
    if (db.configs.some((c) => String(c.tenantId) === String(defaultId))) return;
    const seeded = {
      tenantId: defaultId,
      enabled: true,
      storeName: 'OmniStore Market',
      currency: 'USD',
      locale: 'en',
      shippingZones: [
        { id: 'standard', name: 'Standard Shipping', countries: [], fee: 10, freeAbove: 200 },
        { id: 'express', name: 'Express Shipping', countries: [], fee: 25, freeAbove: 0 }
      ],
      paymentMethods: [
        { id: 'cod', name: 'Cash on Delivery', type: 'offline', active: true },
        { id: 'bank', name: 'Bank Transfer', type: 'offline', active: true }
      ],
      coupons: [
        { code: 'WELCOME10', type: 'percent', value: 10, minSubtotal: 0, maxDiscount: 100, active: true }
      ],
      priceOverrides: {},
      // M1.1 — The default tenant opts in to "include all" so the
      // pre-M1.1 single-tenant behavior is preserved. Every other
      // tenant is fail-closed by default.
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.configs.push(seeded);
    repository.write(db);
    logger.info('Market: seeded default tenant config (' + defaultId + ')');
  } catch (err) {
    logger.error('Market: ensureSeeded error:', err.message);
  }
}

module.exports = {
  get,
  exists,
  priceFor,
  resolveCoupon,
  resolveShipping,
  resolvePayment,
  resolveProductVisibility,
  ensureSeeded
};
