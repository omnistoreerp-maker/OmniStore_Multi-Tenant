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
    ],
    sections: [
      {
        id: 'marketplace',
        title: 'Marketplace',
        description: 'Visitor-facing marketplace for products and services.',
        status: 'active',
        url: '/market.html',
        icon: 'fa-store'
      },
      {
        id: 'business-services',
        title: 'Business Management Services',
        description: 'Existing company access and new company onboarding.',
        status: 'active',
        url: '/business.html',
        icon: 'fa-building'
      },
      {
        id: 'student-services',
        title: 'Student Services & Printing',
        description: 'Print shop orders, cost calculator, and student monthly passes.',
        status: 'active',
        url: '/student.html',
        icon: 'fa-graduation-cap'
      },
      {
        id: 'game-hosting',
        title: 'Game Hosting',
        description: 'Host and manage game sessions and catalogs.',
        status: 'under-construction',
        url: null,
        icon: 'fa-gamepad'
      },
      {
        id: 'media-reels',
        title: 'Media / Reels',
        description: 'Media content and reels sharing.',
        status: 'coming-soon',
        url: null,
        icon: 'fa-film'
      },
      {
        id: 'support',
        title: 'Support',
        description: 'Help center, tickets, and customer requests.',
        status: 'coming-soon',
        url: null,
        icon: 'fa-headset'
      }
    ]
  };
}

const ALLOWED_ACTIVE_URLS = {
  '/market.html': true,
  '/business.html': true,
  '/student.html': true,
  '/index.html': true,
  '/platform.html': true
};

const ALLOWED_STATUSES = {
  active: true,
  'under-construction': true,
  'coming-soon': true
};

function _dedupeSections(sections) {
  if (!Array.isArray(sections)) return [];
  const seen = new Set();
  const out = [];
  for (const section of sections) {
    if (!section || !section.id || seen.has(section.id)) continue;
    seen.add(section.id);
    out.push(section);
  }
  return out;
}

function _normalizeSection(section, fallback) {
  const base = Object.assign({}, fallback || {}, section || {});
  if (!base.id) return null;

  const rawStatus = String(base.status || 'coming-soon');
  let status = ALLOWED_STATUSES[rawStatus] ? rawStatus : 'coming-soon';
  let url = base.url ? String(base.url) : null;
  if (url === '') url = null;

  if (status === 'active') {
    if (!url || !ALLOWED_ACTIVE_URLS[url]) {
      status = 'under-construction';
      url = null;
    }
  } else {
    url = null;
  }

  return {
    id: String(base.id),
    title: String(base.title || (fallback && fallback.title) || base.id),
    description: String(base.description || (fallback && fallback.description) || ''),
    status,
    url,
    icon: String(base.icon || (fallback && fallback.icon) || 'fa-circle')
  };
}

function _mergeSections(storeSections, defaultSections) {
  const defaultsById = {};
  const defaults = Array.isArray(defaultSections) ? defaultSections : [];
  for (let i = 0; i < defaults.length; i++) {
    const item = defaults[i];
    if (item && item.id) defaultsById[item.id] = item;
  }

  const merged = [];
  const seen = new Set();
  const stored = _dedupeSections(storeSections);

  for (let i = 0; i < stored.length; i++) {
    const normalized = _normalizeSection(stored[i], defaultsById[stored[i].id]);
    if (!normalized) continue;
    seen.add(normalized.id);
    merged.push(normalized);
  }

  for (let i = 0; i < defaults.length; i++) {
    const item = defaults[i];
    if (!item || !item.id || seen.has(item.id)) continue;
    const normalized = _normalizeSection(item, item);
    if (normalized) merged.push(normalized);
  }

  return merged;
}

function getCatalog() {
  const defaults = _defaultDoc();
  const store = _readStore();
  if (!store) {
    return Object.assign({}, defaults, { sections: _mergeSections([], defaults.sections) });
  }
  const merged = Object.assign({}, defaults, store);
  merged.sections = _mergeSections(store.sections, defaults.sections);
  return merged;
}

function getDefaultDoc() {
  return _defaultDoc();
}

module.exports = {
  getCatalog,
  getDefaultDoc
};
