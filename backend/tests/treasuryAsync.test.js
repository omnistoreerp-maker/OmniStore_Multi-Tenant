'use strict';

// 3B.2-E — Treasury async domain regression + tenant isolation tests.
//
// Treasury has NO Phase 25-style isolation wrapper: tenant scoping comes from
// the request-scoped tenantStore through the repository (ENABLE_TENANT_FILTERING
// for reads, ENABLE_TENANT_METADATA for CREATE stamping) plus the service-level
// raw-store + ownership gate for writes.
//
// Covers: tenant read isolation, create stamping, client-supplied tenantId
// rejection, cross-tenant update/delete blocked with data survival, stats
// scoping, the MANDATORY data-loss regression, concurrent interleaved
// requests, async error propagation, and financial-side-effect documentation
// (a sale does NOT auto-create a treasury entry — current behavior preserved).

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
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

function treasuryRecords() {
  const t = new Date().toISOString();
  return { entries: [
    { id: 'TX-A-1', type: 'in', amount: 500, balance: 500, desc: 'A cash in', method: 'cash', user: 'adminA', tenantId: 'corp-a', createdAt: t, updatedAt: t },
    { id: 'TX-B-1', type: 'out', amount: 100, balance: 400, desc: 'B expense', method: 'card', user: 'adminB', tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'TX-B-2', type: 'in', amount: 250, balance: 650, desc: 'B cash in', method: 'cash', user: 'adminB', tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'TX-LEG-1', type: 'in', amount: 50, balance: 50, desc: 'Legacy', method: 'cash', user: 'legacy', createdAt: t, updatedAt: t }
  ]};
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'treasury', treasuryRecords());
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('3B.2-E — Treasury async domain (tenantStore isolation)', () => {
  let app;
  let dir;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';

    dir = makeTempDataDir('treasury-async');
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    tokenA = await loginAs(app, 'adminA', 'corp-a');
    tokenB = await loginAs(app, 'adminB', 'corp-b');
  });

  afterAll(() => {
    if (dir) { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }
    const map = [
      ['ROLES', 'ENABLE_TENANT_ROLES'],
      ['CARRY', 'ENABLE_TENANT_CARRY'],
      ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
      ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
      ['AUTH', 'AUTH_REQUIRED'],
      ['FILTER', 'ENABLE_TENANT_FILTERING'],
      ['MD', 'ENABLE_TENANT_METADATA'],
      ['DATA', 'DIGITRONICS_DATA_DIR']
    ];
    for (const [envKey, origKey] of map) {
      const orig = ORIGINAL_ENV[envKey];
      if (orig === undefined) delete process.env[origKey];
      else process.env[origKey] = orig;
    }
  });

  const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path, body, token) => request(app).post(path).send(body).set('Authorization', `Bearer ${token}`);
  const put = (path, body, token) => request(app).put(path).send(body).set('Authorization', `Bearer ${token}`);
  const del = (path, token) => request(app).delete(path).set('Authorization', `Bearer ${token}`);

  describe('tenant read isolation', () => {
    test('list: A sees A + legacy only; B sees B + legacy only', async () => {
      const a = await get('/api/v1/treasury', tokenA);
      const b = await get('/api/v1/treasury', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const idsA = a.body.data.entries.map(e => e.id);
      const idsB = b.body.data.entries.map(e => e.id);
      expect(idsA).toContain('TX-A-1');
      expect(idsA).toContain('TX-LEG-1');
      expect(idsA).not.toContain('TX-B-1');
      expect(idsB).toContain('TX-B-1');
      expect(idsB).toContain('TX-LEG-1');
      expect(idsB).not.toContain('TX-A-1');
    });

    test('getById: own 200, legacy 200, foreign 404', async () => {
      const own = await get('/api/v1/treasury/TX-A-1', tokenA);
      expect(own.statusCode).toBe(200);
      const legacy = await get('/api/v1/treasury/TX-LEG-1', tokenA);
      expect(legacy.statusCode).toBe(200);
      const foreign = await get('/api/v1/treasury/TX-B-1', tokenA);
      expect(foreign.statusCode).toBe(404);
    });

    test('stats are tenant scoped', async () => {
      const a = await get('/api/v1/treasury/stats', tokenA);
      const b = await get('/api/v1/treasury/stats', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.body.data.count).not.toBe(b.body.data.count);
    });
  });

  describe('create binding + claimed-tenant protection', () => {
    test('create stamps the current tenant (persisted copy)', async () => {
      const res = await post('/api/v1/treasury', { id: 'TX-A-2', type: 'in', amount: 100, balance: 600, desc: 'A deposit' }, tokenA);
      expect(res.statusCode).toBe(201);
      // Stamping happens inside writeAsync on the persisted copy (document-level
      // path — same as the sync behavior); verify it on disk.
      const onDisk = readStore(dir, 'treasury');
      expect(onDisk.entries.find(e => e.id === 'TX-A-2').tenantId).toBe('corp-a');
      // and the tenant's list now shows it
      const list = await get('/api/v1/treasury', tokenA);
      expect(list.body.data.entries.some(e => e.id === 'TX-A-2')).toBe(true);
    });

    test('client-supplied foreign tenantId is REJECTED (400, store unchanged)', async () => {
      const before = JSON.stringify(readStore(dir, 'treasury'));
      const res = await post('/api/v1/treasury', { id: 'TX-INTRUDER', type: 'in', amount: 10, tenantId: 'corp-b' }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dir, 'treasury'))).toBe(before);
    });

    test('client-supplied own tenantId is accepted (no tampering)', async () => {
      const res = await post('/api/v1/treasury', { id: 'TX-OK-A', type: 'out', amount: 20, balance: 580, tenantId: 'corp-a' }, tokenA);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('corp-a');
    });
  });

  describe('cross-tenant mutation blocked, data survives', () => {
    test('cross-tenant update blocked (404) + other tenant record survives', async () => {
      const before = JSON.stringify(readStore(dir, 'treasury'));
      const res = await put('/api/v1/treasury/TX-B-1', { amount: 9999, desc: 'Hijack' }, tokenA);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(readStore(dir, 'treasury'))).toBe(before);
    });

    test('cross-tenant delete blocked (404) + other tenant record survives', async () => {
      const res = await del('/api/v1/treasury/TX-B-1', tokenA);
      expect(res.statusCode).toBe(404);
      const onDisk = readStore(dir, 'treasury');
      expect(onDisk.entries.some(e => e.id === 'TX-B-1')).toBe(true);
    });

    test('own update works and tenantId is immutable', async () => {
      const res = await put('/api/v1/treasury/TX-A-1', { desc: 'A updated' }, tokenA);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.desc).toBe('A updated');
      expect(res.body.data.tenantId).toBe('corp-a');
      const onDisk = readStore(dir, 'treasury');
      expect(onDisk.entries.find(e => e.id === 'TX-A-1').desc).toBe('A updated');
      expect(onDisk.entries.some(e => e.id === 'TX-B-1')).toBe(true);
    });
  });

  // ===================== MANDATORY DATA-LOSS REGRESSION =====================

  test('DATA-LOSS: after tenant A create+update+delete, tenant B entries survive on disk', async () => {
    const before = readStore(dir, 'treasury').entries.map(e => e.id);

    const created = await post('/api/v1/treasury', { id: 'TX-DL-A', type: 'in', amount: 1, balance: 1, desc: 'DL' }, tokenA);
    expect(created.statusCode).toBe(201);
    const updated = await put('/api/v1/treasury/TX-A-1', { desc: 'DL Updated' }, tokenA);
    expect(updated.statusCode).toBe(200);
    const deleted = await del('/api/v1/treasury/TX-DL-A', tokenA);
    expect(deleted.statusCode).toBe(200);

    const onDisk = readStore(dir, 'treasury').entries.map(e => e.id);
    for (const id of before) expect(onDisk).toContain(id); // nothing of B's dropped
    expect(onDisk).toContain('TX-A-1');
    expect(onDisk).not.toContain('TX-DL-A');
  });

  // ===================== CONCURRENCY + ERRORS + FINANCIAL SIDE EFFECTS =====================

  test('interleaved concurrent requests keep their own tenant', async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/treasury', tokenA),
      get('/api/v1/treasury', tokenB)
    ]);
    const idsA = a.body.data.entries.map(e => e.id);
    const idsB = b.body.data.entries.map(e => e.id);
    expect(idsA).not.toContain('TX-B-1');
    expect(idsB).not.toContain('TX-A-1');
  });

  test('async errors reach the error handler without crashing', async () => {
    const missing = await get('/api/v1/treasury/nonexistent', tokenA);
    expect(missing.statusCode).toBe(404);
    const bad = await post('/api/v1/treasury', { amount: 10 }, tokenA);
    expect(bad.statusCode).toBe(400);
    const list = await get('/api/v1/treasury', tokenA);
    expect(list.statusCode).toBe(200);
  });

  test('financial references are preserved as supplied (saleId/ref pass through)', async () => {
    const res = await post('/api/v1/treasury', { id: 'TX-REF-1', type: 'in', amount: 77, balance: 77, desc: 'ref test', saleId: 'INV-900001', ref: 'SALE-1' }, tokenA);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.saleId).toBe('INV-900001');
    expect(res.body.data.ref).toBe('SALE-1');
  });

  test('a sale does NOT auto-create a treasury entry (current behavior, no invented coupling)', async () => {
    const before = readStore(dir, 'treasury').entries.map(e => e.id);
    const sale = await post('/api/v1/sales', { id: 'INV-SIDE-1', items: [{ productId: 'p1', qty: 1, price: 50 }], total: 50, payment: 'cash' }, tokenA);
    expect(sale.statusCode).toBe(201);
    const after = readStore(dir, 'treasury').entries.map(e => e.id);
    expect(after).toEqual(before); // exactly the same entries — no duplicate/auto entry
  });
});
