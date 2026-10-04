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
        // Documented activation exception: Students is the only section that
        // has graduated from the platform lockdown policy. Gaming / Media /
        // Support stay Coming Soon until their own activation cycles.
        id: 'student-services',
        title: 'Student Services & Printing',
        description: 'Print shop orders, cost calculator, and student monthly passes.',
        status: 'active',
        url: '/student.html',
        icon: 'fa-graduation-cap'
      },
      {
        // Education (STU-1 to STU-10). Live in the branch: the 26 education.*
        // permissions are registered, so advertising it is honest. The entry
        // grants nothing — the Education API stays tenant-scoped and
        // permission-gated exactly as before, so an operator without an
        // education.* grant still gets 403 from the route itself.
        id: 'education',
        title: 'Education',
        description: 'Tenant-scoped Education management: students, teachers, centers, programs, courses, classes, enrollments, attendance, schedule and grading.',
        status: 'active',
        url: '/education/index.html',
        icon: 'fa-school'
      },
{
        id: 'game-hosting',
        title: 'Game Hosting',
        description: 'Host and manage game sessions and catalogs.',
        status: 'coming-soon',
        url: null,
        icon: 'fa-gamepad'
      },
      {
        // Online Games (roster cycle): the 46 SAFE games ship under
        // /online-games/ and the public catalog, details and player pages live
        // at /online-games/index.html. Read-only and public — it grants no
        // platform permission, and the frames stay cross-origin behind the
        // configured GAMES_ORIGIN. Game Hosting above stays coming-soon.
        id: 'online-games',
        title: 'Online Games',
        description: 'Free open-source HTML5 games playable instantly in the browser.',
        status: 'active',
        url: '/online-games/index.html',
        icon: 'fa-dice'
      },
      {
        id: 'media-reels',
        title: 'Media / Reels',
        description: 'Media content and reels sharing.',
        status: 'active',
        url: '/media-reels.html',
        icon: 'fa-film'
      },
      {
        id: 'support',
        title: 'Support',
        description: 'Customer support center — requests, replies and status tracking.',
        status: 'active',
        url: '/support.html',
        icon: 'fa-life-ring'
      }
    ]
  };
}

function getCatalog() {
  const store = _readStore();
  if (!store) return _defaultDoc();
  // The persisted platform document predates the sections field, so a stored
  // doc without sections would make /sections and /catalog report an empty
  // catalog. Fall back to the documented default catalog for that field only:
  // the stored document stays authoritative for everything else and is never
  // rewritten here.
  if (!Array.isArray(store.sections) || store.sections.length === 0) {
    return Object.assign({}, store, { sections: _defaultDoc().sections });
  }
  // A stored document may also predate an individual section entry (Support
  // activated while production data had no support row). Surface default
  // entries for ids the stored document omits, appending only — stored
  // entries are never overwritten and nothing is written back to disk.
  const defaults = _defaultDoc().sections;
  const seen = {};
  store.sections.forEach(function (s) { if (s && s.id) seen[s.id] = true; });
  const missing = defaults.filter(function (d) { return !seen[d.id]; });
  if (!missing.length) return store;
  return Object.assign({}, store, { sections: store.sections.concat(missing) });
}

function getDefaultDoc() {
  return _defaultDoc();
}

module.exports = {
  getCatalog,
  getDefaultDoc
};
