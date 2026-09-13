'use strict';

// 3B.2-F — Voucher tenant isolation tests.
//
// Covers: tenant read isolation, create stamping, client-supplied tenantId
// rejection, cross-tenant update/delete blocked with data survival, stats
// scoping, data-loss regression, concurrent interleaved requests, async error
// propagation.

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

function voucherRecords() {
  const t = new Date().toISOString();
  return { vouchers: [
    { id: 'VCH-A-1', type: 'receipt', partyName: 'Alice', partyType: 'customer', method: 'cash', amount: 500, date: t, tenantId: 'corp-a', createdAt: t, updatedAt: t },
    { id: 'VCH-B-1', type: 'payment', partyName: 'Bob Supplier', partyType: 'supplier', method: 'bank', amount: 800, date: t, tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'VCH-B-2', type: 'receipt', partyName: 'Bob', partyType: 'customer', method: 'cash', amount: 250, date: t, tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'VCH-LEG-1', type: 'receipt', partyName: 'Legacy', partyType: 'customer', method: 'cash', amount: 100, date: t, createdAt: t, updatedAt: t }
  ]};
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'vouchers', voucherRecords());
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('3B.2-F — Voucher tenant isolation', () => {
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

    dir = makeTempDataDir('voucher-iso');
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
      const a = await get('/api/v1/vouchers', tokenA);
      const b = await get('/api/v1/vouchers', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const idsA = a.body.data.vouchers.map(v => v.id);
      const idsB = b.body.data.vouchers.map(v => v.id);
      expect(idsA).toContain('VCH-A-1');
      expect(idsA).toContain('VCH-LEG-1');
      expect(idsA).not.toContain('VCH-B-1');
      expect(idsB).toContain('VCH-B-1');
      expect(idsB).toContain('VCH-LEG-1');
      expect(idsB).not.toContain('VCH-A-1');
    });

    test('getById: own 200, legacy 200, foreign 404', async () => {
      const own = await get('/api/v1/vouchers/VCH-A-1', tokenA);
      expect(own.statusCode).toBe(200);
      const legacy = await get('/api/v1/vouchers/VCH-LEG-1', tokenA);
      expect(legacy.statusCode).toBe(200);
      const foreign = await get('/api/v1/vouchers/VCH-B-1', tokenA);
      expect(foreign.statusCode).toBe(404);
    });

    test('stats are tenant scoped', async () => {
      const a = await get('/api/v1/vouchers/stats', tokenA);
      const b = await get('/api/v1/vouchers/stats', tokenB);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.body.data.count).not.toBe(b.body.data.count);
    });
  });

  describe('create binding + claimed-tenant protection', () => {
    test('create stamps the current tenant (persisted copy)', async () => {
      const res = await post('/api/v1/vouchers', { id: 'VCH-A-2', type: 'receipt', partyName: 'Alice2', partyType: 'customer', method: 'cash', amount: 100, date: '2026-07-10' }, tokenA);
      expect(res.statusCode).toBe(201);
      const onDisk = readStore(dir, 'vouchers');
      expect(onDisk.vouchers.find(v => v.id === 'VCH-A-2').tenantId).toBe('corp-a');
      const list = await get('/api/v1/vouchers', tokenA);
      expect(list.body.data.vouchers.some(v => v.id === 'VCH-A-2')).toBe(true);
    });

    test('client-supplied foreign tenantId is REJECTED (400, store unchanged)', async () => {
      const before = JSON.stringify(readStore(dir, 'vouchers'));
      const res = await post('/api/v1/vouchers', { id: 'VCH-INTRUDER', type: 'receipt', partyName: 'X', partyType: 'customer', method: 'cash', amount: 10, tenantId: 'corp-b' }, tokenA);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dir, 'vouchers'))).toBe(before);
    });

    test('client-supplied own tenantId is accepted (no tampering)', async () => {
      const res = await post('/api/v1/vouchers', { id: 'VCH-OK-A', type: 'payment', partyName: 'Alice', partyType: 'customer', method: 'cash', amount: 20, date: '2026-07-11', tenantId: 'corp-a' }, tokenA);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('corp-a');
    });
  });

  describe('cross-tenant mutation blocked, data survives', () => {
    test('cross-tenant update blocked (404) + other tenant record survives', async () => {
      const before = JSON.stringify(readStore(dir, 'vouchers'));
      const res = await put('/api/v1/vouchers/VCH-B-1', { amount: 9999 }, tokenA);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(readStore(dir, 'vouchers'))).toBe(before);
    });

    test('cross-tenant delete blocked (404) + other tenant record survives', async () => {
      const res = await del('/api/v1/vouchers/VCH-B-1', tokenA);
      expect(res.statusCode).toBe(404);
      const onDisk = readStore(dir, 'vouchers');
      expect(onDisk.vouchers.some(v => v.id === 'VCH-B-1')).toBe(true);
    });

    test('own update works and tenantId is immutable', async () => {
      const res = await put('/api/v1/vouchers/VCH-A-1', { amount: 600 }, tokenA);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.amount).toBe(600);
      expect(res.body.data.tenantId).toBe('corp-a');
      const onDisk = readStore(dir, 'vouchers');
      expect(onDisk.vouchers.find(v => v.id === 'VCH-A-1').amount).toBe(600);
      expect(onDisk.vouchers.some(v => v.id === 'VCH-B-1')).toBe(true);
    });
  });

  test('DATA-LOSS: after tenant A create+update+delete, tenant B entries survive on disk', async () => {
    const before = readStore(dir, 'vouchers').vouchers.map(v => v.id);

    const created = await post('/api/v1/vouchers', { id: 'VCH-DL-A', type: 'receipt', partyName: 'DL', partyType: 'customer', method: 'cash', amount: 1, date: '2026-07-12' }, tokenA);
    expect(created.statusCode).toBe(201);
    const updated = await put('/api/v1/vouchers/VCH-DL-A', { amount: 2 }, tokenA);
    expect(updated.statusCode).toBe(200);
    const deleted = await del('/api/v1/vouchers/VCH-DL-A', tokenA);
    expect(deleted.statusCode).toBe(200);

    const onDisk = readStore(dir, 'vouchers').vouchers.map(v => v.id);
    for (const id of before) expect(onDisk).toContain(id);
    expect(onDisk).toContain('VCH-A-1');
    expect(onDisk).not.toContain('VCH-DL-A');
  });

  test('interleaved concurrent requests keep their own tenant', async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/vouchers', tokenA),
      get('/api/v1/vouchers', tokenB)
    ]);
    const idsA = a.body.data.vouchers.map(v => v.id);
    const idsB = b.body.data.vouchers.map(v => v.id);
    expect(idsA).not.toContain('VCH-B-1');
    expect(idsB).not.toContain('VCH-A-1');
  });

  test('async errors reach the error handler without crashing', async () => {
    const missing = await get('/api/v1/vouchers/nonexistent', tokenA);
    expect(missing.statusCode).toBe(404);
    const bad = await post('/api/v1/vouchers', { amount: 10 }, tokenA);
    expect(bad.statusCode).toBe(400);
    const list = await get('/api/v1/vouchers', tokenA);
    expect(list.statusCode).toBe(200);
  });

  test('financial references are preserved as supplied (partyName/partyType pass through)', async () => {
    const res = await post('/api/v1/vouchers', { id: 'VCH-REF-1', type: 'receipt', partyName: 'Alice', partyType: 'customer', method: 'cash', amount: 77, date: '2026-07-13' }, tokenA);
    expect(res.statusCode).toBe(201);
    expect(res.body.data.partyName).toBe('Alice');
    expect(res.body.data.partyType).toBe('customer');
  });
});
