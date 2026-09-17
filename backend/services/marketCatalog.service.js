const inventoryRepository = require('../repositories').products;
const marketConfigService = require('./marketConfig.service');

function _project(product, cfg) {
  return {
    id: product.id,
    name: product.name,
    sku: product.sku || null,
    barcode: product.barcode || null,
    categoryId: product.categoryId != null ? String(product.categoryId) : null,
    brandId: product.brandId != null ? String(product.brandId) : null,
    price: marketConfigService.priceFor(product, cfg),
    currency: (cfg && cfg.currency) || 'USD',
    stockQty: Number(product.stockQty) || 0,
    imageUrl: product.imageUrl || null,
    description: product.description || null,
    unit: product.unit || null
  };
}

function _paginate(arr, page, limit) {
  const total = arr.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 24));
  const start = (p - 1) * l;
  return { items: arr.slice(start, start + l), total, page: p, limit: l, totalPages: Math.ceil(total / l) };
}

// P0-1 — Apply the per-tenant product visibility filter from the
// marketConfig overlay. This is the ONLY place the Market decides which
// products a tenant can see. The products store itself stays GLOBAL
// (intentional architecture; see BaseRepository.GLOBAL_STORES).
function _applyVisibility(products, cfg) {
  if (!Array.isArray(products) || products.length === 0) return products;
  const allow = marketConfigService.resolveProductVisibility(cfg);
  return products.filter((p) => allow(p && p.id));
}

async function listProducts(tenantId, query = {}) {
  const cfg = marketConfigService.get(tenantId);
  const db = await inventoryRepository.readAsync();
  let products = Array.isArray(db.products) ? db.products : [];

  // P0-1: per-tenant visibility overlay (server-side).
  products = _applyVisibility(products, cfg);

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
      String(p.barcode || '').toLowerCase().includes(q)
    );
  }

  const sortBy = query.sortBy || 'name';
  const order = query.sortOrder === 'desc' ? -1 : 1;
  products.sort((a, b) => {
    let va = a[sortBy];
    let vb = b[sortBy];
    if (sortBy === 'price' || sortBy === 'stockQty') {
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else {
      va = String(va || '').toLowerCase();
      vb = String(vb || '').toLowerCase();
    }
    return va < vb ? -order : va > vb ? order : 0;
  });

  const page = _paginate(products, query.page, query.limit);
  return {
    products: page.items.map((p) => _project(p, cfg)),
    total: page.total,
    page: page.page,
    limit: page.limit,
    totalPages: page.totalPages
  };
}

async function getProduct(tenantId, id) {
  const cfg = marketConfigService.get(tenantId);
  const db = await inventoryRepository.readAsync();
  const product = (Array.isArray(db.products) ? db.products : []).find((p) => String(p.id) === String(id));
  if (!product) return null;
  // P0-1: per-tenant visibility — a tenant must not retrieve a product
  // it cannot list. Return null (NOT 404 with a leak) to match the
  // listProducts semantics.
  const allow = marketConfigService.resolveProductVisibility(cfg);
  if (!allow(product.id)) return null;
  return _project(product, cfg);
}

async function categories(tenantId) {
  const cfg = marketConfigService.get(tenantId);
  const db = await inventoryRepository.readAsync();
  const products = _applyVisibility(Array.isArray(db.products) ? db.products : [], cfg);
  const counts = new Map();
  products.forEach((p) => {
    if (p.categoryId != null) {
      const key = String(p.categoryId);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  });
  return [...counts.entries()].map(([id, count]) => ({ id, count }));
}

async function search(tenantId, q) {
  return listProducts(tenantId, { search: q, includeOutOfStock: 'true' });
}

async function availability(tenantId, ids) {
  const cfg = marketConfigService.get(tenantId);
  const db = await inventoryRepository.readAsync();
  const products = Array.isArray(db.products) ? db.products : [];
  const allow = marketConfigService.resolveProductVisibility(cfg);
  return ids.map((id) => {
    // P0-1: hide existence + stock for products the tenant cannot list.
    // Return a stockQty=0, available=false row to avoid leaking whether
    // the product exists at all.
    if (!allow(id)) return { id, stockQty: 0, available: false, hidden: true };
    const p = products.find((x) => String(x.id) === String(id));
    const stock = p ? Number(p.stockQty) || 0 : 0;
    return { id, stockQty: stock, available: stock > 0 };
  });
}

module.exports = { listProducts, getProduct, categories, search, availability, _project };
