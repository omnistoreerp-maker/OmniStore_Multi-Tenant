'use strict';

// DAY 4 — REPORTS WIRING tests.
//
// Every figure is derived LIVE from the real Day 1-3 posting sources.
// Covers: customer statement, supplier statement, daily sales, daily
// purchases, cash flow, inventory summary, date ranges, reversal handling,
// tenant + branch isolation, RBAC, empty datasets, and no-double-counting.
//
// Real express apps on isolated mkdtemp dirs; backend/data is never touched.

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
  ISO_S: process.env.ENABLE_TENANT_SALES_ISOLATION,
  ISO_P: process.env.ENABLE_TENANT_PURCHASES_ISOLATION,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  BRANCH: process.env.ENABLE_BRANCH_ISOLATION,
  AUTH: process.env.AUTH_REQUIRED
};

function setFlag(name) { process.env[name] = 'true'; }
function restoreEnv() {
  const map = [
    ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
    ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
    ['ROLES', 'ENABLE_TENANT_ROLES'],
    ['CARRY', 'ENABLE_TENANT_CARRY'],
    ['ISO_S', 'ENABLE_TENANT_SALES_ISOLATION'],
    ['ISO_P', 'ENABLE_TENANT_PURCHASES_ISOLATION'],
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
// LEGACY MODE — computed reports from real posted workflows
// ---------------------------------------------------------------------------
describe('Reports wiring (legacy mode)', () => {
  let server;
  let dir;

  registerCleanup(() => [server], () => [dir]);

  const get = (urlPath) => request(server.app).get(urlPath);

  beforeAll(async () => {
    dir = makeTempDataDir('reports-wiring');
    seed(dir, 'customers', { customers: [
      { id: 'cust-stmt', name: 'Statement Customer', balance: 50 },
      { id: 'cust-empty', name: 'Quiet Customer', balance: 0 }
    ]});
    seed(dir, 'suppliers', { suppliers: [{ id: 'sup-stmt', name: 'Statement Supplier', balance: 200 }] });
    seed(dir, 'products', { products: [{ id: 'rp-1', name: 'Report Widget', sellPrice: 10, buyPrice: 6, stockQty: 100 }] });
    server = await startServer(dir);

    const post = (urlPath, body) => request(server.app).post(urlPath).send(body);
    const r1 = await post('/api/v1/sales', { id: 'RPT-S1', items: [{ productId: 'rp-1', qty: 5, price: 10 }], total: 50, payment: 'cash', customerId: 'cust-stmt', customer: 'Statement Customer', date: '2026-09-18T10:00:00.000Z' });
    expect(r1.statusCode).toBe(201);
    const r2 = await post('/api/v1/sales', { id: 'RPT-S2', items: [{ productId: 'rp-1', qty: 4, price: 10 }], total: 40, payment: 'credit', customerId: 'cust-stmt', customer: 'Statement Customer', date: '2026-09-19T10:00:00.000Z' });
    expect(r2.statusCode).toBe(201);
    const r3 = await post('/api/v1/customer-payments', { id: 'RPT-PAY-1', customerId: 'cust-stmt', amount: 30, method: 'cash', date: '2026-09-19T12:00:00.000Z' });
    expect(r3.statusCode).toBe(201);
    const r4 = await post('/api/v1/purchases', { id: 'RPT-PO-1', items: [{ productId: 'rp-1', qty: 10, price: 6 }], total: 60, payment: 'cash', supplierId: 'sup-stmt', supplier: 'Statement Supplier', date: '2026-09-19T13:00:00.000Z' });
    expect(r4.statusCode).toBe(201);
    const r5 = await post('/api/v1/purchases', { id: 'RPT-PO-2', items: [{ productId: 'rp-1', qty: 5, price: 6 }], total: 30, payment: 'credit', supplierId: 'sup-stmt', supplier: 'Statement Supplier', date: '2026-09-20T10:00:00.000Z' });
    expect(r5.statusCode).toBe(201);
  });

  test('customer statement: opening + credit invoice + payment + running balance', async () => {
    const res = await get('/api/v1/reports/statement/customer/cust-stmt');
    expect(res.statusCode).toBe(200);
    const st = res.body.data;
    expect(st.customerId).toBe('cust-stmt');
    expect(st.opening).toBe(50);
    expect(st.rows.length).toBe(4);
    const seq = st.rows.map(r => r.type);
    expect(seq).toEqual(['opening', 'sale-cash', 'invoice', 'payment']);
    expect(st.rows.map(r => r.running)).toEqual([50, 50, 90, 60]);
    expect(st.balance).toBe(60);
    expect(st.outstanding).toBe(60);
    expect(st.rows[2].reference).toBe('RPT-S2');
    expect(st.rows[2].trace.saleId).toBe('RPT-S2');
    expect(st.rows[3].trace.paymentId).toBe('RPT-PAY-1');
    expect(st.rows[3].trace.treasuryEntryId).toBeTruthy();
  });

  test('customer statement for an idle customer is an empty zero ledger', async () => {
    const res = await get('/api/v1/reports/statement/customer/cust-empty');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.rows).toEqual([]);
    expect(res.body.data.balance).toBe(0);
    expect(res.body.data.outstanding).toBe(0);
  });

  test('supplier statement: opening + credit purchase, no balance mutation anywhere', async () => {
    const res = await get('/api/v1/reports/statement/supplier/sup-stmt');
    expect(res.statusCode).toBe(200);
    const st = res.body.data;
    expect(st.opening).toBe(200);
    const kinds = st.rows.map(r => r.type);
    expect(kinds).toEqual(['opening', 'purchase-cash', 'purchase']);
    expect(st.rows.map(r => r.running)).toEqual([200, 200, 230]);
    expect(st.balance).toBe(230);
    expect(st.outstanding).toBe(230);
    const sup = (readStore(dir, 'suppliers').suppliers || []).find(s => s.id === 'sup-stmt');
    expect(sup.balance).toBe(200); // never mutated by postings
  });

  test('daily sales: per-day count/cash/credit from real invoices', async () => {
    const res = await get('/api/v1/reports/summary/sales/daily');
    expect(res.statusCode).toBe(200);
    const days = {};
    res.body.data.rows.forEach(r => { days[r.date] = r; });
    expect(days['2026-09-18'].count).toBe(1);
    expect(days['2026-09-18'].cashTotal).toBe(50);
    expect(days['2026-09-18'].creditTotal).toBe(0);
    expect(days['2026-09-19'].creditTotal).toBe(40);
    expect(res.body.data.totals.count).toBe(2);
    expect(res.body.data.totals.total).toBe(90);
  });

  test('daily purchases: per-day cash/credit totals', async () => {
    const res = await get('/api/v1/reports/summary/purchases/daily');
    expect(res.statusCode).toBe(200);
    const days = {};
    res.body.data.rows.forEach(r => { days[r.date] = r; });
    expect(days['2026-09-19'].cashTotal).toBe(60);
    expect(days['2026-09-20'].creditTotal).toBe(30);
    expect(res.body.data.totals.total).toBe(90);
  });

  test('cash flow: treasury is the only source; each entry counted exactly once', async () => {
    const res = await get('/api/v1/reports/cash-flow');
    expect(res.statusCode).toBe(200);
    const cf = res.body.data;
    expect(cf.in).toBe(80);   // 50 sale receipt + 30 customer payment
    expect(cf.out).toBe(60);  // purchase payment
    expect(cf.net).toBe(20);
    expect(cf.byCategory['sale-receipt'].in).toBe(50);
    expect(cf.byCategory['customer-payment'].in).toBe(30);
    expect(cf.byCategory['purchase-payment'].out).toBe(60);
    expect(cf.rows.length).toBe(cf.countIn + cf.countOut);
    const byId = {};
    cf.rows.forEach(r => { byId[r.reference] = (byId[r.reference] || 0) + 1; });
    expect(Object.values(byId).every(n => n === 1)).toBe(true);
  });

  test('inventory summary: real in/out transactions + current stock', async () => {
    const res = await get('/api/v1/reports/summary/inventory');
    expect(res.statusCode).toBe(200);
    const row = (res.body.data.rows || []).find(r => r.productId === 'rp-1');
    expect(row.in).toBe(15);   // P1 10 + P2 5
    expect(row.out).toBe(9);   // S1 5 + S2 4
    expect(row.reversals).toBe(0);
    expect(row.currentStock).toBe(106);
    expect(res.body.data.totals.net).toBe(6);
  });

  test('date range filtering narrows every reader consistently', async () => {
    const q = '?from=2026-09-19&to=2026-09-19';
    const sales = await get('/api/v1/reports/summary/sales/daily' + q);
    expect(sales.body.data.rows.length).toBe(1);
    expect(sales.body.data.rows[0].date).toBe('2026-09-19');

    const cf = await get('/api/v1/reports/cash-flow' + q);
    expect(cf.body.data.in).toBe(30);  // only the payment day
    expect(cf.body.data.out).toBe(60);

    const stmt = await get('/api/v1/reports/statement/customer/cust-stmt' + q);
    expect(stmt.body.data.rows.map(r => r.type)).toEqual(['opening', 'invoice', 'payment']);
    expect(stmt.body.data.balance).toBe(60);    // opening 50 + invoice 40 - payment 30: opening is opening even under a date range
  });

  test('reversal of the credit sale removes its effects from every report', async () => {
    const del = await request(server.app).delete('/api/v1/sales/RPT-S2');
    expect(del.statusCode).toBe(200);

    const sales = await get('/api/v1/reports/summary/sales/daily');
    expect(sales.body.data.totals.total).toBe(50);
    expect(sales.body.data.totals.creditTotal).toBe(0);

    const stmt = await get('/api/v1/reports/statement/customer/cust-stmt');
    expect(stmt.body.data.rows.some(r => r.type === 'invoice' && r.reference === 'RPT-S2')).toBe(false);
    expect(stmt.body.data.outstanding).toBe(20); // 50 opening - 30 payment
  });

  test('reversal of the payment restores debt and treasury receipt disappears', async () => {
    const del = await request(server.app).delete('/api/v1/customer-payments/RPT-PAY-1');
    expect(del.statusCode).toBe(200);

    const stmt = await get('/api/v1/reports/statement/customer/cust-stmt');
    expect(stmt.body.data.outstanding).toBe(50); // opening only

    const cf = await get('/api/v1/reports/cash-flow');
    expect(cf.body.data.in).toBe(50); // payment receipt gone
    expect((cf.body.data.byCategory['customer-payment'] || {}).in || 0).toBe(0);
  });
});
// ---------------------------------------------------------------------------
// TENANT + BRANCH ISOLATION + RBAC for readers
// ---------------------------------------------------------------------------
describe('Reports wiring — isolation + authz', () => {
  let app;
  let dir;
  let tokenNile;
  let tokenDigi;
  let mainToken;
  let otherToken;

  registerCleanup(() => [null], () => [dir]);

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  beforeAll(async () => {
    setFlag('ENABLE_MULTI_COMPANY_LOGIN');
    setFlag('ENABLE_TENANT_USER_MEMBERSHIP');
    setFlag('ENABLE_TENANT_ROLES');
    setFlag('ENABLE_TENANT_CARRY');
    setFlag('ENABLE_TENANT_SALES_ISOLATION');
    setFlag('ENABLE_TENANT_PURCHASES_ISOLATION');
    setFlag('ENABLE_TENANT_FILTERING');
    setFlag('ENABLE_BRANCH_ISOLATION');
    dir = makeTempDataDir('reports-wiring-iso');
    seed(dir, 'companies', { companies: [
      { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
    ]});
    const stamp = new Date().toISOString();
    seed(dir, 'users', { users: [
      { id: 'u-owner', username: 'owner1', password: hash('Owner#123'), role: 'Owner', fullName: 'Owner One', createdAt: stamp, updatedAt: stamp },
      { id: 'u-bm-main', username: 'bmmain', password: hash('Main#1234'), role: 'BranchManager', fullName: 'Main BM', branchId: 'MAIN', permissions: ['sales.view', 'sales.create', 'treasury.view', 'customerPayments.view', 'customerPayments.create', 'reports.view', 'reports.financial.view'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-bm-other', username: 'bmother', password: hash('Other#123'), role: 'BranchManager', fullName: 'Other BM', branchId: 'OTHER', permissions: ['sales.view', 'sales.create', 'treasury.view', 'customerPayments.view', 'customerPayments.create', 'reports.view', 'reports.financial.view'], createdAt: stamp, updatedAt: stamp }
    ]});
    seed(dir, 'customers', { customers: [
      { id: 'cust-nile', name: 'Nile Statement Customer', balance: 10, tenantId: 'nile' },
      { id: 'cust-digi', name: 'Digi Statement Customer', balance: 0, tenantId: 'digi' }
    ]});
    seed(dir, 'suppliers', { suppliers: [{ id: 'sup-nile', name: 'Nile Reports Supplier', balance: 0, tenantId: 'nile' }] });
    seed(dir, 'products', { products: [{ id: 'rp-iso', name: 'Iso Report Widget', sellPrice: 25, stockQty: 30 }] });

    const started = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    const login = async (username, password, company) => {
      const body = company ? { username: username, password: password, company: company } : { username: username, password: password };
      const res = await request(app).post('/api/v1/auth/login').send(body);
      return res.body && res.body.data && res.body.data.accessToken;
    };
    const owner = await login('owner1', 'Owner#123');
    tokenNile = await request(app).post('/api/v1/auth/login').send({ username: 'owner1', password: 'Owner#123', company: 'nile' }).then(r => r.body && r.body.data && r.body.data.accessToken);
    tokenDigi = await request(app).post('/api/v1/auth/login').send({ username: 'owner1', password: 'Owner#123', company: 'digi' }).then(r => r.body && r.body.data && r.body.data.accessToken);
    mainToken = await login('bmmain', 'Main#1234');
    otherToken = await login('bmother', 'Other#123');
    expect(owner && tokenNile && tokenDigi && mainToken && otherToken).toBeTruthy();

    const nileSale = await request(app).post('/api/v1/sales').set('Authorization', 'Bearer ' + tokenNile).send({
      id: 'RPT-ISO-S1', items: [{ productId: 'rp-iso', qty: 2, price: 25 }], total: 50,
      payment: 'credit', customerId: 'cust-nile', date: '2026-09-19T10:00:00.000Z'
    });
    expect(nileSale.statusCode).toBe(201);
    const mainSale = await request(app).post('/api/v1/sales').set('Authorization', 'Bearer ' + mainToken).send({
      id: 'RPT-BR-S1', items: [{ productId: 'rp-iso', qty: 1, price: 25 }], total: 25,
      payment: 'cash', date: '2026-09-19T11:00:00.000Z', customerId: 'cust-nile'
    });
    expect(mainSale.statusCode).toBe(201);
  });

  afterAll(() => restoreEnv());

  test('tenant boundary: nile-tagged invoice is stamped and never attributed to digi', async () => {
    // server-authoritative tenant stamping on the raw invoice record
    const salesDb = readStore(dir, 'sales');
    const own = (salesDb.invoices || []).find(i => i.id === 'RPT-ISO-S1');
    expect(String(own.tenantId)).toBe('nile');

    const nile = await request(app).get('/api/v1/reports/summary/sales/daily').set('Authorization', 'Bearer ' + tokenNile);
    expect(nile.statusCode).toBe(200);
    const nileRefs = (nile.body.data.rows || []).flatMap(r => r.refs || []);
    expect(nileRefs).toContain('RPT-ISO-S1'); // own tenant row present, attribution intact

    const digi = await request(app).get('/api/v1/reports/summary/sales/daily').set('Authorization', 'Bearer ' + tokenDigi);
    expect(digi.statusCode).toBe(200);
    const digiRefs = (digi.body.data.rows || []).flatMap(r => r.refs || []);
    expect(digiRefs).not.toContain('RPT-ISO-S1'); // nile-tagged row never leaks
  });

  test('ledger uses server tenant: digi statement hides nile rows even by name', async () => {
    const digi = await request(app).get('/api/v1/reports/statement/customer/cust-digi').set('Authorization', 'Bearer ' + tokenDigi);
    expect(digi.statusCode).toBe(200);
    expect(digi.body.data.rows.some(r => r.reference === 'RPT-ISO-S1')).toBe(false);

    const nile = await request(app).get('/api/v1/reports/statement/customer/cust-nile').set('Authorization', 'Bearer ' + tokenNile);
    expect(nile.statusCode).toBe(200);
    expect(nile.body.data.outstanding).toBe(60); // 10 opening + 50 credit
  });

  test('branch isolation: OTHER branch sees only its own scope in reports', async () => {
    const other = await request(app).get('/api/v1/reports/summary/sales/daily').set('Authorization', 'Bearer ' + otherToken);
    expect(other.statusCode).toBe(200);
    expect((other.body.data.rows || []).some(r => (r.refs || []).includes('RPT-BR-S1'))).toBe(false);

    const main = await request(app).get('/api/v1/reports/summary/sales/daily').set('Authorization', 'Bearer ' + mainToken);
    expect(main.statusCode).toBe(200);
    expect((main.body.data.rows || []).flatMap(r => r.refs || [])).toContain('RPT-BR-S1');
  });

  test('RBAC: daily ops need reports.view; cash-flow needs the financial gate', async () => {
    const stamp = new Date().toISOString();
    const db = readStore(dir, 'users');
    db.users.push({ id: 'u-ops', username: 'opsuser', password: hash('Ops#123'), role: 'BranchManager', fullName: 'Ops Only', branchId: 'MAIN', permissions: ['reports.view'], createdAt: stamp, updatedAt: stamp });
    seed(dir, 'users', db);
    const login = await request(app).post('/api/v1/auth/login').send({ username: 'opsuser', password: 'Ops#123' });
    const ops = login.body.data.accessToken;

    const daily = await request(app).get('/api/v1/reports/summary/sales/daily').set('Authorization', 'Bearer ' + ops);
    expect(daily.statusCode).toBe(200);

    const cf = await request(app).get('/api/v1/reports/cash-flow').set('Authorization', 'Bearer ' + ops);
    expect(cf.statusCode).toBe(403);

    const sup = await request(app).get('/api/v1/reports/statement/supplier/sup-nile').set('Authorization', 'Bearer ' + ops);
    expect(sup.statusCode).toBe(403);
  });

  test('unauthorized readers are rejected (401)', async () => {
    const res = await request(app).get('/api/v1/reports/cash-flow');
    expect(res.statusCode).toBe(401);
  });
});