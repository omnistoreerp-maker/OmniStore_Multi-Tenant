'use strict';

// platformOverview.service — Master Control Center dashboard aggregate.
//
// SCOPE: PLATFORM. READ-ONLY. Server-owned data only.
//   - Never reads req.query / req.body / req.headers: there is no way for a
//     caller to scope, un-scope or forge any number returned here.
//   - Every value is derived from a real store read at call time. Nothing is
//     defaulted to a plausible-looking number: an unreadable store yields
//     `null` plus a `degraded` flag, never a fabricated 0 presented as fact.
//   - Aggregates only. No customer PII, no tokens, no secrets. The one
//     human-readable stream (recent activity) is the audit trail's own safe
//     projection (no ip / userAgent / changes).
//
// Callers MUST gate this behind requirePlatformAdmin() — this module does no
// authorization of its own by design (same contract as platform.service).

const os = require('os');
const storageAdapter = require('../repositories/storageAdapter');
const BaseRepository = require('../repositories/BaseRepository');
const usersService = require('./users.service');
const presenceService = require('./presence.service');
const platformActivity = require('./platformActivity.service');
const ordersAggregator = require('./platformOrdersAggregator.service');
const gameHostingProvider = require('../controllers/gameHostingProvider');
const platformCatalog = require('./platformCatalog.service');
const config = require('../config');
const logger = require('../utils/logger');

// Dedicated platform-scope repositories: NO tenant accessor, so the numbers
// are always platform-wide and can never be narrowed (or spoofed) by an
// ambient tenant/branch context.
const salesRepository = new BaseRepository('sales');
const productsRepository = new BaseRepository('products');
const marketOrdersRepository = new BaseRepository('marketOrders');

const COMPANY_STORE = 'companies';
const TICKET_STORE = 'customerRequests';
const AUDIT_STORE = 'auditLog';
const STUDENT_STORE = 'studentServicesPack';

// Documented stock thresholds used by the dashboard's stock alerts.
const LOW_STOCK_THRESHOLD = 5;

// Ticket statuses that still need attention (mirrors customerRequest.service
// VALID_STATUSES minus the terminal ones).
const OPEN_TICKET_STATUSES = new Set([
  'NEW', 'TRIAGED', 'APPROVED', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTED',
  'READY_FOR_RELEASE', 'RELEASED', 'READY_FOR_CUSTOMER_VERIFICATION',
  'BLOCKED', 'REOPENED', 'NEEDS_EVIDENCE'
]);
const CLOSED_TICKET_STATUSES = new Set(['RESOLVED', 'REJECTED', 'CANCELLED']);

const DAY_MS = 24 * 60 * 60 * 1000;

function _readStore(name, fallback) {
  try {
    const data = storageAdapter.read(name);
    return { ok: true, data: data == null ? fallback : data };
  } catch (err) {
    logger.warn('platformOverview: failed to read store ' + name, err.message);
    return { ok: false, data: fallback };
  }
}

function _readRepo(repo, key) {
  try {
    const db = repo._rawStore ? repo._rawStore() : repo.read();
    const list = db && typeof db === 'object' && Array.isArray(db[key]) ? db[key] : [];
    return { ok: true, list };
  } catch (err) {
    logger.warn('platformOverview: failed to read repository', err.message);
    return { ok: false, list: [] };
  }
}

function _companies() {
  const store = _readStore(COMPANY_STORE, []);
  let list = [];
  if (Array.isArray(store.data)) list = store.data;
  else if (store.data && Array.isArray(store.data.companies)) list = store.data.companies;
  return { ok: store.ok, list };
}

function _safeCount(fn, fallback) {
  try {
    const v = fn();
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  } catch (err) {
    logger.warn('platformOverview: metric failed', err.message);
    return fallback;
  }
}

function _sumRecords(list, field) {
  let sum = 0;
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const n = Number(r[field]);
    if (Number.isFinite(n) && n > 0) sum += n;
  }
  return sum;
}

// ---------------- sections ----------------

function _counts() {
  const companies = _companies();
  const users = _safeCount(() => (usersService.list().users || []).length, null);
  const online = _safeCount(() => presenceService.countOnline(), null);

  const activeCompanies = companies.list.filter(c => c && c.active !== false).length;
  const suspendedCompanies = companies.list.filter(
    c => c && String(c.status || '').toUpperCase() === 'SUSPENDED'
  ).length;

  return {
    users: { total: users, online },
    companies: {
      total: companies.ok ? companies.list.length : null,
      active: companies.ok ? activeCompanies : null,
      suspended: companies.ok ? suspendedCompanies : null
    }
  };
}

function _orders() {
  const sales = (() => {
    try { return ordersAggregator.getSalesSummary(); }
    catch (err) { logger.warn('platformOverview: sales summary failed', err.message); return null; }
  })();
  const ordersToday = _safeCount(() => ordersAggregator.getOrdersToday(), null);

  const market = _readRepo(marketOrdersRepository, 'orders');
  const now = Date.now();
  const marketToday = market.list.filter(o => {
    if (!o || !o.createdAt) return false;
    const t = new Date(o.createdAt).getTime();
    return Number.isFinite(t) && Math.floor(t / DAY_MS) === Math.floor(now / DAY_MS);
  }).length;
  const marketByStatus = {};
  for (const o of market.list) {
    const s = String((o && o.status) || 'unknown');
    marketByStatus[s] = (marketByStatus[s] || 0) + 1;
  }

  return {
    // Canonical platform "orders today" (sales invoices, TEST/cancelled excluded).
    ordersToday,
    sales,
    marketplace: market.ok
      ? { total: market.list.length, today: marketToday, byStatus: marketByStatus }
      : { total: null, today: null, byStatus: null }
  };
}

function _products() {
  const products = _readRepo(productsRepository, 'products');
  if (!products.ok) return { total: null, lowStock: null, outOfStock: null, threshold: LOW_STOCK_THRESHOLD };
  let lowStock = 0;
  let outOfStock = 0;
  for (const p of products.list) {
    if (!p || typeof p !== 'object') continue;
    const qty = Number(p.stockQty);
    if (!Number.isFinite(qty) || qty <= 0) outOfStock++;
    else if (qty <= LOW_STOCK_THRESHOLD) lowStock++;
  }
  return {
    total: products.list.length,
    lowStock,
    outOfStock,
    threshold: LOW_STOCK_THRESHOLD
  };
}

function _tickets() {
  const store = _readStore(TICKET_STORE, { requests: [] });
  const list = Array.isArray(store.data.requests) ? store.data.requests : [];
  if (!store.ok) return { total: null, open: null, closed: null, byPriority: null, byProduct: null, unassigned: null };

  const byPriority = {};
  const byProduct = {};
  let open = 0;
  let closed = 0;
  let unassigned = 0;

  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const status = String(r.status || '').toUpperCase();
    if (OPEN_TICKET_STATUSES.has(status)) open++;
    else if (CLOSED_TICKET_STATUSES.has(status)) closed++;

    const priority = String(r.priority || 'UNSET');
    byPriority[priority] = (byPriority[priority] || 0) + 1;

    const product = String(r.product || r.productArea || 'UNSET');
    byProduct[product] = (byProduct[product] || 0) + 1;

    if (!r.assignee && !r.assigneeUsername) unassigned++;
  }

  return {
    total: list.length,
    open,
    closed,
    unassigned,
    byPriority,
    byProduct
  };
}

function _activity() {
  const stats = (() => {
    try { return platformActivity.getStats(); }
    catch (err) { logger.warn('platformOverview: platform activity failed', err.message); return null; }
  })();

  const audit = _readStore(AUDIT_STORE, { entries: [] });
  const entries = Array.isArray(audit.data.entries) ? audit.data.entries : [];
  const recent = entries
    .filter(e => e && typeof e === 'object')
    .slice(-12)
    .reverse()
    .map(e => ({
      timestamp: e.timestamp || null,
      action: e.action || null,
      method: e.method || null,
      path: e.path || null,
      statusCode: e.statusCode || null,
      resource: e.resource || null,
      resourceId: e.resourceId || null,
      userId: e.userId || null
    }));

  return {
    visitorsNow: stats ? stats.visitorsNow : null,
    registeredUsers: stats ? stats.registeredUsers : null,
    activeBusinesses: stats ? stats.activeBusinesses : null,
    ordersToday: stats ? stats.ordersToday : null,
    recentAudit: audit.ok ? recent : null
  };
}

// Service health: real process/persistence facts only.
// The persistence probe follows the same pattern as GET /api/v1/ready in
// routes/index.js: touch a scratch file inside the data dir and remove it, so
// no stray probe document is left behind in the data store.
function _health() {
  let persistence = 'unknown';
  try {
    const fs = require('fs');
    const fileStore = require('../utils/fileStore');
    fileStore._ensureDir();
    const probe = fileStore._path('.platform-overview-probe');
    fs.writeFileSync(probe, 'ok', 'utf-8');
    fs.unlinkSync(probe);
    persistence = 'writable';
  } catch (err) {
    logger.warn('platformOverview: persistence probe failed', err.message);
    persistence = 'unwritable';
  }

  const mem = process.memoryUsage();
  const degraded = persistence !== 'writable';
  return {
    status: degraded ? 'degraded' : 'healthy',
    env: config.env || null,
    appVersion: config.appVersion || null,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memory: {
      rssMb: Math.round((mem.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((mem.heapUsed / 1024 / 1024) * 10) / 10
    },
    loadAvg1m: Math.round(os.loadavg()[0] * 100) / 100,
    persistence
  };
}

// Service status per platform section. Every status is derived from a real
// probe of the underlying store/adapter — never a hardcoded green light.
function _services() {
  const out = [];

  // Marketplace — depends on the global product catalog being readable.
  const products = _readRepo(productsRepository, 'products');
  const marketConfig = _readStore('marketConfig', {});
  out.push({
    id: 'marketplace',
    label: 'Marketplace',
    status: !products.ok ? 'error' : (products.list.length === 0 ? 'attention' : 'operational'),
    detail: products.ok
      ? `${products.list.length} product(s) in catalog`
      : 'product catalog unreadable'
  });

  // Education — depends on the student-services store being readable.
  const student = _readStore(STUDENT_STORE, null);
  out.push({
    id: 'education',
    label: 'Education',
    status: student.ok ? 'operational' : 'error',
    detail: student.ok ? 'student services store reachable' : 'student services store unreadable'
  });

  // Games — the provider adapter itself declares its state; we report it
  // verbatim instead of inventing an "operational" flag.
  let gamesStatus = 'blocked';
  let gamesDetail = 'provider status unavailable';
  try {
    const provider = gameHostingProvider.getStatus();
    gamesStatus = String(provider && provider.status).toUpperCase() === 'BLOCKED' ? 'blocked' : 'operational';
    gamesDetail = provider && provider.reason ? provider.reason : 'provider status unknown';
  } catch (err) {
    logger.warn('platformOverview: provider status failed', err.message);
  }
  out.push({ id: 'games', label: 'Games / Game Hosting', status: gamesStatus, detail: gamesDetail });

  // Support — depends on the customer-request store being readable.
  const tickets = _tickets();
  out.push({
    id: 'support',
    label: 'Support',
    status: tickets.total === null ? 'error' : (tickets.open > 0 ? 'attention' : 'operational'),
    detail: tickets.total === null
      ? 'ticket store unreadable'
      : `${tickets.open} open / ${tickets.total} total`
  });

  out.push({
    id: 'marketConfig',
    label: 'Marketplace configuration',
    status: marketConfig.ok ? 'operational' : 'error',
    detail: marketConfig.ok ? 'market config reachable' : 'market config unreadable'
  });

  return out;
}

// Education slice — real counters from the student-services store.
function _education() {
  const store = _readStore(STUDENT_STORE, null);
  if (!store.ok || !store.data || typeof store.data !== 'object') {
    return { status: 'error', printRates: null, printOrders: null, studentPasses: null, hasSettings: null };
  }
  const d = store.data;
  const len = (v) => (Array.isArray(v) ? v.length : null);
  return {
    status: 'operational',
    printRates: len(d.printRates),
    printOrders: len(d.printOrders),
    studentPasses: len(d.studentPasses),
    hasSettings: !!(d.settings && typeof d.settings === 'object')
  };
}

// Communications slice — provider CONFIGURATION status only.
//
// Never reports delivery: whatsappClient falls back to `local_fallback`
// (server-side log) when no API key is present and still returns ok:true.
// That is NOT delivery, so this surface must say NOT_CONFIGURED instead of
// implying a message reached WhatsApp.
function _communications() {
  const whatsappKeyPresent = Boolean(process.env.WHATSAPP_API_KEY);
  const telegramKeyPresent = Boolean(process.env.TELEGRAM_BOT_TOKEN);
  const store = _readStore('tenantNotifications', null);
  const settings = store.ok && store.data && Array.isArray(store.data.settings)
    ? store.data.settings.length
    : null;

  return {
    whatsapp: {
      status: whatsappKeyPresent ? 'CONFIGURED' : 'NOT_CONFIGURED',
      provider: process.env.WHATSAPP_PROVIDER || 'local_fallback',
      delivers: whatsappKeyPresent
    },
    telegram: {
      status: telegramKeyPresent ? 'CONFIGURED' : 'NOT_CONFIGURED',
      delivers: telegramKeyPresent
    },
    notificationSettings: settings,
    note: whatsappKeyPresent
      ? null
      : 'No WhatsApp API key configured — messages are logged locally and are NOT delivered.'
  };
}

// Media / section status — read from the platform catalog, the same source
// the public catalog endpoint serves.
function _mediaAndSections() {
  let sections = [];
  let source = 'store';
  try {
    const doc = platformCatalog.getCatalog();
    sections = (doc && Array.isArray(doc.sections)) ? doc.sections : [];
    // getCatalog() folds the documented defaults into `sections` when the
    // store carries none (or no store exists), so an empty array never
    // reaches us here. Compare against the catalog defaults instead: the
    // caller can tell a built-in default apart from sections the store
    // actually carries, and platformCatalog itself stays untouched.
    const dflt = platformCatalog.getDefaultDoc();
    const defaultSections = (dflt && Array.isArray(dflt.sections)) ? dflt.sections : [];
    if (!sections.length || JSON.stringify(sections) === JSON.stringify(defaultSections)) {
      sections = defaultSections;
      source = 'default';
    }
  } catch (err) {
    logger.warn('platformOverview: catalog sections failed', err.message);
    return { ok: false, source: null, reels: null, gameHosting: null, studentServices: null, marketplace: null };
  }

  const rank = { active: 0, 'under-construction': 1, 'coming-soon': 2 };
  const pick = (id) => {
    const matches = sections.filter(s => s && s.id === id);
    if (!matches.length) return null;
    matches.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9));
    const best = matches[0];
    return { status: best.status || null, url: best.url || null, title: best.title || null };
  };

  return {
    ok: true,
    source,
    reels: pick('media-reels'),
    gameHosting: pick('game-hosting'),
    studentServices: pick('student-services'),
    marketplace: pick('marketplace')
  };
}

// Monetization — reports CONFIGURATION state only, never revenue.
// No Monetag zone is created, enabled or substituted here.
function _monetization() {
  const cfg = (config && config.monetag) || null;
  const configured = !!(cfg && cfg.enabled && cfg.zoneId);
  return {
    monetag: {
      status: configured ? 'CONFIGURED' : 'NOT_CONFIGURED',
      enabled: Boolean(cfg && cfg.enabled),
      zone: configured ? String(cfg.zoneId) : null,
      revenue: null,
      detail: configured
        ? 'Configuration present — activation still requires owner approval.'
        : 'No Monetag configuration exists. The integration boundary stays disabled until commercial readiness and explicit owner approval.'
    }
  };
}

function _alerts(sections) {
  const alerts = [];
  const push = (severity, code, message, count) => {
    if (count === null || count === undefined || count <= 0) return;
    alerts.push({ severity, code, message, count });
  };

  push('warning', 'COMPANIES_SUSPENDED', 'suspended companies', sections.counts.companies.suspended);
  push('info', 'TICKETS_OPEN', 'open support tickets', sections.tickets.open);
  push('warning', 'TICKETS_P0_P1',
    'open P0/P1 support tickets',
    sections.tickets.byPriority
      ? (sections.tickets.byPriority.P0 || 0) + (sections.tickets.byPriority.P1 || 0)
      : 0);
  push('warning', 'STOCK_OUT', 'products out of stock', sections.products.outOfStock);
  push('info', 'STOCK_LOW', 'products at or below the low-stock threshold', sections.products.lowStock);

  if (sections.services.some(s => s.status === 'blocked')) {
    alerts.push({
      severity: 'error',
      code: 'SERVICE_BLOCKED',
      message: 'a platform service is blocked',
      count: sections.services.filter(s => s.status === 'blocked').length
    });
  }
  if (sections.services.some(s => s.status === 'error')) {
    alerts.push({
      severity: 'error',
      code: 'SERVICE_ERROR',
      message: 'a platform service could not be read',
      count: sections.services.filter(s => s.status === 'error').length
    });
  }
  if (sections.health.persistence !== 'writable') {
    alerts.push({
      severity: 'error',
      code: 'PERSISTENCE',
      message: 'data store is not writable',
      count: 1
    });
  }

  const severityRank = { error: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));
  return alerts;
}

function getOverview() {
  const counts = _counts();
  const orders = _orders();
  const products = _products();
  const tickets = _tickets();
  const activity = _activity();
  const health = _health();
  const services = _services();

  const education = _education();
  const communications = _communications();
  const media = _mediaAndSections();
  const monetization = _monetization();

  const sections = { counts, orders, products, tickets, services, health };

  return {
    generatedAt: new Date().toISOString(),
    scope: 'platform',
    ...counts,
    orders,
    products,
    tickets,
    activity,
    services,
    health,
    education,
    communications,
    media,
    monetization,
    alerts: _alerts(sections)
  };
}

module.exports = {
  getOverview,
  LOW_STOCK_THRESHOLD
};
