'use strict';

// 3B.2-E — FIRST COMPANY GO-LIVE SMOKE TEST.
//
// Exercises the minimum commercial flow over the REAL HTTP stack with every
// tenant feature enabled (multi-company, membership, roles, carry, filtering,
// metadata, auth):
//
//   LOGIN → COMPANY → PRODUCT → CUSTOMER → SALE → INVENTORY check →
//   PURCHASE → TREASURY → basic DASHBOARD/REPORT viewing → tenant isolation →
//   RESTART server on the same data dir → data remains persisted.
//
// Documents current behavior honestly: the sales flow does NOT auto-decrement
// product stock (sales and inventory are decoupled in this architecture) — we
// assert the stock is untouched rather than inventing behavior.

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

describe('3B.2-E — First Company Go-Live Smoke', () => {
  let dir;
  let app;
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

    dir = makeTempDataDir('golive-smoke');
    seed(dir, 'companies', companies);
    seed(dir, 'users', users);
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

  async function loginAs(srv, username, company) {
    const res = await request(srv)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Pass#123', company });
    return res.body && res.body.data ? res.body.data.accessToken : undefined;
  }
  const get = (path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
  const post = (path, body, token) => request(app).post(path).send(body).set('Authorization', `Bearer ${token}`);

  test('LOGIN + COMPANY: adminA authenticates into corp-a', async () => {
    expect(tokenA).toBeTruthy();
    expect(tokenB).toBeTruthy();
  });

  test('PRODUCT: create a global product (stock 100)', async () => {
    const res = await post('/api/v1/inventory', { id: 'SMK-PROD-1', name: 'Smoke Widget', sku: 'SMK-1', buyPrice: 5, sellPrice: 10, stockQty: 100 }, tokenA);
    expect(res.statusCode).toBe(201);
  });

  test('CUSTOMER: create a corp-a customer', async () => {
    const res = await post('/api/v1/customers', { id: 'SMK-CUST-1', name: 'Smoke Customer', phone: '0100' }, tokenA);
    expect(res.statusCode).toBe(201);
  });

  test('SALE: create a sale for corp-a and see it in the list', async () => {
    const res = await post('/api/v1/sales', { id: 'SMK-INV-1', items: [{ productId: 'SMK-PROD-1', qty: 2, price: 10 }], total: 20, customer: 'Smoke Customer', payment: 'cash' }, tokenA);
    expect(res.statusCode).toBe(201);
    const list = await get('/api/v1/sales', tokenA);
    expect(list.body.data.invoices.some(i => i.id === 'SMK-INV-1')).toBe(true);
  });

  test('INVENTORY: product exists and stock is untouched (sales does not auto-decrement)', async () => {
    const prod = await get('/api/v1/inventory/SMK-PROD-1', tokenA);
    expect(prod.statusCode).toBe(200);
    // Current architecture: sales and inventory are decoupled — a sale does not
    // mutate product stock. Assert the documented behavior, not invented logic.
    expect(prod.body.data.stockQty).toBe(100);
  });

  test('PURCHASE: create a purchase and see it in the list', async () => {
    const res = await post('/api/v1/purchases', { id: 'SMK-PO-1', items: [{ productId: 'SMK-PROD-1', qty: 10, price: 4 }], total: 40, supplier: 'Smoke Supplier', payment: 'credit' }, tokenA);
    expect(res.statusCode).toBe(201);
    const list = await get('/api/v1/purchases', tokenA);
    expect(list.body.data.invoices.some(i => i.id === 'SMK-PO-1')).toBe(true);
  });

  test('TREASURY: create a cash entry and see it in the list', async () => {
    const res = await post('/api/v1/treasury', { id: 'SMK-TX-1', type: 'in', amount: 20, balance: 20, desc: 'sale cash', method: 'cash' }, tokenA);
    expect(res.statusCode).toBe(201);
    const list = await get('/api/v1/treasury', tokenA);
    expect(list.body.data.entries.some(e => e.id === 'SMK-TX-1')).toBe(true);
  });

  test('DASHBOARD/REPORTS: basic viewing responds (sync domains, read via repositories)', async () => {
    const dash = await get('/api/v1/dashboard', tokenA);
    expect(dash.statusCode).toBeGreaterThanOrEqual(200);
    expect(dash.statusCode).toBeLessThan(500);
    const rep = await get('/api/v1/reports', tokenA);
    expect(rep.statusCode).toBeGreaterThanOrEqual(200);
    expect(rep.statusCode).toBeLessThan(500);
  });

  test('TENANT ISOLATION: corp-b cannot see corp-a sale/purchase/treasury', async () => {
    const sales = await get('/api/v1/sales', tokenB);
    expect(sales.body.data.invoices.some(i => i.id === 'SMK-INV-1')).toBe(false);
    const purchases = await get('/api/v1/purchases', tokenB);
    expect(purchases.body.data.invoices.some(i => i.id === 'SMK-PO-1')).toBe(false);
    const treasury = await get('/api/v1/treasury', tokenB);
    expect(treasury.body.data.entries.some(e => e.id === 'SMK-TX-1')).toBe(false);
  });

  test('RESTART: data persists after a fresh server boot on the same data dir', async () => {
    const s2 = await startServer(dir, { AUTH_REQUIRED: 'true' });
    const app2 = s2.app;
    const token2 = await loginAs(app2, 'adminA', 'corp-a');

    const sales = await request(app2).get('/api/v1/sales').set('Authorization', `Bearer ${token2}`);
    expect(sales.statusCode).toBe(200);
    expect(sales.body.data.invoices.some(i => i.id === 'SMK-INV-1')).toBe(true);

    const purchases = await request(app2).get('/api/v1/purchases').set('Authorization', `Bearer ${token2}`);
    expect(purchases.body.data.invoices.some(i => i.id === 'SMK-PO-1')).toBe(true);

    const treasury = await request(app2).get('/api/v1/treasury').set('Authorization', `Bearer ${token2}`);
    expect(treasury.body.data.entries.some(e => e.id === 'SMK-TX-1')).toBe(true);

    const customers = await request(app2).get('/api/v1/customers').set('Authorization', `Bearer ${token2}`);
    expect(customers.body.data.customers.some(c => c.id === 'SMK-CUST-1')).toBe(true);

    const products = await request(app2).get('/api/v1/inventory').set('Authorization', `Bearer ${token2}`);
    expect(products.body.data.products.some(p => p.id === 'SMK-PROD-1')).toBe(true);

    // disk is the source of truth
    expect(readStore(dir, 'sales').invoices.some(i => i.id === 'SMK-INV-1')).toBe(true);
  });
});
