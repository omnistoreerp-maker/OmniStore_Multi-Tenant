'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const BaseRepository = require('../repositories/BaseRepository');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const companyProfileService = require('./companyProfile.service');

const salesRepo = new BaseRepository('sales');
const purchasesRepo = new BaseRepository('purchases');
const customersRepo = new BaseRepository('customers');
const inventoryTransactionsRepo = new BaseRepository('inventoryTransactions');
const productsRepo = new BaseRepository('products');

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  return t != null ? String(t) : null;
}

function _iso(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(Math.floor(Math.random() * 12) + 8, Math.floor(Math.random() * 60), 0, 0);
  return d.toISOString();
}

async function _loadRaw(repo) {
  return repo._rawStoreAsync ? repo._rawStoreAsync() : repo.readAsync();
}

async function _saveRaw(repo, data) {
  if (repo._rawStoreAsync) return repo._rawStoreAsync(data);
  return repo.writeAsync(data);
}

async function _appendEntity(repo, collectionKey, entity) {
  const db = await _loadRaw(repo);
  if (!db || typeof db !== 'object') db = {};
  if (!Array.isArray(db[collectionKey])) db[collectionKey] = [];
  db[collectionKey].push(entity);
  await _saveRaw(repo, db);
  return entity;
}

async function seedDemoData(tenantContext, businessType) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required for demo seeding');

  const type = String(businessType || 'Retail').trim();

  const demoProducts = [
    { id: 'demo-p1', name: 'Smartphone X200', sku: 'MOB-X200', categoryId: 'electronics', sellPrice: 8500, buyPrice: 6200, stockQty: 25, hasSerial: false },
    { id: 'demo-p2', name: 'Wireless Earbuds Pro', sku: 'AUD-WEP', categoryId: 'electronics', sellPrice: 1200, buyPrice: 750, stockQty: 50, hasSerial: false },
    { id: 'demo-p3', name: 'USB-C Charger 65W', sku: 'ACC-65W', categoryId: 'accessories', sellPrice: 450, buyPrice: 280, stockQty: 100, hasSerial: false },
    { id: 'demo-p4', name: 'Laptop Stand', sku: 'ACC-LS1', categoryId: 'accessories', sellPrice: 600, buyPrice: 350, stockQty: 30, hasSerial: false },
    { id: 'demo-p5', name: 'HDMI Cable 2m', sku: 'CAB-HDMI', categoryId: 'cables', sellPrice: 150, buyPrice: 80, stockQty: 200, hasSerial: false }
  ];

  const demoCustomers = [
    { id: 'demo-c1', name: 'Ahmed Hassan', phone: '0100000001', address: 'Cairo', balance: 0 },
    { id: 'demo-c2', name: 'Sara Ali', phone: '0100000002', address: 'Giza', balance: 150 },
    { id: 'demo-c3', name: 'Mohamed Farouk', phone: '0100000003', address: 'Alexandria', balance: 0 }
  ];

  const demoSales = [
    { id: 'demo-inv-001', invoiceNumber: 'DEMO-001', customerName: 'Ahmed Hassan', customerId: 'demo-c1', paymentType: 'Cash', items: [{ productId: 'demo-p1', productName: 'Smartphone X200', quantity: 1, unitPrice: 8500, lineTotal: 8500 }], total: 8500, subtotal: 8500, tax: 0, discount: 0, grandTotal: 8500, date: _iso(2), createdAt: _iso(2), updatedAt: _iso(2) },
    { id: 'demo-inv-002', invoiceNumber: 'DEMO-002', customerName: 'Sara Ali', customerId: 'demo-c2', paymentType: 'Card', items: [{ productId: 'demo-p2', productName: 'Wireless Earbuds Pro', quantity: 2, unitPrice: 1200, lineTotal: 2400 }], total: 2400, subtotal: 2400, tax: 0, discount: 100, grandTotal: 2300, date: _iso(1), createdAt: _iso(1), updatedAt: _iso(1) },
    { id: 'demo-inv-003', invoiceNumber: 'DEMO-003', customerName: 'Mohamed Farouk', customerId: 'demo-c3', paymentType: 'Cash', items: [{ productId: 'demo-p3', productName: 'USB-C Charger 65W', quantity: 3, unitPrice: 450, lineTotal: 1350 }], total: 1350, subtotal: 1350, tax: 0, discount: 0, grandTotal: 1350, date: _iso(0), createdAt: _iso(0), updatedAt: _iso(0) }
  ];

  const demoPurchases = [
    { id: 'demo-pur-001', invoiceNumber: 'DEMO-P001', supplierName: 'TechDistributor Co.', paymentType: 'Bank Transfer', items: [{ productId: 'demo-p1', productName: 'Smartphone X200', quantity: 10, unitPrice: 6200, lineTotal: 62000 }], total: 62000, subtotal: 62000, tax: 0, discount: 500, grandTotal: 61500, date: _iso(5), createdAt: _iso(5), updatedAt: _iso(5) },
    { id: 'demo-pur-002', invoiceNumber: 'DEMO-P002', supplierName: 'AccessoriesHub', paymentType: 'Cash', items: [{ productId: 'demo-p3', productName: 'USB-C Charger 65W', quantity: 50, unitPrice: 280, lineTotal: 14000 }], total: 14000, subtotal: 14000, tax: 0, discount: 0, grandTotal: 14000, date: _iso(4), createdAt: _iso(4), updatedAt: _iso(4) }
  ];

  const demoTransactions = [
    { id: 'demo-tx-1', productId: 'demo-p1', type: 'sale', qty: 1, stockAfter: 24, reason: 'Demo sale', user: 'system', date: _iso(2) },
    { id: 'demo-tx-2', productId: 'demo-p2', type: 'sale', qty: 2, stockAfter: 48, reason: 'Demo sale', user: 'system', date: _iso(1) },
    { id: 'demo-tx-3', productId: 'demo-p3', type: 'sale', qty: 3, stockAfter: 97, reason: 'Demo sale', user: 'system', date: _iso(0) },
    { id: 'demo-tx-4', productId: 'demo-p1', type: 'purchase', qty: 10, stockAfter: 34, reason: 'Demo purchase', user: 'system', date: _iso(5) },
    { id: 'demo-tx-5', productId: 'demo-p3', type: 'purchase', qty: 50, stockAfter: 147, reason: 'Demo purchase', user: 'system', date: _iso(4) }
  ];

  const created = {
    products: [],
    customers: [],
    sales: [],
    purchases: [],
    transactions: []
  };

  for (const p of demoProducts) {
    const entity = Object.assign({}, p, { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await _appendEntity(productsRepo, 'products', entity);
    created.products.push(entity);
  }

  for (const c of demoCustomers) {
    const entity = Object.assign({}, c, { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await _appendEntity(customersRepo, 'customers', entity);
    created.customers.push(entity);
  }

  for (const inv of demoSales) {
    const entity = Object.assign({}, inv, { tenantId: tid, createdAt: inv.createdAt, updatedAt: inv.updatedAt });
    await _appendEntity(salesRepo, 'invoices', entity);
    created.sales.push(entity);
  }

  for (const pur of demoPurchases) {
    const entity = Object.assign({}, pur, { tenantId: tid, createdAt: pur.createdAt, updatedAt: pur.updatedAt });
    await _appendEntity(purchasesRepo, 'invoices', entity);
    created.purchases.push(entity);
  }

  for (const tx of demoTransactions) {
    const entity = Object.assign({}, tx, { tenantId: tid, createdAt: tx.date, updatedAt: tx.date });
    await _appendEntity(inventoryTransactionsRepo, 'transactions', entity);
    created.transactions.push(entity);
  }

  return created;
}

async function completeOnboarding(tenantContext, data) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');

  const companyId = tid;
  const existing = companyProfileService.getProfile(companyId);
  const profile = Object.assign({}, existing || companyProfileService.getDefaultProfile(companyId), {
    companyId,
    identity: Object.assign({}, existing ? existing.identity : {}, {
      displayName: String(data.storeName || existing?.identity?.displayName || 'My Store').trim(),
      category: String(data.businessType || existing?.identity?.category || '').trim(),
      status: 'ACTIVE'
    }),
    contact: Object.assign({}, existing ? existing.contact : {}, {
      currency: String(data.currency || existing?.contact?.currency || 'EGP').trim(),
      timezone: String(data.timezone || existing?.contact?.timezone || 'Africa/Cairo').trim()
    }),
    lastUpdated: new Date().toISOString()
  });

  const saved = companyProfileService.saveProfile(profile);
  return {
    companyId: saved.companyId,
    storeName: saved.identity.displayName,
    businessType: saved.identity.category,
    currency: saved.contact.currency,
    timezone: saved.contact.timezone,
    completed: true
  };
}

async function getOnboardingStatus(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) return { completed: false };
  const profile = companyProfileService.getProfile(tid);
  if (!profile) return { completed: false };
  const meta = profile.identity || {};
  return {
    completed: meta.status === 'ACTIVE' && !!profile.identity.displayName,
    storeName: meta.displayName || '',
    businessType: meta.category || '',
    currency: profile.contact?.currency || 'EGP',
    timezone: profile.contact?.timezone || 'Africa/Cairo'
  };
}

module.exports = {
  completeOnboarding,
  getOnboardingStatus,
  seedDemoData
};
