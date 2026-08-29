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
  ensureSeeded
};
