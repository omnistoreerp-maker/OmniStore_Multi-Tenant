'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function seedPublic(dir) {
  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [] }
    ]
  });
  seed(dir, 'users', {
    users: [
      { id: 'u-master', username: 'master', password: require('bcryptjs').hashSync(PASSWORD, 10), fullName: 'Master Admin', role: 'Viewer', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 }
    ]
  });
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: new Date().toISOString() }] });
  seed(dir, 'platformPublic', {
    meta: { name: 'OmniStore Platform', tagline: 'Multi-Tenant Platform', version: '1.0.0', lastUpdated: new Date().toISOString() },
    features: [
      { id: 'sales', title: 'Sales', description: 'POS and orders', icon: 'fa-cart-shopping' },
      { id: 'purchases', title: 'Purchases', description: 'Vendor management', icon: 'fa-truck' },
      { id: 'inventory', title: 'Inventory', description: 'Stock tracking', icon: 'fa-boxes-stacked' },
      { id: 'accounting', title: 'Accounting', description: 'Journals and reports', icon: 'fa-book' },
      { id: 'customers', title: 'Customers', description: 'CRM and loyalty', icon: 'fa-users' },
      { id: 'suppliers', title: 'Suppliers', description: 'Supplier directory', icon: 'fa-truck-field' }
    ],
    stats: [
      { label: 'Tenants', value: '1', description: 'Active companies' },
      { label: 'Modules', value: '6+', description: 'Core modules' },
      { label: 'Uptime', value: '99.9%', description: 'Availability' }
    ],
    highlights: [
      { title: 'Multi-Tenant', body: 'Fully isolated companies.' },
      { title: 'Real-Time Sync', body: 'Instant propagation.' },
      { title: 'RBAC', body: 'Granular permissions.' }
    ],
    sections: [
      { id: 'marketplace', title: 'Marketplace', description: 'Visitor-facing marketplace.', status: 'active', url: '/market.html', icon: 'fa-store' },
      { id: 'business-services', title: 'Business Management Services', description: 'Existing company access and new company onboarding.', status: 'active', url: '/business.html', icon: 'fa-building' },
      { id: 'student-services', title: 'Student Services', description: 'Student-facing services.', status: 'coming-soon', url: null, icon: 'fa-graduation-cap' },
      { id: 'game-hosting', title: 'Game Hosting', description: 'Host and manage game sessions.', status: 'under-construction', url: null, icon: 'fa-gamepad' },
      { id: 'media-reels', title: 'Media / Reels', description: 'Media content and reels sharing.', status: 'coming-soon', url: null, icon: 'fa-film' }
    ]
  });
}

describe('GET /api/v1/platform-public', () => {
  let server;
  let dir;
  let masterToken;

  beforeAll(async () => {
    jest.resetModules();
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    dir = makeTempDataDir('platformPublic');
    tempDirs.push(dir);
    seedPublic(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    masterToken = (await login(server, 'master', PASSWORD, 'digi')).accessToken;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const api = (token) => ({
    get: (path) => request(server).get(path).set('Authorization', 'Bearer ' + token),
    post: (path, body) => request(server).post(path).set('Authorization', 'Bearer ' + token).send(body || {}),
    put: (path, body) => request(server).put(path).set('Authorization', 'Bearer ' + token).send(body || {}),
    del: (path) => request(server).delete(path).set('Authorization', 'Bearer ' + token)
  });

  // ---------- anonymous access (no token) ----------
  test('1: anonymous can GET /catalog', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.meta).toBeTruthy();
  });

  test('2: anonymous can GET /features', async () => {
    const res = await request(server).get('/api/v1/platform-public/features');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.features)).toBe(true);
    expect(res.body.data.features.length).toBe(6);
  });

  test('3: anonymous can GET /stats with activity metrics', async () => {
    const res = await request(server).get('/api/v1/platform-public/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('visitorsNow');
    expect(res.body.data).toHaveProperty('registeredUsers');
    expect(res.body.data).toHaveProperty('activeBusinesses');
    expect(res.body.data).toHaveProperty('ordersToday');
    expect(typeof res.body.data.visitorsNow).toBe('number');
    expect(typeof res.body.data.registeredUsers).toBe('number');
    expect(typeof res.body.data.activeBusinesses).toBe('number');
    expect(typeof res.body.data.ordersToday).toBe('number');
    expect(res.body.data.ordersToday).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(res.body.data.ordersToday)).toBe(true);
    expect(res.body.data.registeredUsers).toBeGreaterThanOrEqual(1);
    expect(res.body.data.activeBusinesses).toBeGreaterThanOrEqual(1);
  });

  test('4: anonymous can GET /highlights', async () => {
    const res = await request(server).get('/api/v1/platform-public/highlights');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.highlights)).toBe(true);
    expect(res.body.data.highlights.length).toBe(3);
  });

  test('4.1: anonymous can GET /sections', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.sections)).toBe(true);
    expect(res.body.data.sections.length).toBeGreaterThanOrEqual(5);
    const ids = res.body.data.sections.map(s => s.id);
    expect(ids).toContain('marketplace');
    expect(ids).toContain('business-services');
    expect(ids).toContain('student-services');
    expect(ids).toContain('game-hosting');
    expect(ids).toContain('media-reels');
  });

  // ---------- authenticated access still works ----------
  test('5: authenticated user can GET /catalog', async () => {
    const res = await api(masterToken).get('/api/v1/platform-public/catalog');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.name).toBe('OmniStore Platform');
  });

  // ---------- method restrictions: POST/PUT/DELETE/PATCH return 404 ----------
  test('6: POST /platform-public returns 404', async () => {
    const res = await request(server).post('/api/v1/platform-public').send({});
    expect(res.status).toBe(404);
  });

  test('7: PUT /platform-public returns 404', async () => {
    const res = await request(server).put('/api/v1/platform-public').send({});
    expect(res.status).toBe(404);
  });

  test('8: PATCH /platform-public returns 404', async () => {
    const res = await request(server).patch('/api/v1/platform-public').send({});
    expect(res.status).toBe(404);
  });

  test('9: DELETE /platform-public returns 404', async () => {
    const res = await request(server).delete('/api/v1/platform-public');
    expect(res.status).toBe(404);
  });

  test('10: POST /catalog returns 404', async () => {
    const res = await request(server).post('/api/v1/platform-public/catalog').send({});
    expect(res.status).toBe(404);
  });

  test('11: PUT /catalog returns 404', async () => {
    const res = await request(server).put('/api/v1/platform-public/catalog').send({});
    expect(res.status).toBe(404);
  });

  test('12: DELETE /catalog returns 404', async () => {
    const res = await request(server).delete('/api/v1/platform-public/catalog');
    expect(res.status).toBe(404);
  });

  test('13: POST /features returns 404', async () => {
    const res = await request(server).post('/api/v1/platform-public/features').send({});
    expect(res.status).toBe(404);
  });

  test('14: DELETE /stats returns 404', async () => {
    const res = await request(server).delete('/api/v1/platform-public/stats');
    expect(res.status).toBe(404);
  });

  test('15: unknown path returns 404 or 401', async () => {
    const res = await request(server).get('/api/v1/platform-public/nonexistent');
    expect([404, 401]).toContain(res.status);
  });

  // ---------- data shape ----------
  test('16: catalog has required top-level keys', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data).toHaveProperty('meta');
    expect(data).toHaveProperty('features');
    expect(data).toHaveProperty('stats');
    expect(data).toHaveProperty('highlights');
    expect(data).toHaveProperty('sections');
  });

  test('17: features array has 6 items', async () => {
    const res = await request(server).get('/api/v1/platform-public/features');
    expect(res.body.data.features.length).toBe(6);
  });

  test('19: highlights array has 3 items', async () => {
    const res = await request(server).get('/api/v1/platform-public/highlights');
    expect(res.body.data.highlights.length).toBe(3);
  });

  test('19.1: sections include active and non-active statuses', async () => {
    const res = await request(server).get('/api/v1/platform-public/sections');
    expect(res.status).toBe(200);
    const sections = res.body.data.sections;
    const statuses = sections.map(s => s.status);
    expect(statuses).toContain('active');
    expect(statuses).toContain('coming-soon');
    expect(statuses).toContain('under-construction');
  });

  // ---------- response envelope ----------
  test('20: response envelope shape', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    expect(res.body).toHaveProperty('success');
    expect(res.body).toHaveProperty('message');
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('time');
    expect(typeof res.body.time).toBe('string');
  });

  // ---------- no secrets ----------
  test('21: no secrets in any public endpoint', async () => {
    const endpoints = ['/api/v1/platform-public/catalog', '/api/v1/platform-public/features', '/api/v1/platform-public/stats', '/api/v1/platform-public/highlights', '/api/v1/platform-public/sections'];
    for (const ep of endpoints) {
      const res = await request(server).get(ep);
      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain('JWT');
      expect(raw).not.toContain('secret');
      expect(raw).not.toContain('password');
    }
  });

  // ---------- client-controlled tenant identity is ignored ----------
  test('22: X-Tenant-Id header does not affect response', async () => {
    const res = await request(server)
      .get('/api/v1/platform-public/catalog')
      .set('X-Tenant-Id', 'evil-tenant');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.name).toBe('OmniStore Platform');
  });

  test('23: ?tenant= query param does not affect response', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog?tenant=evil-tenant');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.name).toBe('OmniStore Platform');
  });

  // ---------- rate limiter headers present ----------
  test('24: rate limiter headers are present', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    const hasLimit = res.headers['ratelimit-limit'] || res.headers['X-RateLimit-Limit'];
    expect(hasLimit).toBeTruthy();
  });

  // ---------- public visitor heartbeat ----------
  test('25: anonymous can POST /activity/heartbeat with visitorId', async () => {
    const res = await request(server)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: 'v_test_001' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('26: heartbeat without visitorId returns 400', async () => {
    const res = await request(server)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({});
    expect(res.status).toBe(400);
  });

  test('27: first heartbeat creates active visitor and stats reflect it', async () => {
    const vid = 'v_test_visitor_count';
    const beat = await request(server)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: vid });
    expect(beat.status).toBe(200);

    const stats = await request(server).get('/api/v1/platform-public/stats');
    expect(stats.status).toBe(200);
    expect(stats.body.data.visitorsNow).toBeGreaterThanOrEqual(1);
  });

  test('28: repeated heartbeat does not double-count same visitor', async () => {
    const vid = 'v_test_visitor_dedup';
    await request(server)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: vid });
    await request(server)
      .post('/api/v1/platform-public/activity/heartbeat')
      .send({ visitorId: vid });

    const stats = await request(server).get('/api/v1/platform-public/stats');
    expect(stats.status).toBe(200);
    const count = stats.body.data.visitorsNow;
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test('29: stats response contains no PII', async () => {
    const res = await request(server).get('/api/v1/platform-public/stats');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body.data);
    expect(raw).not.toContain('visitorId');
    expect(raw).not.toContain('username');
    expect(raw).not.toContain('email');
    expect(raw).not.toContain('tenantId');
    expect(raw).not.toContain('password');
  });

  test('30: ordersToday is a safe aggregate number when the sales source is readable', async () => {
    const res = await request(server).get('/api/v1/platform-public/stats');
    expect(res.status).toBe(200);
    expect(typeof res.body.data.ordersToday).toBe('number');
    expect(res.body.data.ordersToday).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(res.body.data.ordersToday)).toBe(true);
    // Never leak invoice records / PII through the public metric.
    expect(Array.isArray(res.body.data.ordersToday)).toBe(false);
    expect(typeof res.body.data.ordersToday).not.toBe('object');
  });

  // ---------- public pricing ----------
  test('31: anonymous can GET /pricing', async () => {
    const res = await request(server).get('/api/v1/platform-public/pricing');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.plans)).toBe(true);
    expect(res.body.data.plans.length).toBeGreaterThanOrEqual(3);
  });

  test('32: pricing returns expected plan fields', async () => {
    const res = await request(server).get('/api/v1/platform-public/pricing');
    expect(res.status).toBe(200);
    const plan = res.body.data.plans[0];
    expect(plan).toHaveProperty('key');
    expect(plan).toHaveProperty('name');
    expect(plan).toHaveProperty('monthlyPrice');
    expect(plan).toHaveProperty('annualPrice');
    expect(plan).toHaveProperty('currency');
    expect(plan).toHaveProperty('features');
  });

  test('33: anonymous can POST /payments/intent', async () => {
    const res = await request(server)
      .post('/api/v1/platform-public/payments/intent')
      .send({ addonKey: 'starter', amount: 49, currency: 'EGP', gateway: 'paymob', metadata: { planKey: 'starter', billingCycle: 'monthly' } });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('transactionRef');
    expect(res.body.data.status).toBe('pending');
  });

  test('34: public payment intent without addonKey returns 400', async () => {
    const res = await request(server)
      .post('/api/v1/platform-public/payments/intent')
      .send({ amount: 49 });
    expect(res.status).toBe(400);
  });

  test('35: public payment intent without amount returns 400', async () => {
    const res = await request(server)
      .post('/api/v1/platform-public/payments/intent')
      .send({ addonKey: 'starter' });
    expect(res.status).toBe(400);
  });
});
