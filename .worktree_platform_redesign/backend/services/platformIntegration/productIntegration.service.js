'use strict';

// Platform Integration — Product Contract
//
// ERP is the source of truth for products.
// Platform consumes via this contract.
// Platform never writes to the ERP product store.
//
// Authoritative source: backend/services/inventory.service.js
// Storage: backend/repositories/products repository (products.json)
//
// PUBLIC QUERY CONTRACT:
// Only the following query parameters are exposed publicly:
//   search, name, categoryId, brandId, hasSerial, sortBy, sortOrder, page, limit
// Any other query parameters are silently ignored to prevent accidental
// exposure of internal ERP filter behavior.

const inventoryService = require('../inventory.service');

const ALLOWED_QUERY_KEYS = new Set([
  'search',
  'name',
  'categoryId',
  'brandId',
  'hasSerial',
  'sortBy',
  'sortOrder',
  'page',
  'limit'
]);

function _sanitizeQuery(query) {
  if (!query || typeof query !== 'object') return {};
  const out = {};
  for (const key of Object.keys(query)) {
    if (ALLOWED_QUERY_KEYS.has(key)) {
      out[key] = query[key];
    }
  }
  return out;
}

function _sanitizeProduct(p) {
  if (!p) return null;
  return {
    id: String(p.id || p._backendId || ''),
    sku: String(p.sku || ''),
    barcode: String(p.barcode || ''),
    name: String(p.name || ''),
    description: String(p.description || ''),
    category: String(p.category || ''),
    buyPrice: typeof p.buyPrice === 'number' ? p.buyPrice : null,
    sellPrice: typeof p.sellPrice === 'number' ? p.sellPrice : null,
    currency: String(p.currency || 'USD'),
    active: p.active !== false,
    trackInventory: p.trackInventory !== false,
    stockQty: typeof p.stockQty === 'number' ? p.stockQty : 0,
    lowStockThreshold: typeof p.lowStockThreshold === 'number' ? p.lowStockThreshold : 0,
    serialTracked: !!p.serialTracked,
    createdAt: p.createdAt || null,
    updatedAt: p.updatedAt || null
  };
}

async function getProductById(productId) {
  if (!productId) return null;
  try {
    const product = await inventoryService.getById(productId);
    return _sanitizeProduct(product);
  } catch (err) {
    return null;
  }
}

async function listProducts(query) {
  try {
    const sanitized = _sanitizeQuery(query || {});
    const result = await inventoryService.list(sanitized);
    const products = (result && result.products) || [];
    return products.map(_sanitizeProduct);
  } catch (err) {
    return [];
  }
}

module.exports = {
  getProductById,
  listProducts
};
