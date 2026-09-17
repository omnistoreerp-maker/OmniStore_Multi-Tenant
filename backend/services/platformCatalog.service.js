'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'platformPublic';
const DATA_FILE = 'platformPublic.json';

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('platformCatalog.service: failed to read store, falling back to file', err.message);
  }
  try {
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, '..', 'data', DATA_FILE);
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    }
  } catch (fileErr) {
    logger.warn('platformCatalog.service: failed to read fallback file', fileErr.message);
  }
  return null;
}

function _defaultDoc() {
  return {
    meta: {
      name: 'OmniStore ERP',
      tagline: 'Multi-Tenant Enterprise Resource Planning',
      version: '1.0.0',
      lastUpdated: new Date().toISOString()
    },
    features: [
      { id: 'sales', title: 'Sales', description: 'Point of Sale, orders, invoices and payments', icon: 'fa-cart-shopping' },
      { id: 'purchases', title: 'Purchases', description: 'Vendor management, purchase orders and receiving', icon: 'fa-truck' },
      { id: 'inventory', title: 'Inventory', description: 'Stock tracking, warehouses, transfers and adjustments', icon: 'fa-boxes-stacked' },
      { id: 'accounting', title: 'Accounting', description: 'Chart of accounts, journals, ledgers and reports', icon: 'fa-book' },
      { id: 'customers', title: 'Customers', description: 'Customer CRM, pricing tiers and loyalty', icon: 'fa-users' },
      { id: 'suppliers', title: 'Suppliers', description: 'Supplier directory, terms and purchase history', icon: 'fa-truck-field' }
    ],
    stats: [
      { label: 'Tenants', value: '0', description: 'Active companies' },
      { label: 'Modules', value: '6+', description: 'Core business modules' },
      { label: 'Uptime', value: '99.9%', description: 'Service availability' }
    ],
    highlights: [
      { title: 'Multi-Tenant by Design', body: 'Every company is fully isolated with its own data, users and branches.' },
      { title: 'Real-Time Sync', body: 'Changes propagate instantly across sales, inventory and accounting.' },
      { title: 'Role-Based Access', body: 'Granular permissions keep every user within their scope.' }
    ]
  };
}

function getCatalog() {
  const store = _readStore();
  if (!store) return _defaultDoc();
  return store;
}

function getDefaultDoc() {
  return _defaultDoc();
}

module.exports = {
  getCatalog,
  getDefaultDoc
};
