'use strict';

const crypto = require('crypto');
const inventoryRepository = require('../repositories').products;
const marketConfigService = require('./marketConfig.service');
const productCategoryService = require('./productCategories.service');
const audit = require('./audit.service');
const logger = require('../utils/logger');

/**
 * Product management. Products are a GLOBAL store (see marketConfig.comment
 * P0-1) — per-tenant visibility is expressed as a filter overlay in the
 * per-tenant marketConfig (NOT a field on the product record).
 *
 * All writes go through the server context (req.marketTenant). A client
 * cannot stamp its own tenantId: ownership is asserted by the operator
 * guard + context, never by request data.
 */
const ALLOWED_PRODUCT_FIELDS = new Set([
  'id', 'name', 'sku', 'categoryId', 'brandId', 'cpu', 'ramRom', 'gpu',
  'display', 'os', 'generation', 'barcode', 'sellPrice', 'price', 'stockQty',
  'imageUrl', 'description', 'unit', 'published', 'priceOverrides'
]);

const IDENTITY_KEYS = new Set(['id', 'createdAt']);

const MAX_TEXT_LENGTH = 200;
const MAX_DESC_LENGTH = 2000;
const MAX_SPEC_LENGTH = 300;

function _now() { return new Date().toISOString(); }

function _validateId(id, label) {
  const trimmed = String(id || '').trim();
  if (!trimmed) return { error: label + ' id is required' };
  if (!/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    return { error: label + ' id must contain only letters, numbers and hyphens' };
  }
  if (trimmed.length > 60) return { error: label + ' id is too long' };
  return { id: trimmed };
}

function _slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Strip mass-assignment attempts. The caller keeps full control of its own
 * payload object; only the fields in ALLOWED_PRODUCT_FIELDS are allowed to
 * flow into the record. Identity keys, ownership and audit fields are NEVER
 * touched by client input.
 */
function _coerceProduct(input, defaults) {
  const out = { ...defaults };
  for (const key of Object.keys(input)) {
    if (!ALLOWED_PRODUCT_FIELDS.has(key)) continue;
    const raw = input[key];
    if (key === 'id') {
      const chk = _validateId(raw, 'product');
      if (chk.error) return chk; // reject malformed ids at coercion time
      out.id = chk.id;
    } else if (key === 'name') {
      const t = String(raw || '').trim();
      out.name = t.length < 1 || t.length > MAX_TEXT_LENGTH ? null : t;
    } else if (key === 'description') {
      out.description = String(raw || '').slice(0, MAX_DESC_LENGTH) || null;
    } else if (key === 'sku') {
      const t = String(raw || '').trim();
      out.sku = t.length ? t.slice(0, 100) : null;
    } else if (key === 'categoryId') {
      out.categoryId = String(raw || '').trim() || null;
    } else if (key === 'brandId') {
      out.brandId = String(raw || '').trim() || null;
    } else if (key === 'cpu') {
      out.cpu = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'ramRom') {
      out.ramRom = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'gpu') {
      out.gpu = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'display') {
      out.display = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'os') {
      out.os = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'generation') {
      out.generation = String(raw || '').slice(0, MAX_SPEC_LENGTH) || null;
    } else if (key === 'barcode') {
      out.barcode = String(raw || '').slice(0, 60) || null;
    } else if (key === 'sellPrice' || key === 'price') {
      const n = Number(raw);
      out.sellPrice = Number.isFinite(n) && n >= 0 ? n : null;
      out.price = out.sellPrice;
    } else if (key === 'stockQty') {
      const n = Number(raw);
      out.stockQty = Number.isInteger(n) && n >= 0 ? n : null;
    } else if (key === 'imageUrl') {
      const t = String(raw || '');
      out.imageUrl = t.length ? t : null;
    } else if (key === 'unit') {
      out.unit = String(raw || '').slice(0, 20) || null;
    } else if (key === 'published') {
      out.published = Boolean(raw);
    }
  }
  return out;
}

function _project(product, cfg) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || null,
    categoryId: product.categoryId != null ? String(product.categoryId) : null,
    brandId: product.brandId != null ? String(product.brandId) : null,
    cpu: product.cpu != null ? String(product.cpu) : null,
    ramRom: product.ramRom != null ? String(product.ramRom) : null,
    gpu: product.gpu != null ? String(product.gpu) : null,
    display: product.display != null ? String(product.display) : null,
    os: product.os != null ? String(product.os) : null,
    generation: product.generation != null ? String(product.generation) : null,
    barcode: product.barcode || null,
    price: marketConfigService.priceFor(product, cfg),
    currency: (cfg && cfg.currency) || 'EGP',
    stockQty: Number(product.stockQty) || 0,
    imageUrl: product.imageUrl || null,
    description: product.description || null,
    unit: product.unit || null,
    createdAt: product.createdAt || null,
    updatedAt: product.updatedAt || null,
    published: product.published !== false
  };
}

/**
 * Check whether a product id is visible in the requesting tenant catalog
 * (fail-closed). This is the ownership gate for all write operations.
 */
function _isVisibleInCatalog(tenantId, productId) {
  const allow = marketConfigService.resolveProductVisibility(marketConfigService.get(tenantId));
  return allow(String(productId));
}

async function _readDb() {
  return inventoryRepository.readAsync();
}

/**
 * Create a product.
 * - id: client may propose (slugify-safe); a valid id is required.
 * - categoryId must exist in the global category taxonomy.
 * - published defaults to true (visible by default).
 */
async function createProduct(tenantId, payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { error: 'payload must be an object' };
  }
  const base = _coerceProduct(payload, {});
  if (base.error) return base;
  if (!base.name) return { error: 'product name is required (1-200 chars)' };
  if (!base.sku) base.sku = 'SKU-' + _slugify(base.name).slice(0, 40) + '-' + crypto.randomBytes(3).toString('hex');
  if (!base.categoryId) return { error: 'category id is required' };
  const cat = await productCategoryService.getCategory(tenantId, base.categoryId);
  if (!cat) return { error: 'product must be linked to an existing category' };
  if (base.sellPrice == null) return { error: 'price (sellPrice) is required' };
  if (base.stockQty == null) base.stockQty = 0;

  if (base.id) {
    const products = Array.isArray((await _readDb()).products) ? (await _readDb()).products : [];
    if (products.some((p) => p && String(p.id) === base.id)) {
      return { error: 'product id already exists' };
    }
  }

  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const newProduct = {
    id: base.id || _slugify(base.name) + '-' + crypto.randomBytes(8).toString('hex'),
    name: base.name,
    sku: base.sku,
    categoryId: base.categoryId,
    brandId: base.brandId,
    cpu: base.cpu,
    ramRom: base.ramRom,
    gpu: base.gpu,
    display: base.display,
    os: base.os,
    generation: base.generation,
    barcode: base.barcode,
    sellPrice: base.sellPrice,
    stockQty: base.stockQty,
    imageUrl: base.imageUrl,
    description: base.description,
    unit: base.unit,
    published: base.published !== false,
    createdAt: _now(),
    updatedAt: _now()
  };
  products.push(newProduct);
  doc.products = products;
  if (!(await inventoryRepository.write(doc))) {
    return { error: 'failed to persist product' };
  }
  audit.record({
    requestId: (() => {
      try {
        const mod = require('../middleware/requestId');
        return (mod && typeof mod.get === 'function') ? mod.get() : null;
      } catch {
        return null;
      }
    })(),
    method: 'POST', path: '/api/v1/market/products', action: 'product_create',
    resource: 'product', resourceId: newProduct.id,
    changes: _redact(base)
  });
  return { product: _project(newProduct, marketConfigService.get(tenantId)) };
}

async function _redact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (['sellPrice', 'price', 'stockQty', 'cpu', 'ramRom', 'gpu', 'display', 'os', 'generation',
        'barcode', 'brandId', 'categoryId', 'sku', 'name', 'description', 'unit', 'imageUrl', 'published'].includes(k)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Update a product. Only allowed fields flow through; identity keys
 * (id, createdAt) and ownership/audit fields are never replaced.
 * The product must be visible in the requesting tenant catalog.
 */
async function updateProduct(tenantId, id, payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { error: 'payload must be an object' };
  }
  const idCheck = _validateId(id, 'product');
  if (idCheck.error) return idCheck;
  if (!_isVisibleInCatalog(tenantId, idCheck.id)) {
    return { error: 'product not found' }; // non-disclosing
  }
  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const idx = products.findIndex((p) => p && String(p.id) === idCheck.id);
  if (idx === -1) return { error: 'product not found' };
  const existing = products[idx];

  const merged = Object.assign({}, existing);
  for (const key of Object.keys(payload)) {
    if (IDENTITY_KEYS.has(key)) continue; // never let client touch id / createdAt
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt' || key === 'tokenVersion' ||
        key === 'deletedAt' || key === 'deletedBy') continue; // explicit mass-assignment block
    if (!ALLOWED_PRODUCT_FIELDS.has(key)) continue;
    if (key === 'name') {
      const t = String(payload[key] || '').trim();
      merged.name = t.length < 1 || t.length > MAX_TEXT_LENGTH ? existing.name : t;
    } else if (key === 'description') {
      merged.description = String(payload[key] || '').slice(0, MAX_DESC_LENGTH) || existing.description;
    } else if (key === 'sku') {
      const t = String(payload[key] || '').trim();
      merged.sku = t.length ? t.slice(0, 100) : existing.sku;
    } else if (key === 'categoryId') {
      const newCat = await productCategoryService.getCategory(tenantId, String(payload[key]));
      merged.categoryId = newCat ? String(payload[key]).trim() : existing.categoryId;
    } else if (key === 'brandId') {
      merged.brandId = String(payload[key] || '').trim() || existing.brandId;
    } else if (key === 'cpu') {
      merged.cpu = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.cpu;
    } else if (key === 'ramRom') {
      merged.ramRom = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.ramRom;
    } else if (key === 'gpu') {
      merged.gpu = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.gpu;
    } else if (key === 'display') {
      merged.display = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.display;
    } else if (key === 'os') {
      merged.os = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.os;
    } else if (key === 'generation') {
      merged.generation = String(payload[key] || '').slice(0, MAX_SPEC_LENGTH) || existing.generation;
    } else if (key === 'barcode') {
      merged.barcode = String(payload[key] || '').slice(0, 60) || existing.barcode;
    } else if (key === 'sellPrice' || key === 'price') {
      const n = Number(payload[key]);
      merged.sellPrice = Number.isFinite(n) && n >= 0 ? n : existing.sellPrice;
      merged.price = merged.sellPrice;
    } else if (key === 'stockQty') {
      const n = Number(payload[key]);
      merged.stockQty = Number.isInteger(n) && n >= 0 ? n : existing.stockQty;
    } else if (key === 'imageUrl') {
      const t = String(payload[key] || '');
      merged.imageUrl = t.length ? t : existing.imageUrl;
    } else if (key === 'unit') {
      merged.unit = String(payload[key] || '').slice(0, 20) || existing.unit;
    } else if (key === 'published') {
      merged.published = Boolean(payload[key]);
    }
  }
  merged.updatedAt = _now();
  const target = products.slice();
  target[idx] = merged;
  doc.products = target;
  if (!(await inventoryRepository.write(doc))) {
    return { error: 'failed to persist product' };
  }
  audit.record({
    requestId: null, method: 'PUT', path: '/api/v1/market/products/' + id, action: 'product_update',
    resource: 'product', resourceId: id, changes: _redact(Object.fromEntries(
      Object.entries(payload).filter(([k]) => !IDENTITY_KEYS.has(k)))
    )
  });
  return { product: _project(merged, marketConfigService.get(tenantId)) };
}

/**
 * Soft-delete a product (deletedAt). Customers never see deleted products.
 * Operators can purge permanently via /products/:id/purge.
 */
async function softDeleteProduct(tenantId, id, operatorId) {
  const idCheck = _validateId(id, 'product');
  if (idCheck.error) return idCheck;
  if (!_isVisibleInCatalog(tenantId, idCheck.id)) {
    return { error: 'product not found' }; // non-disclosing
  }
  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const idx = products.findIndex((p) => p && String(p.id) === idCheck.id);
  if (idx === -1) return { error: 'product not found' };
  const product = products[idx];
  product.deletedAt = _now();
  product.deletedBy = String(operatorId || '');
  const target = products.slice();
  target[idx] = product;
  doc.products = target;
  if (!(await inventoryRepository.write(doc))) {
    return { error: 'failed to persist product' };
  }
  audit.record({
    requestId: null, method: 'DELETE', path: '/api/v1/market/products/' + id, action: 'product_delete',
    resource: 'product', resourceId: id, changes: { operatorId }
  });
  // Echo back the tombstone fields so the operator can confirm the deletion.
  const projected = _project(product, marketConfigService.get(tenantId));
  return { product: { ...projected, deletedAt: product.deletedAt, deletedBy: product.deletedBy } };
}

/**
 * Hard-purge a product from the catalog. Operators only.
 */
async function hardDeleteProduct(tenantId, id, operatorId) {
  const idCheck = _validateId(id, 'product');
  if (idCheck.error) return idCheck;
  if (!_isVisibleInCatalog(tenantId, idCheck.id)) {
    return { error: 'product not found' }; // non-disclosing
  }
  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const idx = products.findIndex((p) => p && String(p.id) === idCheck.id);
  if (idx === -1) return { error: 'product not found' };
  const product = products[idx];
  products.splice(idx, 1);
  doc.products = products;
  if (!(await inventoryRepository.write(doc))) {
    return { error: 'failed to purge product' };
  }
  audit.record({
    requestId: null, method: 'DELETE', path: '/api/v1/market/products/' + id + '/purge', action: 'product_purge',
    resource: 'product', resourceId: id, changes: { operatorId }
  });
  return { ok: true };
}

/**
 * Toggle publish state. Only products visible in the tenant catalog can be
 * published/unpublished.
 */
async function setPublish(tenantId, id, published) {
  const idCheck = _validateId(id, 'product');
  if (idCheck.error) return idCheck;
  if (!_isVisibleInCatalog(tenantId, idCheck.id)) {
    return { error: 'product not found' }; // non-disclosing
  }
  if (typeof published !== 'boolean') return { error: 'published must be a boolean' };
  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const idx = products.findIndex((p) => p && String(p.id) === idCheck.id);
  if (idx === -1) return { error: 'product not found' };
  const product = products[idx];
  product.published = published;
  product.updatedAt = _now();
  const target = products.slice();
  target[idx] = product;
  doc.products = target;
  if (!(await inventoryRepository.write(doc))) {
    return { error: 'failed to persist publish state' };
  }
  return { product: _project(product, marketConfigService.get(tenantId)) };
}

/**
 * Get a single product. Fail-closed: a tenant that cannot list the product
 * gets null (never a 404 that leaks existence).
 */
async function getProduct(tenantId, id) {
  const idCheck = _validateId(id, 'product');
  if (idCheck.error) return null;
  if (!_isVisibleInCatalog(tenantId, idCheck.id)) {
    return null;
  }
  const doc = await _readDb();
  const products = Array.isArray(doc.products) ? doc.products : [];
  const product = products.find((p) => p && String(p.id) === idCheck.id);
  return product ? _project(product, marketConfigService.get(tenantId)) : null;
}

/**
 * List products.
 * - customers: published, not deleted, visibility-filtered, optionally
 *   includeOutOfStock.
 * - operators: can include drafts (published:false) and deleted (includeDeleted)
 *   via query params.
 */
async function listProducts(tenantId, query = {}) {
  const cfg = marketConfigService.get(tenantId);
  const allow = marketConfigService.resolveProductVisibility(cfg);
  const db = await _readDb();
  let products = Array.isArray(db.products) ? db.products : [];
  products = products.filter((p) => allow(p && p.id) && p && !p.deletedAt);
  if (query.includeDrafts !== 'true') {
    products = products.filter((p) => (p.published !== false));
  }
  if (query.includeOutOfStock !== 'true') {
    products = products.filter((p) => (Number(p.stockQty) || 0) > 0);
  }
  if (query.categoryId) products = products.filter((p) => String(p.categoryId) === String(query.categoryId));
  if (query.brandId) products = products.filter((p) => String(p.brandId) === String(query.brandId));
  if (query.search) {
    const q = String(query.search).toLowerCase();
    products = products.filter((p) =>
      (p.name || '').toLowerCase().includes(q) ||
      String(p.sku || '').toLowerCase().includes(q) ||
      String(p.barcode || '').toLowerCase().includes(q) ||
      String(p.cpu || '').toLowerCase().includes(q) ||
      String(p.ramRom || '').toLowerCase().includes(q) ||
      String(p.gpu || '').toLowerCase().includes(q) ||
      String(p.description || '').toLowerCase().includes(q)
    );
  }
  const sortBy = query.sortBy || 'name';
  const order = query.sortOrder === 'desc' ? -1 : 1;
  products.sort((a, b) => {
    let va, vb;
    if (sortBy === 'price') {
      va = marketConfigService.priceFor(a, cfg);
      vb = marketConfigService.priceFor(b, cfg);
    } else {
      va = a[sortBy]; vb = b[sortBy];
    }
    if (sortBy === 'price' || sortBy === 'stockQty') {
      va = Number(va) || 0; vb = Number(vb) || 0;
    } else {
      va = String(va || '').toLowerCase(); vb = String(vb || '').toLowerCase();
    }
    return va < vb ? -order : va > vb ? order : 0;
  });
  const total = products.length;
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 24));
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const start = (page - 1) * limit;
  const items = products.slice(start, start + limit);
  return {
    products: items.map((p) => _project(p, cfg)),
    total, page, limit, totalPages: Math.ceil(total / limit)
  };
}

module.exports = {
  createProduct,
  updateProduct,
  softDeleteProduct,
  hardDeleteProduct,
  setPublish,
  getProduct,
  listProducts,
  _project,
  ALLOWED_PRODUCT_FIELDS,
  IDENTITY_KEYS
};

