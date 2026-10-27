'use strict';

// PHASE 1 — MASTER CONTROL CENTER: platform overview aggregate.
//
// Verifies that GET /api/v1/platform/overview:
//   A. requires authentication (401)
//   B. requires a real platform admin — a tenant Owner is NOT enough (403)
//   C. returns numbers computed from the REAL seeded stores (no fabricated
//      figures, no hardcoded zeros standing in for unreadable data)
//   D. keeps platform-wide scope (sales/orders ignore tenant context)
//   E. reports service status from real probes (Games comes back BLOCKED
//      because the provider adapter itself says so)
//   F. leaks no credentials or tokens in the payload

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  return {
    users: [
      { id: 'u-master', username: 'master', password: hash, fullName: 'Master Admin', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  };
}

function seedAll(dir) {
  const now = new Date().toISOString();

  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }] },
      { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: false, status: 'SUSPENDED', branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }] }
    ]
  });
  seed(dir, 'users', userRecords());
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: now }] });
  seed(dir, 'presence', { entries: [] });

  // Global product catalog: one out of stock, one low, one healthy.
  seed(dir, 'products', {
    products: [
      { id: 'p1', name: 'USB Cable', stockQty: 0, price: 5 },
      { id: 'p2', name: 'HDMI Cable', stockQty: 3, price: 12 },
      { id: 'p3', name: 'Mouse', stockQty: 50, price: 20 }
    ]
  });

  // Sales store: TEST / cancelled / other-day invoices must NOT count.
  seed(dir, 'sales', {
    invoices: [
      { id: 'INV-1', invoiceNumber: 'INV-1', date: now, total: 100 },
      { id: 'INV-TEST', invoiceNumber: 'TEST-001', date: now, total: 999 },
      { id: 'INV-OLD', invoiceNumber: 'INV-OLD', date: '2020-01-01T00:00:00.000Z', total: 50 },
      { id: 'INV-CANC', invoiceNumber: 'INV-CANC', date: now, total: 20, status: 'cancelled' }
    ]
  });

  seed(dir, 'marketOrders', {
    orders: [{ id: 'o1', status: 'pending', createdAt: now, total: 30 }]
  });

  seed(dir, 'customerRequests', {
    requests: [
      { id: 'CR-1', status: 'NEW', priority: 'P0', product: 'ERP' },
      { id: 'CR-2', status: 'RESOLVED', priority: 'P3', product: 'MARKETPLACE', assigneeUsername: 'master' }
    ],
    verifications: [],
    audit: []
  });

  seed(dir, 'platformActivity', { visitors: [{ id: 'visitor01', lastSeenAt: now }] });

  seed(dir, 'auditLog', {
    entries: [{ id: 'a1', timestamp: now, action: 'login', method: 'POST', path: '/api/v1/auth/login', statusCode: 200, userId: 'master' }]
  });

  seed(dir, 'marketConfig', { currency: 'EGP' });
  seed(dir, 'studentServicesPack', {
    printRates: [],
    printOrders: [{ id: 'PO-1', status: 'pending' }],
    studentPasses: [],
    settings: { currency: 'EGP' }
  });
  seed(dir, 'tenantNotifications', { settings: [], lastUpdated: now });
}

describe('Phase 1 — GET /api/v1/platform/overview', () => {
  let server;
  let dir;
  let masterToken;
  let ownerToken;
  let savedWhatsappKey;

  beforeAll(async () => {
    jest.resetModules();
    savedWhatsappKey = process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_API_KEY;
    delete process.env.WHATSAPP_PROVIDER;
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dir = makeTempDataDir('overview');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    masterToken = (await login(server, 'master', PASSWORD, 'digi')).accessToken;
    ownerToken = (await login(server, 'digiOwner', PASSWORD, 'digi')).accessToken;
    expect(masterToken).toBeTruthy();
    expect(ownerToken).toBeTruthy();
  });

  afterAll(() => {
    if (savedWhatsappKey === undefined) delete process.env.WHATSAPP_API_KEY;
    else process.env.WHATSAPP_API_KEY = savedWhatsappKey;
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const get = (path, token) => {
    const req = request(server).get(path);
    return token ? req.set('Authorization', 'Bearer ' + token) : req;
  };

  test('A. unauthenticated request is rejected with 401', async () => {
    const res = await get('/api/v1/platform/overview');
    expect(res.statusCode).toBe(401);
  });

  test('B. a tenant Owner without a platform role is rejected with 403', async () => {
    const res = await get('/api/v1/platform/overview', ownerToken);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('C. a platform master gets 200 with a platform-scope payload', async () => {
    const res = await get('/api/v1/platform/overview', masterToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const d = res.body.data;
    expect(d.scope).toBe('platform');
    expect(typeof d.generatedAt).toBe('string');
    expect(Number.isFinite(Date.parse(d.generatedAt))).toBe(true);
  });

  test('C1. counts come from the seeded stores, not from constants', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;

    expect(d.companies).toEqual({ total: 2, active: 1, suspended: 1 });
    expect(d.users.total).toBe(2);
    expect(typeof d.users.online).toBe('number');

    // products: p1 out of stock, p2 (qty 3) low, p3 healthy
    expect(d.products.total).toBe(3);
    expect(d.products.outOfStock).toBe(1);
    expect(d.products.lowStock).toBe(1);
    expect(d.products.threshold).toBe(5);
  });

  test('C2. orders/sales exclude TEST, cancelled and other-day invoices', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;

    expect(d.orders.ordersToday).toBe(1);
    expect(d.orders.sales.invoicesTotal).toBe(2);   // INV-1 + INV-OLD
    expect(d.orders.sales.valueTotal).toBe(150);
    expect(d.orders.sales.invoicesToday).toBe(1);
    expect(d.orders.sales.valueToday).toBe(100);
    expect(d.orders.sales.currency).toBeNull();     // store carries no currency

    expect(d.orders.marketplace.total).toBe(1);
    expect(d.orders.marketplace.today).toBe(1);
    expect(d.orders.marketplace.byStatus.pending).toBe(1);
  });

  test('C3. tickets report real open/closed/priority counters', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;
    expect(d.tickets.total).toBe(2);
    expect(d.tickets.open).toBe(1);
    expect(d.tickets.closed).toBe(1);
    expect(d.tickets.unassigned).toBe(1);
    expect(d.tickets.byPriority.P0).toBe(1);
    expect(d.tickets.byProduct.ERP).toBe(1);
  });

  test('C4. alerts are derived from the data (suspended, stock, tickets, blocked service)', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;
    const byCode = Object.fromEntries(d.alerts.map(a => [a.code, a]));
    expect(byCode.COMPANIES_SUSPENDED.count).toBe(1);
    expect(byCode.STOCK_OUT.count).toBe(1);
    expect(byCode.STOCK_LOW.count).toBe(1);
    expect(byCode.TICKETS_OPEN.count).toBe(1);
    expect(byCode.SERVICE_BLOCKED.count).toBeGreaterThanOrEqual(1);
    // error-severity alerts sort first
    expect(d.alerts[0].severity).toBe('error');
  });

  test('D. activity is real: one active visitor seeded, ordersToday matches aggregator', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;
    expect(d.activity.visitorsNow).toBe(1);
    expect(d.activity.registeredUsers).toBe(2);
    expect(d.activity.ordersToday).toBe(1);
    expect(Array.isArray(d.activity.recentAudit)).toBe(true);
    expect(d.activity.recentAudit.length).toBeGreaterThanOrEqual(1);
    expect(d.activity.recentAudit[0]).not.toHaveProperty('ip');
    expect(d.activity.recentAudit[0]).not.toHaveProperty('userAgent');
  });

  test('E. service status comes from probes — Games reports BLOCKED', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;
    const byId = Object.fromEntries(d.services.map(s => [s.id, s]));
    expect(byId.marketplace.status).toBe('operational');
    expect(byId.education.status).toBe('operational');
    expect(byId.games.status).toBe('blocked');
    expect(byId.support.status).toBe('attention'); // 1 open ticket
    expect(d.health.persistence).toBe('writable');
    expect(d.health.status).toBe('healthy');
  });

  test('F. payload carries no credentials, tokens or passwords', async () => {
    const res = await get('/api/v1/platform/overview', masterToken);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/"password"/i);
    expect(json).not.toMatch(/accessToken/i);
    expect(json).not.toMatch(/refreshToken/i);
    expect(json).not.toMatch(/Bearer /);
  });

  test('F1. education / communications / media / monetization report real config state', async () => {
    const d = (await get('/api/v1/platform/overview', masterToken)).body.data;

    expect(d.education.status).toBe('operational');
    expect(d.education.printRates).toBe(0);
    expect(d.education.printOrders).toBe(1);
    expect(d.education.studentPasses).toBe(0);

    // No WhatsApp key in this environment -> NOT_CONFIGURED and no delivery claim.
    expect(d.communications.whatsapp.status).toBe('NOT_CONFIGURED');
    expect(d.communications.whatsapp.delivers).toBe(false);
    expect(d.communications.note).toMatch(/NOT delivered/i);
    expect(d.communications.notificationSettings).toBe(0);

    // Section status comes from the platform catalog, not from constants.
    expect(d.media.ok).toBe(true);
    expect(d.media.source).toBe('default'); // catalog defaults: the store carries no sections array
    // Section statuses are asserted against the catalog defaults of the base
    // commit (cc7ad48): media-reels is active, game-hosting is coming-soon.
    expect(d.media.reels.status).toBe('active');
    expect(d.media.marketplace.status).toBe('active');
    expect(d.media.gameHosting.status).toBe('coming-soon');

    expect(d.monetization.monetag.status).toBe('NOT_CONFIGURED');
    expect(d.monetization.monetag.enabled).toBe(false);
    expect(d.monetization.monetag.zone).toBeNull();
    expect(d.monetization.monetag.revenue).toBeNull();
  });

  test('H. API responses are marked no-store (no cached auth responses)', async () => {
    const ok = await get('/api/v1/platform/overview', masterToken);
    expect(ok.statusCode).toBe(200);
    expect(ok.headers['cache-control']).toBe('no-store');

    const anon = await get('/api/v1/platform/overview');
    expect(anon.statusCode).toBe(401);
    expect(anon.headers['cache-control']).toBe('no-store');
  });

  test('G. the summary endpoint still answers (no regression)', async () => {
    const res = await get('/api/v1/platform/summary', masterToken);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.companies.total).toBe(2);
  });
});
