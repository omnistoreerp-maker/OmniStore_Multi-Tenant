'use strict';

// DAY 1 — SALES POSTING WORKFLOW tests.
//
// Covers the full business cycle that Sale creation now drives:
//   Product stock  -> deducted on sale, restored on sale delete
//   Inventory tx   -> "out" audit record on sale, "in" reversal on delete
//   Treasury       -> "in" receipt for CASH sales, removed on delete
//   Failure path   -> insufficient stock rejects the sale with 400 and the
//                     stores stay byte-identical (nothing is persisted)
//   Legacy safety  -> items that do not resolve to a product create no stock
//                     movement; invoices without postedEffects delete as before
//   Isolation      -> generated records carry the SERVER tenant; a different
//                     tenant can neither see the treasury receipt nor the
//                     inventory transactions.
//
// Everything runs against REAL express apps on isolated mkdtemp dirs;
// production backend/data is never touched.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
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
  AUTH: process.env.AUTH_REQUIRED
};

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

function seedProducts() {
  return {
    products: [
      { id: 'prod-mouse', name: 'Mouse', sellPrice: 50, buyPrice: 30, stockQty: 10 },
      { id: 'prod-kb', name: 'Keyboard', sellPrice: 100, buyPrice: 70, stockQty: 3 },
      { id: 'prod-service', name: 'Service (no stock)', sellPrice: 20 }
    ]
  };
}

function productQty(id) {
  const db = readStore(dataDir, 'products');
  const p = (db.products || []).find(x => x.id === id);
  return p ? p.stockQty : undefined;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('sale-posting');
  seed(dataDir, 'products', seedProducts());
  server = await startServer(dataDir);
});

describe('Sale posting workflow (legacy mode)', () => {
  test('happy path: cash sale deducts stock, writes inventory tx, posts treasury receipt', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'INV-POST-1',
      items: [
        { productId: 'prod-mouse', qty: 2, price: 50 },
        { productId: 'prod-kb', qty: 1, price: 100 }
      ],
      total: 200,
      payment: 'cash',
      customer: 'Walk-in'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.postedEffects).toBeTruthy();
    expect(res.body.data.postedEffects.deductions.length).toBe(2);
    expect(res.body.data.postedEffects.treasuryEntryId).toBeTruthy();

    expect(productQty('prod-mouse')).toBe(8);
    expect(productQty('prod-kb')).toBe(2);

    const tx = readStore(dataDir, 'inventoryTransactions');
    const outs = (tx.transactions || []).filter(t => t.refType === 'sale' && t.refId === 'INV-POST-1' && t.type === 'out');
    expect(outs.length).toBe(2);
    expect(outs.find(t => t.productId === 'prod-mouse').qty).toBe(2);

    const treasury = readStore(dataDir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.saleId === 'INV-POST-1');
    expect(entry).toBeTruthy();
    expect(entry.type).toBe('in');
    expect(entry.amount).toBe(200);
    expect(entry.source).toBe('sale');
  });

  test('credit sale deducts stock but does NOT post a treasury receipt', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'INV-POST-2',
      items: [{ productId: 'prod-mouse', qty: 1, price: 50 }],
      total: 50,
      payment: 'credit'
    });
    expect(res.statusCode).toBe(201);
    expect(productQty('prod-mouse')).toBe(7);
    const treasury = readStore(dataDir, 'treasury');
    expect((treasury.entries || []).some(e => e.saleId === 'INV-POST-2')).toBe(false);
  });

  test('failure path: insufficient stock -> 400 and stores stay byte-identical', async () => {
    const salesFile = path.join(dataDir, 'sales.json');
    const beforeSales = fs.existsSync(salesFile) ? fs.readFileSync(salesFile, 'utf-8') : null;
    const beforeProducts = fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8');
    const beforeTreasury = fs.readFileSync(path.join(dataDir, 'treasury.json'), 'utf-8');

    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'INV-POST-3',
      items: [{ productId: 'prod-kb', qty: 99, price: 100 }],
      total: 9900,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/Insufficient stock/i);

    const afterSales = fs.existsSync(salesFile) ? fs.readFileSync(salesFile, 'utf-8') : null;
    expect(afterSales).toBe(beforeSales);
    expect(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8')).toBe(beforeProducts);
    expect(fs.readFileSync(path.join(dataDir, 'treasury.json'), 'utf-8')).toBe(beforeTreasury);
  });

  test('aggregated duplicate lines of the same product are validated together', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'INV-POST-4',
      items: [
        { productId: 'prod-kb', qty: 2, price: 100 },
        { productId: 'prod-kb', qty: 2, price: 100 }
      ],
      total: 400,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(400);
    expect(productQty('prod-kb')).toBe(2);
  });

  test('items that do not resolve to a product are exempt (legacy tolerance)', async () => {
    const res = await request(server.app).post('/api/v1/sales').send({
      id: 'INV-POST-5',
      items: [{ productId: 'no-such-product', qty: 5, price: 10 }],
      total: 50,
      payment: 'cash'
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.postedEffects.deductions.length).toBe(0);
    expect(res.body.data.postedEffects.treasuryEntryId).toBeTruthy();
  });

  test('delete reverses the posting: stock restored, treasury entry removed, reversal tx written', async () => {
    const res = await request(server.app).delete('/api/v1/sales/INV-POST-1');
    expect(res.statusCode).toBe(200);

    expect(productQty('prod-mouse')).toBe(9);
    expect(productQty('prod-kb')).toBe(3);

    const treasury = readStore(dataDir, 'treasury');
    expect((treasury.entries || []).some(e => e.saleId === 'INV-POST-1')).toBe(false);

    const tx = readStore(dataDir, 'inventoryTransactions');
    const rev = (tx.transactions || []).filter(t => t.refType === 'sale-reversal' && t.refId === 'INV-POST-1' && t.type === 'in');
    expect(rev.length).toBe(2);
  });

  test('delete of a sale without postedEffects keeps legacy behaviour (no side effects)', async () => {
    const salesDb = readStore(dataDir, 'sales') || { invoices: [] };
    salesDb.invoices.push({ id: 'INV-LEGACY-9', items: [{ productId: 'prod-mouse', qty: 1 }], total: 50, payment: 'cash', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    seed(dataDir, 'sales', salesDb);

    const beforeProducts = fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8');
    const res = await request(server.app).delete('/api/v1/sales/INV-LEGACY-9');
    expect(res.statusCode).toBe(200);
    expect(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8')).toBe(beforeProducts);
  });
});

// ---------------------------------------------------------------------------
// TENANT ISOLATION — generated records belong to the SERVER tenant only.
// ---------------------------------------------------------------------------
describe('Sale posting — tenant isolation', () => {
  let app;
  let isoDir;
  let tokenNile;
  let tokenDigi;

  registerCleanup(() => [null], () => [isoDir]);

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    isoDir = makeTempDataDir('sale-posting-iso');
    seed(isoDir, 'companies', {
      companies: [
        { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
        { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
      ]
    });
    const stamp = new Date().toISOString();
    seed(isoDir, 'users', {
      users: [
        { id: 'u-nile', username: 'nileuser', password: PASSWORD, fullName: 'Nile User', role: 'Manager', tenantIds: ['nile'], tenantRoles: { nile: 'Manager' }, createdAt: stamp, updatedAt: stamp },
        { id: 'u-digi', username: 'digiuser', password: PASSWORD, fullName: 'Digi User', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp }
      ]
    });
    seed(isoDir, 'products', { products: [{ id: 'prod-iso', name: 'Iso Product', sellPrice: 10, stockQty: 5 }] });

    const started = await startServer(isoDir, { AUTH_REQUIRED: 'true' });
    app = started.app;

    const login = async (username, company) => {
      const res = await request(app).post('/api/v1/auth/login').send({ username: username, password: PASSWORD, company: company });
      return res.body && res.body.data && res.body.data.accessToken;
    };
    tokenNile = await login('nileuser', 'nile');
    tokenDigi = await login('digiuser', 'digi');
  });

  afterAll(() => {
    const map = [
      ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
      ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
      ['ROLES', 'ENABLE_TENANT_ROLES'],
      ['CARRY', 'ENABLE_TENANT_CARRY'],
      ['ISO', 'ENABLE_TENANT_SALES_ISOLATION'],
      ['FILTER', 'ENABLE_TENANT_FILTERING'],
      ['AUTH', 'AUTH_REQUIRED']
    ];
    for (const pair of map) {
      const orig = ORIGINAL_ENV[pair[0]];
      if (orig === undefined) delete process.env[pair[1]];
      else process.env[pair[1]] = orig;
    }
  });

  test('nile sale posts records stamped with the SERVER tenant (nile)', async () => {
    expect(tokenNile).toBeTruthy();
    const res = await request(app)
      .post('/api/v1/sales')
      .set('Authorization', 'Bearer ' + tokenNile)
      .send({
        id: 'INV-ISO-1',
        items: [{ productId: 'prod-iso', qty: 2, price: 10 }],
        total: 20,
        payment: 'cash'
      });
    expect(res.statusCode).toBe(201);

    const treasury = readStore(isoDir, 'treasury');
    const entry = (treasury.entries || []).find(e => e.saleId === 'INV-ISO-1');
    expect(entry).toBeTruthy();
    expect(String(entry.tenantId)).toBe('nile');

    const tx = readStore(isoDir, 'inventoryTransactions');
    const out = (tx.transactions || []).find(t => t.refId === 'INV-ISO-1' && t.type === 'out');
    expect(out).toBeTruthy();
    expect(String(out.tenantId)).toBe('nile');

    const prod = (readStore(isoDir, 'products').products || []).find(p => p.id === 'prod-iso');
    expect(prod.stockQty).toBe(3);
  });

  test('digi cannot see the nile treasury receipt or inventory transactions', async () => {
    const tres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenDigi);
    expect(tres.statusCode).toBe(200);
    expect((tres.body.data.entries || []).some(e => e.saleId === 'INV-ISO-1')).toBe(false);

    const xres = await request(app).get('/api/v1/inventory-transactions').set('Authorization', 'Bearer ' + tokenDigi);
    expect(xres.statusCode).toBe(200);
    expect((xres.body.data.transactions || []).some(t => t.refId === 'INV-ISO-1')).toBe(false);

    const nres = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenNile);
    expect(nres.statusCode).toBe(200);
    expect((nres.body.data.entries || []).some(e => e.saleId === 'INV-ISO-1')).toBe(true);
  });
});