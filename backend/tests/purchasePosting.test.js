'use strict';

// DAY 2 — PURCHASE POSTING WORKFLOW tests.
//
// Mirrors the Day 1 sales posting guarantees for the purchase cycle:
//   Product stock  -> increased on purchase, removed on delete/repost
//   Inventory tx   -> "in" record on purchase, "purchase-reversal" out on undo
//   Treasury       -> "out" payment for CASH purchases, linked by purchaseId
//   Supplier model -> supplier.balance is an OPENING balance; credit debt is
//                     derived from the invoice (never double-counted)
//   Failure path   -> invalid qty rejects with 400 BEFORE any write
//   Update         -> old posting reversed in full, merged invoice reposted
//   Isolation      -> tenant + branch stamping from the SERVER only
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
  ISO: process.env.ENABLE_TENANT_PURCHASES_ISOLATION,
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
    ['ISO', 'ENABLE_TENANT_PURCHASES_ISOLATION'],
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
// LEGACY MODE (no auth) — full posting cycle
// ---------------------------------------------------------------------------
describe('Purchase posting workflow (legacy mode)', () => {
  let server;
  let dir;

  registerCleanup(() => [server], () => [dir]);

  const qty = (id) => {
    const db = readStore(dir, 'products');
    const p = (db.products || []).find(x => x.id === id);
    return p ? p.stockQty : undefined;
  };

  beforeAll(async () => {
    dir = makeTempDataDir('purchase-posting');
    seed(dir, 'products', {
      products: [
        { id: 'pp-1', name: 'PP Mouse', sellPrice: 50, buyPrice: 30, stockQty: 10 },
        { id: 'pp-2', name: 'PP Keyboard', sellPrice: 100, buyPrice: 70, stockQty: 4 }
      ]
    });
    seed(dir, 'suppliers', { suppliers: [{ id: 'sup-1', name: 'Supplier One', balance: 500 }] });
    server = await startServer(dir);
  });

  test('cash purchase: stock increased, inventory tx written, treasury payment posted', async () => {
    const res = await request(server.app).post('/api/v1/purchases').send({
      id: 'PO-1',
      items: [
        { productId: 'pp-1', qty: 3, price: 30 },
        { productId: 'pp-2', qty: 1, price: 70 }
      ],
      total: 160,
      payment: 'cash',
      supplierId: 'sup-1',
      supplier: 'Supplier One'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.postedEffects).toBeTruthy();
    expect(res.body.data.postedEffects.additions.length).toBe(2);
    expect(res.body.data.postedEffects.treasuryEntryId).toBeTruthy();

    expect(qty('pp-1')).toBe(13);
    expect(qty('pp-2')).toBe(5);

    const tx = readStore(dir, 'inventoryTransactions');
    const ins = (tx.transactions || []).filter(t => t.refType === 'purchase' && t.refId === 'PO-1' && t.type === 'in');
    expect(ins.length).toBe(2);

    const treasury = readStore(dir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.purchaseId === 'PO-1');
    expect(entry).toBeTruthy();
    expect(entry.type).toBe('out');
    expect(entry.amount).toBe(160);
    expect(entry.source).toBe('purchase');
  });

  test('credit purchase: stock increased, NO treasury payment, supplier debt derived not mutated', async () => {
    const res = await request(server.app).post('/api/v1/purchases').send({
      id: 'PO-2',
      items: [{ productId: 'pp-1', qty: 2, price: 30 }],
      total: 300,
      payment: 'credit',
      supplierId: 'sup-1'
    });
    expect(res.statusCode).toBe(201);
    expect(qty('pp-1')).toBe(15);

    const treasury = readStore(dir, 'treasury');
    expect((treasury.entries || []).some(e => e.purchaseId === 'PO-2')).toBe(false);

    // supplier.balance is the OPENING balance — mutating it would double-count
    // the credit invoice. Debt = opening balance + credit purchase totals.
    const sup = (readStore(dir, 'suppliers').suppliers || []).find(s => s.id === 'sup-1');
    expect(sup.balance).toBe(500);
    const purchases = readStore(dir, 'purchases').invoices;
    const creditDebt = purchases.filter(p => String(p.supplierId) === 'sup-1' && String(p.payment || '').toLowerCase() !== 'cash').reduce((s, p) => s + (Number(p.total) || 0), 0);
    expect(sup.balance + creditDebt).toBe(800);
  });

  test('failure path: invalid qty -> 400 and stores stay byte-identical', async () => {
    const file = (n) => path.join(dir, n + '.json');
    const snap = (n) => (fs.existsSync(file(n)) ? fs.readFileSync(file(n), 'utf-8') : null);
    const before = { purchases: snap('purchases'), products: snap('products'), treasury: snap('treasury'), tx: snap('inventoryTransactions') };

    const res = await request(server.app).post('/api/v1/purchases').send({
      id: 'PO-3',
      items: [{ productId: 'pp-1', qty: -4, price: 30 }],
      total: 100,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Invalid qty/i);

    expect(snap('purchases')).toBe(before.purchases);
    expect(snap('products')).toBe(before.products);
    expect(snap('treasury')).toBe(before.treasury);
    expect(snap('inventoryTransactions')).toBe(before.tx);
  });

  test('duplicate lines of the same product are aggregated once', async () => {
    const res = await request(server.app).post('/api/v1/purchases').send({
      id: 'PO-4',
      items: [
        { productId: 'pp-2', qty: 2, price: 70 },
        { productId: 'pp-2', qty: 3, price: 70 }
      ],
      total: 350,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(201);
    expect(qty('pp-2')).toBe(10); // 5 + 2 + 3
    expect(res.body.data.postedEffects.additions.length).toBe(1);
    expect(res.body.data.postedEffects.additions[0].qty).toBe(5);
  });

  test('update reposts safely: old posting reversed, merged invoice posted once', async () => {
    const before = qty('pp-1'); // 15
    const res = await request(server.app).put('/api/v1/purchases/PO-1').send({
      items: [{ productId: 'pp-1', qty: 6, price: 30 }],
      total: 180,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.postedEffects.additions[0].qty).toBe(6);
    expect(qty('pp-1')).toBe(before - 3 + 6); // reverse 3, post 6

    const treasury = readStore(dir, 'treasury');
    const entries = (treasury.entries || []).filter(e => e.purchaseId === 'PO-1');
    expect(entries.length).toBe(1); // no double posting
    expect(entries[0].amount).toBe(180);
  });

  test('invalid update is rejected BEFORE reversal: old posting stays intact', async () => {
    const beforeQty = qty('pp-1');
    const beforeTreasury = fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8');
    const res = await request(server.app).put('/api/v1/purchases/PO-1').send({
      items: [{ productId: 'pp-1', qty: -1, price: 30 }],
      total: 180
    });
    expect(res.statusCode).toBe(400);
    expect(qty('pp-1')).toBe(beforeQty);
    expect(fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);

    const check = await request(server.app).get('/api/v1/purchases/PO-1');
    expect(check.body.data.postedEffects.additions[0].qty).toBe(6);
  });

  test('delete reverses the posting: stock removed, treasury entry deleted, reversal tx written', async () => {
    const res = await request(server.app).delete('/api/v1/purchases/PO-2');
    expect(res.statusCode).toBe(200);
    expect(qty('pp-1')).toBe(16); // 18 - 2

    const tx = readStore(dir, 'inventoryTransactions');
    const rev = (tx.transactions || []).filter(t => t.refType === 'purchase-reversal' && t.refId === 'PO-2' && t.type === 'out');
    expect(rev.length).toBe(1);
  });

  test('delete of a legacy purchase without postedEffects keeps legacy behaviour', async () => {
    const pdb = readStore(dir, 'purchases') || { invoices: [] };
    pdb.invoices.push({ id: 'PO-LEGACY', items: [{ productId: 'pp-1', qty: 1 }], total: 30, payment: 'cash', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    seed(dir, 'purchases', pdb);

    const beforeProducts = fs.readFileSync(path.join(dir, 'products.json'), 'utf-8');
    const beforeTreasury = fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8');
    const res = await request(server.app).delete('/api/v1/purchases/PO-LEGACY');
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(dir, 'products.json'), 'utf-8')).toBe(beforeProducts);
    expect(fs.readFileSync(path.join(dir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);
  });
});
// ---------------------------------------------------------------------------
// TENANT ISOLATION — generated records carry the SERVER tenant only.
// ---------------------------------------------------------------------------
describe('Purchase posting — tenant isolation + authz', () => {
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
    process.env.ENABLE_TENANT_PURCHASES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    dir = makeTempDataDir('purchase-posting-iso');
    seed(dir, 'companies', {
      companies: [
        { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
        { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
      ]
    });
    const stamp = new Date().toISOString();
    seed(dir, 'users', {
      users: [
        { id: 'u-nile', username: 'nileuser', password: PASSWORD, fullName: 'Nile User', role: 'Manager', tenantIds: ['nile'], tenantRoles: { nile: 'Manager' }, createdAt: stamp, updatedAt: stamp },
        { id: 'u-digi', username: 'digiuser', password: PASSWORD, fullName: 'Digi User', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp }
      ]
    });
    seed(dir, 'products', { products: [{ id: 'pp-iso', name: 'Iso Widget', sellPrice: 15, stockQty: 2 }] });
    seed(dir, 'suppliers', {
      suppliers: [
        { id: 'sup-nile', name: 'Nile Supplier', balance: 0, tenantId: 'nile' },
        { id: 'sup-digi', name: 'Digi Supplier', balance: 0, tenantId: 'digi' }
      ]
    });

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

  test('unauthorized: POST without a token is rejected (401)', async () => {
    const res = await request(app).post('/api/v1/purchases').send({
      id: 'PO-NOAUTH', items: [{ productId: 'pp-iso', qty: 1 }], total: 15
    });
    expect(res.statusCode).toBe(401);
    const prod = (readStore(dir, 'products').products || []).find(p => p.id === 'pp-iso');
    expect(prod.stockQty).toBe(2);
  });

  test('nile cash purchase posts records stamped with tenant nile', async () => {
    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + tokenNile)
      .send({
        id: 'PO-ISO-1',
        items: [{ productId: 'pp-iso', qty: 5, price: 10 }],
        total: 50,
        payment: 'cash',
        supplierId: 'sup-nile'
      });
    expect(res.statusCode).toBe(201);

    const treasury = readStore(dir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.purchaseId === 'PO-ISO-1');
    expect(entry).toBeTruthy();
    expect(String(entry.tenantId)).toBe('nile');

    const tx = readStore(dir, 'inventoryTransactions');
    const inTx = (tx.transactions || []).find(t => t.refId === 'PO-ISO-1' && t.type === 'in');
    expect(inTx).toBeTruthy();
    expect(String(inTx.tenantId)).toBe('nile');

    const prod = (readStore(dir, 'products').products || []).find(p => p.id === 'pp-iso');
    expect(prod.stockQty).toBe(7);
  });

  test('digi cannot see the nile purchase, treasury payment, or inventory tx', async () => {
    const pres = await request(app).get('/api/v1/purchases').set('Authorization', 'Bearer ' + tokenDigi);
    expect((pres.body.data.invoices || []).some(i => i.id === 'PO-ISO-1')).toBe(false);

    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenDigi);
    expect((tres.body.data.entries || []).some(e => e.purchaseId === 'PO-ISO-1')).toBe(false);

    const xres = await request(app).get('/api/v1/inventory-transactions').set('Authorization', 'Bearer ' + tokenDigi);
    expect((xres.body.data.transactions || []).some(t => t.refId === 'PO-ISO-1')).toBe(false);

    const nres = await request(app).get('/api/v1/purchases').set('Authorization', 'Bearer ' + tokenNile);
    expect((nres.body.data.invoices || []).some(i => i.id === 'PO-ISO-1')).toBe(true);
  });

  test('cross-tenant supplierId is rejected before any posting (no partial write)', async () => {
    const beforeQty = (readStore(dir, 'products').products || []).find(p => p.id === 'pp-iso').stockQty;
    const treasuryFile = path.join(dir, 'treasury.json');
    const beforeTreasury = fs.existsSync(treasuryFile) ? fs.readFileSync(treasuryFile, 'utf-8') : null;

    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + tokenDigi)
      .send({
        id: 'PO-XSUP',
        items: [{ productId: 'pp-iso', qty: 1, price: 10 }],
        total: 10,
        payment: 'cash',
        supplierId: 'sup-nile'
      });
    expect(res.statusCode).toBe(400);
    expect((readStore(dir, 'products').products || []).find(p => p.id === 'pp-iso').stockQty).toBe(beforeQty);
    const afterTreasury = fs.existsSync(treasuryFile) ? fs.readFileSync(treasuryFile, 'utf-8') : null;
    expect(afterTreasury).toBe(beforeTreasury);
  });
});
// ---------------------------------------------------------------------------
// BRANCH ISOLATION — posted records stay inside the caller branch scope.
// ---------------------------------------------------------------------------
describe('Purchase posting — branch isolation', () => {
  let app;
  let dir;
  let mainToken;
  let otherToken;

  registerCleanup(() => [null], () => [dir]);

  const hash = (pw) => bcrypt.hashSync(pw, 10);

  beforeAll(async () => {
    process.env.ENABLE_BRANCH_ISOLATION = 'true';
    dir = makeTempDataDir('purchase-posting-branch');
    const stamp = new Date().toISOString();
    const perms = ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete', 'treasury.view'];
    seed(dir, 'users', {
      users: [
        { id: 'u-bm-main', username: 'bmmain', password: hash('Main#1234'), role: 'BranchManager', fullName: 'Main BM', branchId: 'MAIN', permissions: perms, createdAt: stamp, updatedAt: stamp },
        { id: 'u-bm-other', username: 'bmother', password: hash('Other#123'), role: 'BranchManager', fullName: 'Other BM', branchId: 'OTHER', permissions: perms, createdAt: stamp, updatedAt: stamp }
      ]
    });
    seed(dir, 'products', { products: [{ id: 'pp-br', name: 'Branch Widget', sellPrice: 10, stockQty: 1 }] });

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

  test('MAIN branch purchase posts treasury payment stamped with branch MAIN (server-side)', async () => {
    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({
        id: 'PO-BR-1',
        items: [{ productId: 'pp-br', qty: 4, price: 5 }],
        total: 20,
        payment: 'cash'
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.branchId).toBe('MAIN');

    const treasury = readStore(dir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.purchaseId === 'PO-BR-1');
    expect(entry).toBeTruthy();
    expect(String(entry.branchId)).toBe('MAIN');

    const prod = (readStore(dir, 'products').products || []).find(p => p.id === 'pp-br');
    expect(prod.stockQty).toBe(5);
  });

  test('OTHER branch cannot see the MAIN purchase or its treasury payment', async () => {
    const pres = await request(app).get('/api/v1/purchases').set('Authorization', 'Bearer ' + otherToken);
    expect(pres.statusCode).toBe(200);
    expect((pres.body.data.invoices || []).some(i => i.id === 'PO-BR-1')).toBe(false);

    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + otherToken);
    expect(tres.statusCode).toBe(200);
    expect((tres.body.data.entries || []).some(e => e.purchaseId === 'PO-BR-1')).toBe(false);
  });

  test('branch user cannot post a purchase claiming a foreign branchId', async () => {
    const res = await request(app)
      .post('/api/v1/purchases')
      .set('Authorization', 'Bearer ' + mainToken)
      .send({
        id: 'PO-BR-X',
        items: [{ productId: 'pp-br', qty: 1, price: 5 }],
        total: 5,
        payment: 'cash',
        branchId: 'OTHER'
      });
    expect([400, 403]).toContain(res.statusCode);
    const prod = (readStore(dir, 'products').products || []).find(p => p.id === 'pp-br');
    expect(prod.stockQty).toBe(5); // unchanged
  });
});