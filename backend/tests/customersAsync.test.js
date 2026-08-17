'use strict';

// 3B.2-B — Customers async domain regression tests.
//
// Verifies the FIRST production-critical async domain end-to-end through the
// real HTTP stack:
//   Route (asyncHandler) → Controller (async) → CustomersService (async)
//     → BaseRepository async API → storageAdapter async → JSON backend
//
// Coverage:
//   - list / get / create / update / delete happy paths
//   - search & stats behavior unchanged
//   - tenant isolation at the HTTP layer (A cannot read B)
//   - tenant mutation isolation (A cannot update/delete B)
//   - interleaved concurrent requests preserve per-request tenant
//   - async error propagation reaches the error middleware (404 path)

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  MD: process.env.ENABLE_TENANT_METADATA,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
  { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const users = { users: [
  {
    id: 'u-a', username: 'adminA', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin A', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: 'u-b', username: 'adminB', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin B', tenantIds: ['corp-b'], tenantRoles: { 'corp-b': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
]};

describe('3B.2-B — Customers async domain', () => {
  let app;
  let dir;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('customers-async');
    seed(dir, 'companies', companies);
    seed(dir, 'users', users);
    seed(dir, 'customers', {
      customers: [
        { id: 'cust-a1', name: 'Alice A', phone: '0100000001', balance: 10, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'cust-b1', name: 'Bob B', phone: '0100000002', balance: 20, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    });

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;

    async function loginAs(username, company) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ username, password: 'Pass#123', company });
      return res.body && res.body.data ? res.body.data.accessToken : undefined;
    }
    tokenA = await loginAs('adminA', 'corp-a');
    tokenB = await loginAs('adminB', 'corp-b');
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    for (const [envKey, origKey] of [
      ['ENABLE_TENANT_ROLES', 'ROLES'],
      ['ENABLE_TENANT_CARRY', 'CARRY'],
      ['ENABLE_MULTI_COMPANY_LOGIN', 'MC'],
      ['ENABLE_TENANT_USER_MEMBERSHIP', 'MEM'],
      ['ENABLE_TENANT_FILTERING', 'FILTER'],
      ['ENABLE_TENANT_METADATA', 'MD'],
      ['AUTH_REQUIRED', 'AUTH'],
      ['DIGITRONICS_DATA_DIR', 'DATA']
    ]) {
      const orig = ORIGINAL_ENV[origKey];
      if (orig === undefined) delete process.env[envKey];
      else process.env[envKey] = orig;
    }
  });

  const get = (path, token) =>
    request(app).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path, body, token) =>
    request(app).post(path).send(body).set('Authorization', `Bearer ${token}`);
  const put = (path, body, token) =>
    request(app).put(path).send(body).set('Authorization', `Bearer ${token}`);
  const del = (path, token) =>
    request(app).delete(path).set('Authorization', `Bearer ${token}`);

  // 1. List — tenant A sees only tenant A customers.
  test('list returns only the current tenant customers', async () => {
    const res = await get('/api/v1/customers', tokenA);
    expect(res.statusCode).toBe(200);
    const ids = res.body.data.customers.map(c => c.id);
    expect(ids).toContain('cust-a1');
    expect(ids).not.toContain('cust-b1');
  });

  // 2. Get — existing customer works; other-tenant get returns 404.
  test('get own customer works; other-tenant get is 404', async () => {
    const own = await get('/api/v1/customers/cust-a1', tokenA);
    expect(own.statusCode).toBe(200);
    expect(own.body.data.id).toBe('cust-a1');

    const other = await get('/api/v1/customers/cust-b1', tokenA);
    expect(other.statusCode).toBe(404);
  });

  // 3. Create — persists with server-side tenant stamping.
  test('create persists a customer stamped with the current tenant', async () => {
    const res = await post('/api/v1/customers', { name: 'New A', phone: '0100999999' }, tokenA);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBeTruthy();

    const onDisk = readStore(dir, 'customers');
    const rec = onDisk.customers.find(c => c.name === 'New A');
    expect(rec).toBeTruthy();
    expect(rec.tenantId).toBe('corp-a');
  });

  // Phase A — claimed-tenant protection: a foreign tenantId in the body can
  // never bind the record to another tenant.
  test('create with a foreign tenantId is rejected (400) and store unchanged', async () => {
    const before = JSON.stringify(readStore(dir, 'customers'));
    const res = await post('/api/v1/customers', { name: 'Intruder', tenantId: 'corp-b' }, tokenA);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(readStore(dir, 'customers'))).toBe(before);
  });

  test('create with the own tenantId is accepted (no tampering)', async () => {
    const res = await post('/api/v1/customers', { name: 'Own Claim', tenantId: 'corp-a' }, tokenA);
    expect(res.statusCode).toBe(201);
    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers.find(c => c.name === 'Own Claim').tenantId).toBe('corp-a');
  });

  // 4. Update — own tenant works; cross-tenant update is blocked.
  test('update own customer works; cross-tenant update blocked', async () => {
    const ok = await put('/api/v1/customers/cust-a1', { phone: '0111111111' }, tokenA);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.phone).toBe('0111111111');

    const cross = await put('/api/v1/customers/cust-b1', { phone: '0999999999' }, tokenA);
    expect(cross.statusCode).toBe(404);
    const onDisk = readStore(dir, 'customers');
    expect(onDisk.customers.find(c => c.id === 'cust-b1').phone).toBe('0100000002');
  });

  // 5. Delete — own tenant works; cross-tenant delete is blocked.
  test('delete own customer works; cross-tenant delete blocked', async () => {
    const created = await post('/api/v1/customers', { name: 'Temp A' }, tokenA);
    const id = created.body.data.id;

    const cross = await del(`/api/v1/customers/${id}`, tokenB);
    expect(cross.statusCode).toBe(404);

    const own = await del(`/api/v1/customers/${id}`, tokenA);
    expect(own.statusCode).toBe(200);

    const gone = await get(`/api/v1/customers/${id}`, tokenA);
    expect(gone.statusCode).toBe(404);
  });

  // 6. Search/filter + stats unchanged.
  test('search and stats still work', async () => {
    const search = await get('/api/v1/customers?search=Alice', tokenA);
    expect(search.statusCode).toBe(200);
    expect(search.body.data.customers.map(c => c.id)).toEqual(['cust-a1']);

    const stats = await get('/api/v1/customers/stats', tokenA);
    expect(stats.statusCode).toBe(200);
    expect(stats.body.data.count).toBeGreaterThanOrEqual(1);
  });

  // 7. Tenant A cannot read tenant B.
  test('tenant A list never contains tenant B customers', async () => {
    const res = await get('/api/v1/customers', tokenB);
    const ids = res.body.data.customers.map(c => c.id);
    expect(ids).toContain('cust-b1');
    expect(ids).not.toContain('cust-a1');
  });

  // 8. Interleaved concurrent requests preserve per-request tenant.
  test('interleaved concurrent list requests keep their own tenant', async () => {
    const [ra, rb] = await Promise.all([
      get('/api/v1/customers', tokenA),
      get('/api/v1/customers', tokenB)
    ]);
    const idsA = ra.body.data.customers.map(c => c.id);
    const idsB = rb.body.data.customers.map(c => c.id);
    expect(idsA).not.toContain('cust-b1');
    expect(idsB).not.toContain('cust-a1');
  });

  // 9. Async error propagation — unknown route-level id gives 404 (handled
  //    through the async controller path, not an unhandled rejection).
  test('async errors reach the error handler without crashing', async () => {
    const missing = await get('/api/v1/customers/nonexistent-id', tokenA);
    expect(missing.statusCode).toBe(404);
    const list = await get('/api/v1/customers', tokenA);
    expect(list.statusCode).toBe(200);
  });
});
