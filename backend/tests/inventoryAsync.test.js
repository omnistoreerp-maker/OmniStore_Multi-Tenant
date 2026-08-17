'use strict';

// 3B.2-C — Products + InventoryTransactions async domain regression tests.
//
// Products (inventory) is GLOBAL: it must remain visible across tenants with
// NO tenant filtering/stamping introduced.
//
// InventoryTransactions is TENANT-SCOPED: reads filtered, writes must never
// persist a tenant-filtered snapshot (raw-store + ownership gate), cross-
// tenant mutation blocked.
//
// All requests go through the real HTTP stack (asyncHandler -> async
// controller -> async service -> BaseRepository async API -> JSON backend).

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

describe('3B.2-C — Products + Inventory async domain', () => {
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

    dir = makeTempDataDir('inventory-async');
    seed(dir, 'companies', companies);
    seed(dir, 'users', users);
    seed(dir, 'products', { products: [
      { id: 'prod-1', name: 'Global Widget', sku: 'SKU-1', buyPrice: 5, sellPrice: 10, stockQty: 100, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});
    seed(dir, 'inventoryTransactions', { transactions: [
      { id: 'tx-a1', productId: 'prod-1', type: 'in', qty: 10, stockAfter: 110, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'tx-b1', productId: 'prod-1', type: 'out', qty: 5, stockAfter: 95, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});

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
      const orig = ORIGINAL_ENV[envKey];
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

  // ===================== PRODUCTS (GLOBAL) =====================

  test('products list is visible to both tenants (GLOBAL)', async () => {
    const a = await get('/api/v1/inventory', tokenA);
    const b = await get('/api/v1/inventory', tokenB);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.body.data.products.some(p => p.id === 'prod-1')).toBe(true);
    expect(b.body.data.products.some(p => p.id === 'prod-1')).toBe(true);
  });

  test('product create persists globally without tenant stamping', async () => {
    const res = await post('/api/v1/inventory', { name: 'Second Widget', sku: 'SKU-2', sellPrice: 20 }, tokenA);
    expect(res.statusCode).toBe(201);
    const onDisk = readStore(dir, 'products');
    const rec = onDisk.products.find(p => p.name === 'Second Widget');
    expect(rec).toBeTruthy();
    // Products are GLOBAL — must NOT carry a tenantId.
    expect(rec.tenantId).toBeUndefined();
  });

  test('product update + delete work', async () => {
    const up = await put('/api/v1/inventory/prod-1', { sellPrice: 12 }, tokenB);
    expect(up.statusCode).toBe(200);
    expect(up.body.data.sellPrice).toBe(12);

    const delRes = await del('/api/v1/inventory/prod-1', tokenA);
    expect(delRes.statusCode).toBe(200);
    const onDisk = readStore(dir, 'products');
    expect(onDisk.products.some(p => p.id === 'prod-1')).toBe(false);
  });

  test('products search and stats still work', async () => {
    const search = await get('/api/v1/inventory?search=Second', tokenA);
    expect(search.statusCode).toBe(200);
    expect(search.body.data.products.map(p => p.id)).toEqual([expect.stringContaining('')]);

    const stats = await get('/api/v1/inventory/stats', tokenA);
    expect(stats.statusCode).toBe(200);
    expect(stats.body.data.count).toBeGreaterThanOrEqual(1);
  });

  // ===================== INVENTORY TRANSACTIONS (TENANT-SCOPED) =====================

  test('transactions list is tenant filtered', async () => {
    const a = await get('/api/v1/inventory-transactions', tokenA);
    const b = await get('/api/v1/inventory-transactions', tokenB);
    expect(a.body.data.transactions.some(t => t.id === 'tx-a1')).toBe(true);
    expect(a.body.data.transactions.some(t => t.id === 'tx-b1')).toBe(false);
    expect(b.body.data.transactions.some(t => t.id === 'tx-b1')).toBe(true);
    expect(b.body.data.transactions.some(t => t.id === 'tx-a1')).toBe(false);
  });

  test('transaction create stamps the current tenant', async () => {
    const res = await post('/api/v1/inventory-transactions', { productId: 'prod-1', type: 'in', qty: 3 }, tokenA);
    expect(res.statusCode).toBe(201);
    const onDisk = readStore(dir, 'inventoryTransactions');
    const rec = onDisk.transactions.find(t => t.productId === 'prod-1' && t.qty === 3 && t.type === 'in');
    expect(rec).toBeTruthy();
    expect(rec.tenantId).toBe('corp-a');
  });

  // Phase A — claimed-tenant protection: a foreign tenantId in the body can
  // never bind the transaction to another tenant.
  test('transaction create with a foreign tenantId is rejected (400) and store unchanged', async () => {
    const before = JSON.stringify(readStore(dir, 'inventoryTransactions'));
    const res = await post('/api/v1/inventory-transactions', { productId: 'prod-1', type: 'in', qty: 1, tenantId: 'corp-b' }, tokenA);
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(readStore(dir, 'inventoryTransactions'))).toBe(before);
  });

  test('transaction create with the own tenantId is accepted (no tampering)', async () => {
    const res = await post('/api/v1/inventory-transactions', { id: 'tx-own-claim', productId: 'prod-1', type: 'out', qty: 1, tenantId: 'corp-a' }, tokenA);
    expect(res.statusCode).toBe(201);
    const onDisk = readStore(dir, 'inventoryTransactions');
    expect(onDisk.transactions.find(t => t.id === 'tx-own-claim').tenantId).toBe('corp-a');
  });

  test('cross-tenant transaction update is blocked and data survives', async () => {
    const cross = await put('/api/v1/inventory-transactions/tx-b1', { qty: 999 }, tokenA);
    expect(cross.statusCode).toBe(404);
    const onDisk = readStore(dir, 'inventoryTransactions');
    expect(onDisk.transactions.find(t => t.id === 'tx-b1').qty).toBe(5);
  });

  test('cross-tenant transaction delete is blocked', async () => {
    const cross = await del('/api/v1/inventory-transactions/tx-b1', tokenA);
    expect(cross.statusCode).toBe(404);
    const onDisk = readStore(dir, 'inventoryTransactions');
    expect(onDisk.transactions.some(t => t.id === 'tx-b1')).toBe(true);
  });

  test('own-tenant transaction update works', async () => {
    const ok = await put('/api/v1/inventory-transactions/tx-a1', { reason: 'restock' }, tokenA);
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.reason).toBe('restock');
    const onDisk = readStore(dir, 'inventoryTransactions');
    expect(onDisk.transactions.find(t => t.id === 'tx-a1').reason).toBe('restock');
    // Other tenant's record untouched by the write.
    expect(onDisk.transactions.some(t => t.id === 'tx-b1')).toBe(true);
  });

  test('interleaved concurrent transaction requests keep their own tenant', async () => {
    const [a, b] = await Promise.all([
      get('/api/v1/inventory-transactions', tokenA),
      get('/api/v1/inventory-transactions', tokenB)
    ]);
    const idsA = a.body.data.transactions.map(t => t.id);
    const idsB = b.body.data.transactions.map(t => t.id);
    expect(idsA).not.toContain('tx-b1');
    expect(idsB).not.toContain('tx-a1');
  });

  test('async errors reach the error handler without crashing', async () => {
    const missing = await get('/api/v1/inventory-transactions/nonexistent', tokenA);
    expect(missing.statusCode).toBe(404);
    const list = await get('/api/v1/inventory', tokenA);
    expect(list.statusCode).toBe(200);
  });
});
