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
    meta: { name: 'OmniStore ERP', tagline: 'Multi-Tenant ERP', version: '1.0.0', lastUpdated: new Date().toISOString() },
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

  test('3: anonymous can GET /stats', async () => {
    const res = await request(server).get('/api/v1/platform-public/stats');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.stats)).toBe(true);
    expect(res.body.data.stats.length).toBe(3);
  });

  test('4: anonymous can GET /highlights', async () => {
    const res = await request(server).get('/api/v1/platform-public/highlights');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.highlights)).toBe(true);
    expect(res.body.data.highlights.length).toBe(3);
  });

  // ---------- authenticated access still works ----------
  test('5: authenticated user can GET /catalog', async () => {
    const res = await api(masterToken).get('/api/v1/platform-public/catalog');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.name).toBe('OmniStore ERP');
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
  });

  test('17: features array has 6 items', async () => {
    const res = await request(server).get('/api/v1/platform-public/features');
    expect(res.body.data.features.length).toBe(6);
  });

  test('18: stats array has 3 items', async () => {
    const res = await request(server).get('/api/v1/platform-public/stats');
    expect(res.body.data.stats.length).toBe(3);
  });

  test('19: highlights array has 3 items', async () => {
    const res = await request(server).get('/api/v1/platform-public/highlights');
    expect(res.body.data.highlights.length).toBe(3);
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
    const endpoints = ['/api/v1/platform-public/catalog', '/api/v1/platform-public/features', '/api/v1/platform-public/stats', '/api/v1/platform-public/highlights'];
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
    expect(res.body.data.meta.name).toBe('OmniStore ERP');
  });

  test('23: ?tenant= query param does not affect response', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog?tenant=evil-tenant');
    expect(res.status).toBe(200);
    expect(res.body.data.meta.name).toBe('OmniStore ERP');
  });

  // ---------- rate limiter headers present ----------
  test('24: rate limiter headers are present', async () => {
    const res = await request(server).get('/api/v1/platform-public/catalog');
    const hasLimit = res.headers['ratelimit-limit'] || res.headers['X-RateLimit-Limit'];
    expect(hasLimit).toBeTruthy();
  });
});
