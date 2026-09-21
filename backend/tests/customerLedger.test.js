'use strict';

// DAY 3 — CUSTOMER LEDGER WORKFLOW tests.
//
// Model under test (unified, NOT a new accounting system):
//   outstanding = opening(customer.balance) + SUM(credit sale totals) - SUM(customer payments)
//   customer.balance itself is NEVER mutated by sales or payments.
//
// Covers: cash sale (no debt), credit sale (debt), partial/full payment,
// multiple sales/payments, sale reversal, payment reversal, update repost,
// duplicate/invalid payment, cross-tenant customer protection, tenant +
// branch isolation, unauthorized access, and failure-before-write byte-identical.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ISO: process.env.ENABLE_TENANT_SALES_ISOLATION,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  BRANCH: process.env.ENABLE_BRANCH_ISOLATION,
  AUTH: process.env.AUTH_REQUIRED
};

function restoreEnv() {
  const map = [
    ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
    ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
    ['ROLES', 'ENABLE_TENANT_ROLES'],
    ['CARRY', 'ENABLE_TENANT_CARRY'],
    ['ISO', 'ENABLE_TENANT_SALES_ISOLATION'],
    ['FILTER', 'ENABLE_TENANT_FILTERING'],
    ['BRANCH', 'ENABLE_BRANCH_ISOLATION'],
    ['AUTH', 'AUTH_REQUIRED']
  ];
  for (const pair of map) {
    const orig = ORIGINAL_ENV[pair[0]];
    if (orig === undefined) delete process.env[pair[1]];
    else process.env[pair[1]] = orig;
  }
}

// ---------------------------------------------------------------------------
// LEGACY MODE — full ledger cycle
// ---------------------------------------------------------------------------
describe('Customer ledger workflow (legacy mode)', () => {
  let server;
  let dir;

  registerCleanup(() => [server], () => [dir]);

  const customerOf = () => (readStore(dir, 'customers').customers || []).find(c => c.id === 'cust-1');

  const outstanding = async () => {
    const res = await request(server.app).get('/api/v1/customer-payments/ledger/cust-1');
    expect(res.statusCode).toBe(200);
    return res.body.data.outstanding;
  };

  beforeAll(async () => {
    dir = makeTempDataDir('customer-ledger');
    seed(dir, 'customers', { customers: [
      { id: 'cust-1', name: 'Ledger Customer', phone: '0100', balance: 100 },
      { id: 'cust-2', name: 'Other Customer', phone: '0200', balance: 0 }
    ]});
    seed(dir, 'products', { products: [{ id: 'cl-1', name: 'Ledger Widget', sellPrice: 100, buyPrice: 60, stockQty: 50 }] });
    server = await startServer(dir);
  });

  test('cash sale carries NO customer debt', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'CL-CASH-1',
      items: [{ productId: 'cl-1', qty: 1, price: 100 }],
      total: 100,
      payment: 'cash',
      customerId: 'cust-1',
      customer: 'Ledger Customer'
    });
    expect(res.statusCode).toBe(201);
    expect(await outstanding()).toBe(100); // opening only
  });

  test('credit sale creates customer debt', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'CL-CR-1',
      items: [{ productId: 'cl-1', qty: 2, price: 100 }],
      total: 200,
      payment: 'credit',
      customerId: 'cust-1',
      customer: 'Ledger Customer'
    });
    expect(res.statusCode).toBe(201);
    expect(await outstanding()).toBe(300); // 100 opening + 200 credit
  });

  test('invalid payment amount -> 400 and state byte-identical', async () => {
    const snap = (n) => (fs.existsSync(path.join(dir, n + '.json')) ? fs.readFileSync(path.join(dir, n + '.json'), 'utf-8') : null);
    const before = { payments: snap('customerPayments'), treasury: snap('treasury'), customers: snap('customers') };

    const bad = await request(server.app).post('/api/v1/customer-payments').send({ customerId: 'cust-1', amount: -5 });
    expect(bad.statusCode).toBe(400);
    const zero = await request(server.app).post('/api/v1/customer-payments').send({ customerId: 'cust-1', amount: 0 });
    expect(zero.statusCode).toBe(400);

    expect(snap('payments')).toBe(before.payments);
    expect(snap('treasury')).toBe(before.treasury);
    expect(snap('customers')).toBe(before.customers);
  });

  test('payment for an unknown customer -> 404, nothing written', async () => {
    const beforeTreasury = fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8');
    const res = await request(server.app).post('/api/v1/customer-payments').send({ customerId: 'no-such', amount: 10 });
    expect(res.statusCode).toBe(404);
    expect(fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);
  });

  test('partial payment lowers debt by exactly the amount and posts treasury in', async () => {
    const res = await request(server.app).post('/api/v1/customer-payments').send({
      id: 'PAY-1', customerId: 'cust-1', amount: 120, method: 'cash', user: 'tester'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.treasuryEntryId).toBeTruthy();
    expect(res.body.data.customerName).toBe('Ledger Customer');
    expect(await outstanding()).toBe(180); // 300 - 120

    const treasury = readStore(dir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.paymentId === 'PAY-1');
    expect(entry).toBeTruthy();
    expect(entry.type).toBe('in');
    expect(entry.amount).toBe(120);
    expect(entry.source).toBe('customer-payment');
    expect(String(entry.customerId)).toBe('cust-1');
  });

  test('duplicate payment id -> 400 (no second treasury entry)', async () => {
    const before = readStore(dir, 'treasury').entries.map(e => e.id);
    const res = await request(server.app).post('/api/v1/customer-payments').send({
      id: 'PAY-1', customerId: 'cust-1', amount: 10
    });
    expect(res.statusCode).toBe(400);
    expect(readStore(dir, 'treasury').entries.map(e => e.id)).toEqual(before);
  });

  test('multiple credit sales and multiple payments keep the ledger consistent', async () => {
    await request(server.app).post('/api/v1/sales').send({
      id: 'CL-CR-2',
      items: [{ productId: 'cl-1', qty: 1, price: 100 }],
      total: 100,
      payment: 'credit',
      customerId: 'cust-1',
      customer: 'Ledger Customer'
    });
    expect(await outstanding()).toBe(280); // 180 + 100

    await request(server.app).post('/api/v1/customer-payments').send({
      id: 'PAY-2', customerId: 'cust-1', amount: 80, method: 'card'
    });
    expect(await outstanding()).toBe(200); // 280 - 80
  });

  test('other customer is unaffected (no cross-customer debt bleed)', async () => {
    const res = await request(server.app).get('/api/v1/customer-payments/ledger/cust-2');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.outstanding).toBe(0);
  });

  test('payment update reposts safely: one treasury entry, correct debt', async () => {
    const res = await request(server.app).put('/api/v1/customer-payments/PAY-1').send({ amount: 200 });
    expect(res.statusCode).toBe(200);
    expect(await outstanding()).toBe(120); // 400 debits - 280 credits

    const entries = (readStore(dir, 'treasury').entries || []).filter(e => e.paymentId === 'PAY-1');
    expect(entries.length).toBe(1); // no double treasury entry
    expect(entries[0].amount).toBe(200);
  });

  test('invalid payment update -> 400 with old state untouched', async () => {
    const beforeTreasury = fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8');
    const res = await request(server.app).put('/api/v1/customer-payments/PAY-1').send({ amount: -1 });
    expect(res.statusCode).toBe(400);
    expect(fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);
    expect(await outstanding()).toBe(120);
  });

  test('reversing a credit sale removes its debt effect', async () => {
    const res = await request(server.app).delete('/api/v1/sales/CL-CR-1');
    expect(res.statusCode).toBe(200);
    const led = await request(server.app).get('/api/v1/customer-payments/ledger/cust-1');
    expect(led.body.data.balance).toBe(-80);      // 200 debits - 280 credits (sale gone)
    expect(led.body.data.outstanding).toBe(0);    // never negative
  });

  test('reversing a payment restores the debt and removes the treasury receipt', async () => {
    const res = await request(server.app).delete('/api/v1/customer-payments/PAY-1');
    expect(res.statusCode).toBe(200);
    expect(await outstanding()).toBe(120); // -80 + 200

    const entries = (readStore(dir, 'treasury').entries || []).filter(e => e.paymentId === 'PAY-1');
    expect(entries.length).toBe(0);
  });

  test('legacy payments without treasury linkage delete with no side effects', async () => {
    const pdb = readStore(dir, 'customerPayments') || { payments: [] };
    pdb.payments.push({ id: 'PAY-LEG', customerId: 'cust-1', customerName: 'Ledger Customer', amount: 5, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    seed(dir, 'customerPayments', pdb);

    const beforeTreasury = fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8');
    const res = await request(server.app).delete('/api/v1/customer-payments/PAY-LEG');
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);
  });
});
// ---------------------------------------------------------------------------
// TENANT ISOLATION + AUTHZ
// ---------------------------------------------------------------------------
describe('Customer ledger — tenant isolation + authz', () => {
  let app;
  let dir;
  let tokenNile;
  let tokenDigi;

  registerCleanup(() => [null], () => [dir]);

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    dir = makeTempDataDir('customer-ledger-iso');
    seed(dir, 'companies', {
      companies: [
        { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
        { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
      ]
    });
    const stamp = new Date().toISOString();
    seed(dir, 'users', { users: [
      { id: 'u-nile', username: 'nileuser', password: PASSWORD, fullName: 'Nile User', role: 'Manager', tenantIds: ['nile'], tenantRoles: { nile: 'Manager' }, createdAt: stamp, updatedAt: stamp },
      { id: 'u-digi', username: 'digiuser', password: PASSWORD, fullName: 'Digi User', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp }
    ]});
    seed(dir, 'customers', { customers: [
      { id: 'cust-nile', name: 'Nile Customer', balance: 0, tenantId: 'nile' },
      { id: 'cust-digi', name: 'Digi Customer', balance: 0, tenantId: 'digi' }
    ]});
    seed(dir, 'products', { products: [{ id: 'cl-iso', name: 'Iso Ledger Widget', sellPrice: 10, stockQty: 20 }] });

    const started = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    const login = async (username, company) => {
      const res = await request(app).post('/api/v1/auth/login').send({ username: username, password: PASSWORD, company: company });
      return res.body && res.body.data && res.body.data.accessToken;
    };
    tokenNile = await login('nileuser', 'nile');
    tokenDigi = await login('digiuser', 'digi');
  });

  afterAll(() => restoreEnv());

  test('unauthorized: payment without token -> 401, nothing written', async () => {
    const res = await request(app).post('/api/v1/customer-payments').send({ customerId: 'cust-nile', amount: 10 });
    expect(res.statusCode).toBe(401);
    expect(fs.existsSync(path.join(dir, 'treasury.json'))).toBe(false);
  });

  test('nile credit sale + payment are stamped and isolated', async () => {
    const sale = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + tokenNile)
      .send({
        id: 'CL-ISO-1',
        items: [{ productId: 'cl-iso', qty: 1, price: 10 }],
        total: 60,
        payment: 'credit',
        customerId: 'cust-nile'
      });
    expect(sale.statusCode).toBe(201);

    const pay = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + tokenNile)
      .send({ id: 'PAY-ISO-1', customerId: 'cust-nile', amount: 20, method: 'cash' });
    expect(pay.statusCode).toBe(201);
    expect(String(pay.body.data.tenantId)).toBe('nile');

    const treasury = readStore(dir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.paymentId === 'PAY-ISO-1');
    expect(entry).toBeTruthy();
    expect(String(entry.tenantId)).toBe('nile');
  });

  test('digi cannot see nile payments, sales, or ledger rows', async () => {
    const pay = await request(app).get('/api/v1/customer-payments').set('Authorization', 'Bearer ' + tokenDigi);
    expect(pay.statusCode).toBe(200);
    expect((pay.body.data.payments || []).some(p => p.id === 'PAY-ISO-1')).toBe(false);

    const sales = await request(app).get('/api/v1/sales').set('Authorization', 'Bearer ' + tokenDigi);
    expect((sales.body.data.invoices || []).some(i => i.id === 'CL-ISO-1')).toBe(false);

    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenDigi);
    expect((tres.body.data.entries || []).some(e => e.paymentId === 'PAY-ISO-1')).toBe(false);

    const led = await request(app).get('/api/v1/customer-payments/ledger/cust-digi').set('Authorization', 'Bearer ' + tokenDigi);
    expect(led.statusCode).toBe(200);
    expect(led.body.data.rows.some(r => r.saleId === 'CL-ISO-1' || r.paymentId === 'PAY-ISO-1')).toBe(false);
  });

  test('cross-tenant customer is not payable and cannot be queried via ledger', async () => {
    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + tokenDigi)
      .send({ customerId: 'cust-nile', amount: 10 });
    expect(res.statusCode).toBe(404);

    const led = await request(app).get('/api/v1/customer-payments/ledger/cust-nile').set('Authorization', 'Bearer ' + tokenDigi);
    expect(led.statusCode).toBe(404);
  });

  test('client-supplied tenantId claim cannot override the server tenant', async () => {
    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + tokenDigi)
      .send({ customerId: 'cust-digi', amount: 5, tenantId: 'nile' });
    expect([400, 404]).toContain(res.statusCode);
    const after = readStore(dir, 'customerPayments').payments.filter(p => String(p.customerId) === 'cust-digi' && p.tenantId === 'nile');
    expect(after.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// BRANCH ISOLATION
// ---------------------------------------------------------------------------
describe('Customer ledger — branch isolation', () => {
  let app;
  let dir;
  let mainToken;
  let otherToken;

  registerCleanup(() => [null], () => [dir]);

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  beforeAll(async () => {
    process.env.ENABLE_BRANCH_ISOLATION = 'true';
    dir = makeTempDataDir('customer-ledger-branch');
    const stamp = new Date().toISOString();
    const perms = ['customerPayments.view', 'customerPayments.create', 'customerPayments.edit', 'customerPayments.delete', 'sales.view', 'sales.create', 'treasury.view'];
    seed(dir, 'users', { users: [
      { id: 'u-bm-main', username: 'bmmain', password: hash('Main#1234'), role: 'BranchManager', fullName: 'Main BM', branchId: 'MAIN', permissions: perms, createdAt: stamp, updatedAt: stamp },
      { id: 'u-bm-other', username: 'bmother', password: hash('Other#123'), role: 'BranchManager', fullName: 'Other BM', branchId: 'OTHER', permissions: perms, createdAt: stamp, updatedAt: stamp }
    ]});
    seed(dir, 'customers', { customers: [
      { id: 'cl-bm', name: 'Branch Customer', balance: 0, branchId: 'MAIN' },
      { id: 'cl-bo', name: 'Other Branch Customer', balance: 0, branchId: 'OTHER' }
    ]});
    seed(dir, 'products', { products: [{ id: 'cl-br', name: 'Branch Widget', sellPrice: 10, stockQty: 10 }] });

    const started = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    const login = async (username, password) => {
      const res = await request(app).post('/api/v1/auth/login').send({ username: username, password: password });
      return res.body && res.body.data && res.body.data.accessToken;
    };
    mainToken = await login('bmmain', 'Main#1234');
    otherToken = await login('bmother', 'Other#123');
  });

  afterAll(() => restoreEnv());

  test('MAIN branch payment is stamped MAIN and hidden from OTHER', async () => {
    const pay = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({ id: 'PAY-BR-1', customerId: 'cl-bm', amount: 25, method: 'cash' });
    expect(pay.statusCode).toBe(201);
    expect(pay.body.data.branchId).toBe('MAIN');

    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + otherToken);
    expect((tres.body.data.entries || []).some(e => e.paymentId === 'PAY-BR-1')).toBe(false);

    const list = await request(app).get('/api/v1/customer-payments').set('Authorization', 'Bearer ' + otherToken);
    expect((list.body.data.payments || []).some(p => p.id === 'PAY-BR-1')).toBe(false);
  });

  test('branch user cannot pay a customer of another branch (404)', async () => {
    const res = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + otherToken)
      .send({ customerId: 'cl-bm', amount: 5 });
    expect(res.statusCode).toBe(404);

    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + otherToken);
    expect((tres.body.data.entries || []).some(e => e.customerId === 'cl-bm')).toBe(false);
  });

  test('RBAC: user without customerPayments.create is rejected (403)', async () => {
    const stamp = new Date().toISOString();
    const db = readStore(dir, 'users');
    db.users.push({ id: 'u-limited', username: 'limited', password: hash('Limit#123'), role: 'BranchManager', fullName: 'Limited BM', branchId: 'MAIN', permissions: ['customerPayments.view'], createdAt: stamp, updatedAt: stamp });
    seed(dir, 'users', db);

    const res = await request(app).post('/api/v1/auth/login').send({ username: 'limited', password: 'Limit#123' });
    const token = res.body.data.accessToken;

    const post = await request(app)
      .post('/api/v1/customer-payments')
      .set('Authorization', 'Bearer ' + token)
      .send({ customerId: 'cl-bm', amount: 1 });
    expect(post.statusCode).toBe(403);
  });
});