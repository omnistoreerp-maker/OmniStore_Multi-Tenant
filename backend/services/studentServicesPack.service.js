'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');
const whatsappClient = require('./whatsappClient.service');

const STORE_KEY = 'studentServicesPack';

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('studentServicesPack.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(data) {
  try {
    storageAdapter.write(STORE_KEY, data);
  } catch (err) {
    logger.warn('studentServicesPack.service: failed to write store', err.message);
  }
}

function _defaultDoc() {
  return {
    printRates: [],
    printOrders: [],
    studentPasses: [],
    settings: {
      whatsappNumber: '',
      currency: 'EGP'
    }
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

function _findRate(rates, paperSize, printType, duplexType) {
  return rates.find(r =>
    r.paperSize === paperSize &&
    r.printType === printType &&
    r.duplexType === duplexType
  ) || null;
}

function listRates(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  const doc = _readStore();
  const rates = Array.isArray(doc.printRates) ? doc.printRates : [];
  return rates.filter(r => String(r.tenantId || '') === tid);
}

function upsertRate(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const rates = Array.isArray(doc.printRates) ? doc.printRates : [];

  const paperSize = String(data.paperSize || 'A4');
  const printType = String(data.printType || 'bw');
  const duplexType = String(data.duplexType || 'single');
  const pricePerPage = Math.max(0, parseFloat(data.pricePerPage || 0));
  const bindingPrice = Math.max(0, parseFloat(data.bindingPrice || 0));

  if (pricePerPage <= 0) throw new Error('pricePerPage must be greater than 0');

  const existingIdx = rates.findIndex(r =>
    String(r.tenantId || '') === tid &&
    r.paperSize === paperSize &&
    r.printType === printType &&
    r.duplexType === duplexType
  );

  const record = {
    id: existingIdx >= 0 ? rates[existingIdx].id : _generateId('rate'),
    tenantId: tid,
    paperSize,
    printType,
    duplexType,
    pricePerPage,
    bindingPrice,
    updatedAt: _now()
  };

  if (existingIdx >= 0) {
    rates[existingIdx] = Object.assign({}, rates[existingIdx], record);
  } else {
    rates.push(record);
  }

  doc.printRates = rates;
  _writeStore(doc);
  return record;
}

function deleteRate(tenantContext, rateId) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const rates = Array.isArray(doc.printRates) ? doc.printRates : [];
  const filtered = rates.filter(r => !(String(r.tenantId || '') === tid && String(r.id) === String(rateId)));
  if (filtered.length === rates.length) return false;

  doc.printRates = filtered;
  _writeStore(doc);
  return true;
}

function calculateCost(tenantContext, pages, copies, paperSize, printType, duplexType, hasBinding) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  const doc = _readStore();
  const rates = Array.isArray(doc.printRates) ? doc.printRates : [];
  const tenantRates = rates.filter(r => String(r.tenantId || '') === tid);

  const rate = _findRate(tenantRates, paperSize, printType, duplexType);
  if (!rate) throw new Error('No print rate configured for the selected options');

  const safePages = Math.max(1, parseInt(pages, 10) || 1);
  const safeCopies = Math.max(1, parseInt(copies, 10) || 1);
  const pageCost = safePages * safeCopies * rate.pricePerPage;
  const bindingCost = hasBinding ? rate.bindingPrice : 0;

  return {
    totalAmount: Math.round((pageCost + bindingCost) * 100) / 100,
    breakdown: {
      pages: safePages,
      copies: safeCopies,
      pricePerPage: rate.pricePerPage,
      pageCost: Math.round(pageCost * 100) / 100,
      bindingCost: Math.round(bindingCost * 100) / 100
    }
  };
}

function createOrder(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const studentName = String(data.studentName || '').trim();
  const studentPhone = String(data.studentPhone || '').trim();
  const documentName = String(data.documentName || '').trim();
  const totalPages = Math.max(1, parseInt(data.totalPages, 10) || 1);
  const copies = Math.max(1, parseInt(data.copies, 10) || 1);
  const paperSize = String(data.paperSize || 'A4');
  const printType = String(data.printType || 'bw');
  const duplexType = String(data.duplexType || 'single');
  const hasBinding = !!data.hasBinding;
  const notes = String(data.notes || '').trim();

  if (!studentPhone) throw new Error('studentPhone is required');

  const cost = calculateCost({ tenantId: tid }, totalPages, copies, paperSize, printType, duplexType, hasBinding);

  const doc = _readStore();
  const orders = Array.isArray(doc.printOrders) ? doc.printOrders : [];

  const order = {
    id: _generateId('order'),
    orderRef: _generateId('PRN'),
    tenantId: tid,
    studentName: studentName || null,
    studentPhone,
    documentName: documentName || null,
    totalPages,
    copies,
    paperSize,
    printType,
    duplexType,
    hasBinding,
    totalAmount: cost.totalAmount,
    status: 'pending',
    notes: notes || null,
    createdAt: _now(),
    updatedAt: _now()
  };

  orders.unshift(order);
  doc.printOrders = orders;
  _writeStore(doc);

  return { order, cost };
}

function listOrders(tenantContext, query = {}) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  const doc = _readStore();
  let orders = Array.isArray(doc.printOrders) ? doc.printOrders : [];
  orders = orders.filter(o => String(o.tenantId || '') === tid);

  const status = query.status;
  if (status) {
    orders = orders.filter(o => o.status === status);
  }

  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    orders = orders.filter(o =>
      (o.studentName || '').toLowerCase().includes(search) ||
      (o.documentName || '').toLowerCase().includes(search) ||
      (o.orderRef || '').toLowerCase().includes(search) ||
      (o.studentPhone || '').includes(search)
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

function updateOrderStatus(tenantContext, orderId, status) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const allowed = ['pending', 'printing', 'ready', 'delivered'];
  const nextStatus = String(status || '').trim();
  if (!allowed.includes(nextStatus)) throw new Error('Invalid status: ' + nextStatus);

  const doc = _readStore();
  const orders = Array.isArray(doc.printOrders) ? doc.printOrders : [];
  const idx = orders.findIndex(o => String(o.id) === String(orderId) && String(o.tenantId || '') === tid);
  if (idx === -1) return null;

  orders[idx] = Object.assign({}, orders[idx], { status: nextStatus, updatedAt: _now() });
  doc.printOrders = orders;
  _writeStore(doc);
  return orders[idx];
}

function createPass(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const studentName = String(data.studentName || '').trim();
  const studentPhone = String(data.studentPhone || '').trim();
  const passType = String(data.passType || 'monthly');
  const month = String(data.month || '').trim();
  const year = Math.max(2000, parseInt(data.year, 10) || new Date().getFullYear());
  const amount = Math.max(0, parseFloat(data.amount || 0));

  if (!studentPhone) throw new Error('studentPhone is required');
  if (!month) throw new Error('month is required (YYYY-MM)');

  const doc = _readStore();
  const passes = Array.isArray(doc.studentPasses) ? doc.studentPasses : [];

  const pass = {
    id: _generateId('pass'),
    tenantId: tid,
    studentName: studentName || null,
    studentPhone,
    passType: ['monthly', 'weekly'].includes(passType) ? passType : 'monthly',
    month,
    year,
    amount: Math.round(amount * 100) / 100,
    status: 'active',
    createdAt: _now(),
    updatedAt: _now()
  };

  passes.unshift(pass);
  doc.studentPasses = passes;
  _writeStore(doc);
  return pass;
}

function listPasses(tenantContext, query = {}) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  const doc = _readStore();
  let passes = Array.isArray(doc.studentPasses) ? doc.studentPasses : [];
  passes = passes.filter(p => String(p.tenantId || '') === tid);

  const month = String(query.month || '').trim();
  if (month) {
    passes = passes.filter(p => p.month === month);
  }

  const year = query.year ? parseInt(query.year, 10) : null;
  if (year) {
    passes = passes.filter(p => p.year === year);
  }

  passes.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
  const start = (page - 1) * limit;
  const paginated = passes.slice(start, start + limit);

  return {
    passes: paginated,
    total: passes.length,
    page,
    limit,
    totalPages: Math.ceil(passes.length / limit) || 1
  };
}

function _tenantSettings(doc, tid) {
  const byTenant = doc.tenantSettings && typeof doc.tenantSettings === 'object' ? doc.tenantSettings : {};
  const current = byTenant[tid] || {};
  return {
    whatsappNumber: String(current.whatsappNumber || ''),
    currency: String(current.currency || 'EGP')
  };
}

function getSettings(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  return _tenantSettings(_readStore(), tid);
}

function updateSettings(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const current = _tenantSettings(doc, tid);
  const next = {
    whatsappNumber: String(data.whatsappNumber || current.whatsappNumber || '').trim(),
    currency: String(data.currency || current.currency || 'EGP').trim()
  };
  doc.tenantSettings = Object.assign({}, doc.tenantSettings || {}, { [tid]: next });
  _writeStore(doc);
  return next;
}

async function sendOrderReceipt(tenantContext, orderId) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const doc = _readStore();
  const orders = Array.isArray(doc.printOrders) ? doc.printOrders : [];
  const order = orders.find(o => String(o.id) === String(orderId) && String(o.tenantId || '') === tid);
  if (!order) throw new Error('Order not found');

  const settings = _tenantSettings(doc, tid);
  const phone = String(settings.whatsappNumber || order.studentPhone || '').trim();
  if (!phone) throw new Error('No WhatsApp number configured');

  const message = [
    '🧾 *Print Order Receipt*',
    'Ref: ' + order.orderRef,
    'Student: ' + (order.studentName || '—'),
    'Document: ' + (order.documentName || '—'),
    'Pages: ' + order.totalPages + ' x ' + order.copies + ' copy(s)',
    'Paper: ' + order.paperSize + ' | ' + (order.printType === 'bw' ? 'B&W' : 'Color') + ' | ' + (order.duplexType === 'single' ? 'Simplex' : 'Duplex'),
    'Binding: ' + (order.hasBinding ? 'Yes' : 'No'),
    'Total: EGP ' + order.totalAmount.toFixed(2),
    'Status: ' + order.status
  ].join('\n');

  const result = await whatsappClient.sendWhatsAppMessage({
    tenantId: tid,
    to: phone,
    template: 'print_receipt',
    variables: {
      orderRef: order.orderRef,
      studentName: order.studentName || 'Student',
      documentName: order.documentName || 'Document',
      totalPages: String(order.totalPages),
      copies: String(order.copies),
      paperSize: order.paperSize,
      printType: order.printType,
      duplexType: order.duplexType,
      hasBinding: order.hasBinding ? 'Yes' : 'No',
      totalAmount: 'EGP ' + order.totalAmount.toFixed(2),
      status: order.status
    }
  });

  return { ok: result && result.ok, messageId: result && result.messageId };
}

module.exports = {
  listRates,
  upsertRate,
  deleteRate,
  calculateCost,
  createOrder,
  listOrders,
  updateOrderStatus,
  createPass,
  listPasses,
  getSettings,
  updateSettings,
  sendOrderReceipt
};
