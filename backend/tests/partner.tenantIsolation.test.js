'use strict';

// 3B.2-G — Partner tenant isolation tests.
//
// Partners are business entities with financial attributes (capital, percent).
// Covers: tenant read isolation, create stamping, client-supplied tenantId
// rejection, cross-tenant update/delete blocked with data survival, stats
// scoping, data-loss regression, concurrent interleaved requests.

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

function partnerRecords() {
  const t = new Date().toISOString();
  return { partners: [
    { id: 'PTN-A-1', name: 'Alice Partner', phone: '0101', capital: 10000, percent: 40, tenantId: 'corp-a', createdAt: t, updatedAt: t },
    { id: 'PTN-B-1', name: 'Bob Partner', phone: '0102', capital: 5000, percent: 20, tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'PTN-LEG-1', name: 'Legacy Partner', phone: '0103', capital: 0, percent: 0, createdAt: t, updatedAt: t }
  ]};
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'partners', partnerRecords());
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('3B.2-G — Partner tenant isolation', () => {
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

    dir = makeTempDataDir('partner-iso');
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
      const a = await get('/api/v1/partners', tokenA);
      const b = await get('/api/v1/partners', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const idsA = a.body.data.partners.map(p => p.id);
      const idsB = b.body.data.partners.map(p => p.id);
      expect(idsA).toContain('PTN-A-1');
      expect(idsA).toContain('PTN-LEG-1');
      expect(idsA).not.toContain('PTN-B-1');
      expect(idsB).toContain('PTN-B-1');
      expect(idsB).toContain('PTN-LEG-1');
      expect(idsB).not.toContain('PTN-A-1');
    });

    test('getById: own 200, legacy 200, foreign 404', async () => {
      const own = await get('/api/v1/partners/PTN-A-1', tokenA);
      expect(own.statusCode).toBe(200);
      const legacy = await get('/api/v1/partners/PTN-LEG-1', tokenA);
      expect(legacy.statusCode).toBe(200);
      const foreign = await get('/api/v1/partners/PTN-B-1', tokenA);
      expect(foreign.statusCode).toBe(404);
    });

    test('stats are tenant scoped', async () => {
      const a = await get('/api/v1/partners/stats', tokenA);
      const b = await get('/api/v1/partners/stats', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.body.data.count).toBe(2); // A own + legacy
      expect(b.body.data.count).toBe(2); // B own + legacy
      expect(a.body.data.withCapital).toBeGreaterThanOrEqual(1);
      expect(b.body.data.withCapital).toBeGreaterThanOrEqual(1);
    });
  });

  describe('create binding + claimed-tenant protection', () => {
    test('create stamps the current tenant (persisted copy)', async () => {
      const res = await post('/api/v1/partners', { id: 'PTN-A-2', name: 'Alice2', phone: '0101', capital: 5000, percent: 10 }, tokenA);
      expect(res.statusCode).toBe(201);
      const onDisk = readStore(dir, 'partners');
      expect(onDisk.partners.find(p => p.id === 'PTN-A-2').tenantId).toBe('corp-a');
      const list = await get('/api/v1/partners', tokenA);
      expect(list.body.data.partners.some(p => p.id === 'PTN-A-2')).toBe(true);
    });

    test('client-supplied foreign tenantId is REJECTED (400, store unchanged)', async () => {
      const before = JSON.stringify(readStore(dir, 'partners'));
      const res = await post('/api/v1/partners', { id: 'PTN-INTRUDER', name: 'X', phone: '0109', capital: 0, percent: 0, tenantId: 'corp-b' }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dir, 'partners'))).toBe(before);
    });

    test('client-supplied own tenantId is accepted (no tampering)', async () => {
      const res = await post('/api/v1/partners', { id: 'PTN-OK-A', name: 'AliceOK', phone: '0101', capital: 1000, percent: 5, tenantId: 'corp-a' }, tokenA);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('corp-a');
    });
  });

  describe('cross-tenant mutation blocked, data survives', () => {
    test('cross-tenant update blocked (404) + other tenant record survives', async () => {
      const before = JSON.stringify(readStore(dir, 'partners'));
      const res = await put('/api/v1/partners/PTN-B-1', { capital: 9999 }, tokenA);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(readStore(dir, 'partners'))).toBe(before);
    });

    test('cross-tenant delete blocked (404) + other tenant record survives', async () => {
      const res = await del('/api/v1/partners/PTN-B-1', tokenA);
      expect(res.statusCode).toBe(404);
      const onDisk = readStore(dir, 'partners');
      expect(onDisk.partners.some(p => p.id === 'PTN-B-1')).toBe(true);
    });

    test('own update works and tenantId is immutable', async () => {
      const res = await put('/api/v1/partners/PTN-A-1', { capital: 20000 }, tokenA);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.capital).toBe(20000);
      expect(res.body.data.tenantId).toBe('corp-a');
      const onDisk = readStore(dir, 'partners');
      expect(onDisk.partners.find(p => p.id === 'PTN-A-1').capital).toBe(20000);
      expect(onDisk.partners.some(p => p.id === 'PTN-B-1')).toBe(true);
    });
  });

  test('DATA-LOSS: after tenant A create+update+delete, tenant B entries survive on disk', async () => {
    const before = readStore(dir, 'partners').partners.map(p => p.id);

    const created = await post('/api/v1/partners', { id: 'PTN-DL-A', name: 'DL', phone: '0101', capital: 1, percent: 0 }, tokenA);
    expect(created.statusCode).toBe(201);
    const updated = await put('/api/v1/partners/PTN-DL-A', { capital: 2 }, tokenA);
    expect(updated.statusCode).toBe(200);
    const deleted = await del('/api/v1/partners/PTN-DL-A', tokenA);
    expect(deleted.statusCode).toBe(200);

    const onDisk = readStore(dir, 'partners').partners.map(p => p.id);
    for (const id of before) expect(onDisk).toContain(id);
    expect(onDisk).toContain('PTN-A-1');
    expect(onDisk).not.toContain('PTN-DL-A');
  });

  test('interleaved concurrent requests keep their own tenant', async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/partners', tokenA),
      get('/api/v1/partners', tokenB)
    ]);
    const idsA = a.body.data.partners.map(p => p.id);
    const idsB = b.body.data.partners.map(p => p.id);
    expect(idsA).not.toContain('PTN-B-1');
    expect(idsB).not.toContain('PTN-A-1');
  });

  test('async errors reach the error handler without crashing', async () => {
    const missing = await get('/api/v1/partners/nonexistent', tokenA);
    expect(missing.statusCode).toBe(404);
    const bad = await post('/api/v1/partners', { name: 'X', capital: 'bad' }, tokenA);
    expect(bad.statusCode).toBe(400);
    const list = await get('/api/v1/partners', tokenA);
    expect(list.statusCode).toBe(200);
  });
});
