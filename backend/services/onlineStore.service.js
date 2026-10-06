'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const whatsappClient = require('./whatsappClient.service');

const STORE_KEY = 'onlineStore';

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('onlineStore.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(data) {
  try {
    storageAdapter.write(STORE_KEY, data);
  } catch (err) {
    logger.warn('onlineStore.service: failed to write store', err.message);
  }
}

function _defaultDoc() {
  return {
    storeConfigs: [],
    onlineOrders: []
  };
}

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  return t != null ? String(t) : null;
}

function _now() {
  return new Date().toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _normalizeSlug(slug) {
  return String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'store';
}

function getStoreConfig(tenantContext) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const configs = Array.isArray(doc.storeConfigs) ? doc.storeConfigs : [];
  if (!tid) return null;
  return configs.find(c => String(c.tenantId || '') === tid) || null;
}

function upsertStoreConfig(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const configs = Array.isArray(doc.storeConfigs) ? doc.storeConfigs : [];
  const existingIdx = configs.findIndex(c => String(c.tenantId || '') === tid);

  const storeName = String(data.storeName || '').trim();
  const storeSlug = _normalizeSlug(data.storeSlug || data.storeName || '');
  const whatsappNumber = String(data.whatsappNumber || '').trim();
  const isActive = data.isActive !== undefined ? !!data.isActive : true;
  const deliveryFee = Math.max(0, parseFloat(data.deliveryFee || 0));
  const minOrderAmount = Math.max(0, parseFloat(data.minOrderAmount || 0));
  const bannerUrl = data.bannerUrl ? String(data.bannerUrl).trim() : null;

  if (!storeName) throw new Error('storeName is required');
  if (!whatsappNumber) throw new Error('whatsappNumber is required');

  const slugCollision = configs.find(c => String(c.storeSlug || '') === storeSlug && String(c.tenantId || '') !== tid);
  if (slugCollision) throw new Error('storeSlug already in use');

  const record = {
    id: existingIdx >= 0 ? configs[existingIdx].id : _generateId('store'),
    tenantId: tid,
    storeName,
    storeSlug,
    whatsappNumber,
    isActive,
    deliveryFee,
    minOrderAmount,
    bannerUrl,
    createdAt: existingIdx >= 0 ? (configs[existingIdx].createdAt || _now()) : _now(),
    updatedAt: _now()
  };

  if (existingIdx >= 0) {
    configs[existingIdx] = Object.assign({}, configs[existingIdx], record);
  } else {
    configs.push(record);
  }

  doc.storeConfigs = configs;
  _writeStore(doc);
  return record;
}

function listActiveStoreConfigs() {
  const doc = _readStore();
  const configs = Array.isArray(doc.storeConfigs) ? doc.storeConfigs : [];
  return configs.filter(c => !!c.isActive);
}

function getStoreConfigBySlug(storeSlug) {
  const slug = _normalizeSlug(storeSlug);
  const doc = _readStore();
  const configs = Array.isArray(doc.storeConfigs) ? doc.storeConfigs : [];
  return configs.find(c => String(c.storeSlug || '') === slug && !!c.isActive) || null;
}

function createOnlineOrder(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const storeConfig = getStoreConfig({ tenantId: tid });
  if (!storeConfig) throw new Error('Store not configured for this tenant');

  const customerName = String(data.customerName || '').trim();
  const customerPhone = String(data.customerPhone || '').trim();
  const customerAddress = data.customerAddress ? String(data.customerAddress).trim() : null;
  const items = Array.isArray(data.items) ? data.items : [];
  const notes = data.notes ? String(data.notes).trim() : null;

  if (!customerName) throw new Error('customerName is required');
  if (!customerPhone) throw new Error('customerPhone is required');
  // Validation hardening: the old `!items.length === 0` guard never fired
  // (always false), so an empty items array produced a zero-total order, and
  // a null/non-object element crashed the reducer with a TypeError (500).
  if (!items.length) throw new Error('items must be a non-empty array');

  const sanitizedItems = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('each item must be an object');
    const itemCode = String(item.itemCode || item.id || '').trim();
    if (!itemCode) throw new Error('each item requires an itemCode');
    const quantity = Math.max(1, parseInt(item.quantity, 10) || 1);
    const rawPrice = typeof item.price === 'number' ? item.price : parseFloat(String(item.price).trim(), 10);
    if (!Number.isFinite(rawPrice) || rawPrice < 0 || !/^[0-9]+(\.[0-9]+)?$/.test(String(item.price).trim())) {
      throw new Error('item price must be a non-negative number');
    }
    const price = rawPrice;
    sanitizedItems.push({
      itemCode,
      title: String(item.title || item.name || 'Item').trim(),
      quantity,
      price: Math.round(price * 100) / 100
    });
  }

  const subtotal = Math.round(sanitizedItems.reduce((sum, item) => sum + (item.quantity * item.price), 0) * 100) / 100;

  const deliveryFee = storeConfig.deliveryFee || 0;
  const totalAmount = Math.round((subtotal + deliveryFee) * 100) / 100;

  if (storeConfig.minOrderAmount && totalAmount < storeConfig.minOrderAmount) {
    throw new Error('Minimum order amount is ' + storeConfig.minOrderAmount);
  }

  const doc = _readStore();
  const orders = Array.isArray(doc.onlineOrders) ? doc.onlineOrders : [];

  const order = {
    id: _generateId('order'),
    orderRef: _generateId('ORD'),
    tenantId: tid,
    customerName,
    customerPhone,
    customerAddress,
    items: sanitizedItems,
    subtotal,
    deliveryFee,
    totalAmount,
    status: 'pending',
    notes,
    createdAt: _now(),
    updatedAt: _now()
  };

  orders.unshift(order);
  doc.onlineOrders = orders;
  _writeStore(doc);

  _sendOrderWhatsApp(storeConfig, order).catch(err => {
    logger.warn('onlineStore.service: failed to send WhatsApp notification', err.message);
  });

  return { order };
}

function getOnlineOrder(tenantContext, orderId) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const orders = Array.isArray(doc.onlineOrders) ? doc.onlineOrders : [];
  if (!tid) return null;
  return orders.find(o => String(o.tenantId || '') === tid && String(o.id) === String(orderId)) || null;
}

function listOnlineOrders(tenantContext, query = {}) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let orders = Array.isArray(doc.onlineOrders) ? doc.onlineOrders : [];

  if (tid) {
    orders = orders.filter(o => String(o.tenantId || '') === tid);
  }

  const status = String(query.status || '').trim().toLowerCase();
  if (status) {
    orders = orders.filter(o => String(o.status || '').toLowerCase() === status);
  }

  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    orders = orders.filter(o =>
      (o.customerName || '').toLowerCase().includes(search) ||
      (o.customerPhone || '').includes(search) ||
      (o.orderRef || '').toLowerCase().includes(search)
    );
  }

  orders.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const start = (page - 1) * limit;
  const paginated = orders.slice(start, start + limit);

  return {
    orders: paginated,
    total: orders.length,
    page,
    limit,
    totalPages: Math.ceil(orders.length / limit) || 1
  };
}

function updateOnlineOrderStatus(tenantContext, orderId, status) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const allowed = ['pending', 'confirmed', 'shipped', 'cancelled'];
  const safeStatus = allowed.includes(status) ? status : 'pending';

  const doc = _readStore();
  const orders = Array.isArray(doc.onlineOrders) ? doc.onlineOrders : [];
  const idx = orders.findIndex(o => String(o.tenantId || '') === tid && String(o.id) === String(orderId));
  if (idx === -1) return null;

  orders[idx] = Object.assign({}, orders[idx], {
    status: safeStatus,
    updatedAt: _now()
  });

  doc.onlineOrders = orders;
  _writeStore(doc);
  return orders[idx];
}

async function _sendOrderWhatsApp(storeConfig, order) {
  if (!storeConfig || !storeConfig.whatsappNumber) return;

  const itemLines = (order.items || []).map(item => {
    const total = Math.round((item.quantity * item.price) * 100) / 100;
    return '- ' + item.title + ' x' + item.quantity + ' = EGP ' + total.toFixed(2);
  }).join('\n');

  const message = [
    'New Online Store Order',
    'Order Ref: ' + order.orderRef,
    'Customer: ' + order.customerName,
    'Phone: ' + order.customerPhone,
    order.customerAddress ? 'Address: ' + order.customerAddress : '',
    '',
    'Items:',
    itemLines,
    '',
    'Subtotal: EGP ' + order.subtotal.toFixed(2),
    'Delivery: EGP ' + order.deliveryFee.toFixed(2),
    'Total: EGP ' + order.totalAmount.toFixed(2),
    '',
    'Status: ' + order.status
  ].filter(Boolean).join('\n');

  await whatsappClient.sendText({
    to: storeConfig.whatsappNumber,
    message: message
  });
}

module.exports = {
  getStoreConfig,
  upsertStoreConfig,
  listActiveStoreConfigs,
  getStoreConfigBySlug,
  createOnlineOrder,
  getOnlineOrder,
  listOnlineOrders,
  updateOnlineOrderStatus
};
