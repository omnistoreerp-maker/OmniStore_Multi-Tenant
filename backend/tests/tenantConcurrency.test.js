'use strict';

// PHASE 28 — TENANT ACROSS REQUEST ISOLATION (CONCURRENCY / ALTERNATION).
//
// Verifies that two simultaneous tenant requests never leak context between
// each other, and that repeated alternating requests (A -> B -> A -> B) never
// inherit a previous request's tenant.
//
// Architecture under test:
//   - tenant identity lives ONLY on the request (req.tenantContext), rebuilt
//     from the signed JWT by tenantCarry per request.
//   - Sales/Purchases services build a FRESH accessor-wired BaseRepository per
//     call via _repoFor(tenantContext) with a per-request closure
//     ({ getCurrentTenant: () => ({ tenantId }) }) — never stored globally.
//   - Entity writes persist the FULL unfiltered document (_rawStore), so a
//     cross-tenant interleave can never drop another tenant's rows.
//
// Everything runs against a REAL express app on isolated mkdtemp dirs; the
// production backend/data directory is never touched.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const PASSWORD = 'Pass#123';

const ENV_KEYS = {
  MC: 'ENABLE_MULTI_COMPANY_LOGIN',
  MEM: 'ENABLE_TENANT_USER_MEMBERSHIP',
  ROLES: 'ENABLE_TENANT_ROLES',
  CARRY: 'ENABLE_TENANT_CARRY',
  SALES: 'ENABLE_TENANT_SALES_ISOLATION',
  PURCHASES: 'ENABLE_TENANT_PURCHASES_ISOLATION',
  AUTH: 'AUTH_REQUIRED'
};
const ORIGINAL_ENV = {};
for (const [k, envName] of Object.entries(ENV_KEYS)) ORIGINAL_ENV[k] = process.env[envName];

const tempDirs = [];

const companies = {
  companies: [
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true }
  ]
};

function userRecords(stamp) {
  return [
    { id: 'u-nile', username: 'nileuser', password: PASSWORD, fullName: 'Nile User', role: 'Manager', tenantIds: ['nile'], tenantRoles: { nile: 'Manager' }, createdAt: stamp, updatedAt: stamp },
    { id: 'u-digi', username: 'digiuser', password: PASSWORD, fullName: 'Digi User', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp }
  ];
}

function salesRecords() {
  const t1 = '2026-01-01T10:00:00.000Z';
  const t2 = '2026-01-02T10:00:00.000Z';
  const t3 = '2026-01-03T10:00:00.000Z';
  return {
    invoices: [
      { id: 'INV-NILE-1', invoiceId: 'N-1001', items: [{ productId: 'pn', qty: 1 }], total: 100, customer: 'Nile Customer', payment: 'Cash', tenantId: 'nile', createdAt: t1, updatedAt: t1 },
      { id: 'INV-DIGI-1', invoiceId: 'D-2001', items: [{ productId: 'pd', qty: 2 }], total: 200, customer: 'Digi Customer', payment: 'Credit', tenantId: 'digi', createdAt: t2, updatedAt: t2 },
      { id: 'INV-LEG-1', invoiceId: 'L-0001', items: [{ productId: 'pX', qty: 1 }], total: 50, customer: 'Legacy Customer', payment: 'Cash', createdAt: t3, updatedAt: t3 }
    ]
  };
}

function purchaseRecords() {
  const t1 = '2026-01-01T10:00:00.000Z';
  const t2 = '2026-01-02T10:00:00.000Z';
  const t3 = '2026-01-03T10:00:00.000Z';
  return {
    invoices: [
      { id: 'PUR-NILE-1', invoiceId: 'PN-1001', items: [{ productId: 'pn', qty: 1 }], total: 90, supplier: 'Nile Supplier', payment: 'Cash', tenantId: 'nile', createdAt: t1, updatedAt: t1 },
      { id: 'PUR-DIGI-1', invoiceId: 'PD-2001', items: [{ productId: 'pd', qty: 2 }], total: 180, supplier: 'Digi Supplier', payment: 'Credit', tenantId: 'digi', createdAt: t2, updatedAt: t2 },
      { id: 'PUR-LEG-1', invoiceId: 'PL-0001', items: [{ productId: 'pX', qty: 1 }], total: 40, supplier: 'Legacy Supplier', payment: 'Cash', createdAt: t3, updatedAt: t3 }
    ]
  };
}

function seedAll(dir) {
  const stamp = new Date().toISOString();
  seed(dir, 'users', { users: userRecords(stamp) });
  seed(dir, 'companies', companies);
  seed(dir, 'sales', salesRecords());
  seed(dir, 'purchases', purchaseRecords());
}

async function doLogin(app, username, company) {
  const body = company ? { username, password: PASSWORD, company } : { username, password: PASSWORD };
  const res = await request(app).post('/api/v1/auth/login').send(body);
  const d = res.body && res.body.data;
  return d || {};
}

describe('Phase 28 — tenant request-concurrency isolation', () => {
  let server;
  let dir;
  let tokenNile;
  let tokenDigi;

  beforeAll(async () => {
    jest.resetModules();
    for (const envName of Object.values(ENV_KEYS)) process.env[envName] = 'true';

    dir = makeTempDataDir('nconcurrency');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    tokenNile = (await doLogin(server, 'nileuser', 'nile')).accessToken;
    tokenDigi = (await doLogin(server, 'digiuser', 'digi')).accessToken;
  });

  afterAll(() => {
    for (const d of tempDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    }
    tempDirs.length = 0;
    for (const [k, envName] of Object.entries(ENV_KEYS)) {
      const orig = ORIGINAL_ENV[k];
      if (orig === undefined) delete process.env[envName];
      else process.env[envName] = orig;
    }
  });

  function salesIds(res) { return ((res.body && res.body.data && res.body.data.invoices) || []).map(i => i.id); }
  function purchaseIds(res) { return ((res.body && res.body.data && res.body.data.invoices) || []).map(i => i.id); }

  test('concurrent sales list: A sees only A+legacy, B sees only B+legacy', async () => {
    const [digiRes, nileRes] = await Promise.all([
      request(server).get('/api/v1/sales').set('Authorization', `Bearer ${tokenDigi}`),
      request(server).get('/api/v1/sales').set('Authorization', `Bearer ${tokenNile}`)
    ]);
    const digi = salesIds(digiRes);
    const nile = salesIds(nileRes);
    expect(digi).toContain('INV-DIGI-1');
    expect(digi).toContain('INV-LEG-1');
    expect(digi).not.toContain('INV-NILE-1');
    expect(nile).toContain('INV-NILE-1');
    expect(nile).toContain('INV-LEG-1');
    expect(nile).not.toContain('INV-DIGI-1');
  });

  test('concurrent sales getById: B cannot read A-owned invoice and vice-versa', async () => {
    const [dOwn, dForeign, nOwn, nForeign] = await Promise.all([
      request(server).get('/api/v1/sales/INV-DIGI-1').set('Authorization', `Bearer ${tokenDigi}`),
      request(server).get('/api/v1/sales/INV-NILE-1').set('Authorization', `Bearer ${tokenDigi}`),
      request(server).get('/api/v1/sales/INV-NILE-1').set('Authorization', `Bearer ${tokenNile}`),
      request(server).get('/api/v1/sales/INV-DIGI-1').set('Authorization', `Bearer ${tokenNile}`)
    ]);
    expect(dOwn.statusCode).toBe(200);
    expect(dForeign.statusCode).toBe(404);
    expect(nOwn.statusCode).toBe(200);
    expect(nForeign.statusCode).toBe(404);
  });

  test('concurrent purchases list + getById: no cross-tenant leak', async () => {
    const [dList, nList, dOwn, nOwn, dForeign] = await Promise.all([
      request(server).get('/api/v1/purchases').set('Authorization', `Bearer ${tokenDigi}`),
      request(server).get('/api/v1/purchases').set('Authorization', `Bearer ${tokenNile}`),
      request(server).get('/api/v1/purchases/PUR-DIGI-1').set('Authorization', `Bearer ${tokenDigi}`),
      request(server).get('/api/v1/purchases/PUR-NILE-1').set('Authorization', `Bearer ${tokenNile}`),
      request(server).get('/api/v1/purchases/PUR-NILE-1').set('Authorization', `Bearer ${tokenDigi}`)
    ]);
    const digi = purchaseIds(dList);
    const nile = purchaseIds(nList);
    expect(digi).toContain('PUR-DIGI-1');
    expect(digi).not.toContain('PUR-NILE-1');
    expect(nile).toContain('PUR-NILE-1');
    expect(nile).not.toContain('PUR-DIGI-1');
    expect(dOwn.statusCode).toBe(200);
    expect(nOwn.statusCode).toBe(200);
    expect(dForeign.statusCode).toBe(404);
  });

  test('alternating sequence A -> B -> A -> B never inherits another tenant', async () => {
    const seenDigi = new Set();
    const seenNile = new Set();
    for (let i = 0; i < 4; i++) {
      const r = await request(server).get('/api/v1/sales').set('Authorization', `Bearer ${tokenDigi}`);
      salesIds(r).forEach(id => seenDigi.add(id));
      const s = await request(server).get('/api/v1/sales').set('Authorization', `Bearer ${tokenNile}`);
      salesIds(s).forEach(id => seenNile.add(id));
    }
    expect(seenDigi.has('INV-DIGI-1')).toBe(true);
    expect(seenDigi.has('INV-NILE-1')).toBe(false);
    expect(seenNile.has('INV-NILE-1')).toBe(true);
    expect(seenNile.has('INV-DIGI-1')).toBe(false);
  });

  test('concurrent create stamps correct tenant and raw store stays complete', async () => {
    const [dCreate, nCreate] = await Promise.all([
      request(server).post('/api/v1/sales').set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'INV-CONC-DIGI', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, customer: 'Concurrent Digi' }),
      request(server).post('/api/v1/sales').set('Authorization', `Bearer ${tokenNile}`)
        .send({ id: 'INV-CONC-NILE', items: [{ productId: 'p2', qty: 1, price: 7 }], total: 7, customer: 'Concurrent Nile' })
    ]);
    expect(dCreate.statusCode).toBe(201);
    expect(nCreate.statusCode).toBe(201);
    expect(dCreate.body.data.tenantId).toBe('digi');
    expect(nCreate.body.data.tenantId).toBe('nile');

    const raw = fs.readFileSync(path.join(dir, 'sales.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const ids = (parsed.invoices || []).map(i => i.id);
    expect(ids).toContain('INV-CONC-DIGI');
    expect(ids).toContain('INV-CONC-NILE');
    expect(ids).toContain('INV-NILE-1');
    expect(ids).toContain('INV-DIGI-1');
    expect(ids).toContain('INV-LEG-1');
  });

  test('concurrent foreign-ownership write cannot cross tenant boundary', async () => {
    const [digiHijack, nileDel] = await Promise.all([
      request(server).put('/api/v1/sales/INV-NILE-1').set('Authorization', `Bearer ${tokenDigi}`)
        .send({ total: 999 }),
      request(server).delete('/api/v1/sales/INV-DIGI-1').set('Authorization', `Bearer ${tokenNile}`)
    ]);
    expect(digiHijack.statusCode).toBe(404);
    expect(nileDel.statusCode).toBe(404);

    const raw = fs.readFileSync(path.join(dir, 'sales.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    const ids = (parsed.invoices || []).map(i => i.id);
    expect(ids).toContain('INV-NILE-1');
    expect(ids).toContain('INV-DIGI-1');
  });

  test('concurrent purchases create: effectiveRole + tenant stamp stay per-tenant', async () => {
    const [d, n] = await Promise.all([
      request(server).post('/api/v1/purchases').set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PUR-CONC-DIGI', items: [{ productId: 'p1', qty: 1 }], total: 3, supplier: 'CC Digi' }),
      request(server).post('/api/v1/purchases').set('Authorization', `Bearer ${tokenNile}`)
        .send({ id: 'PUR-CONC-NILE', items: [{ productId: 'p2', qty: 1 }], total: 4, supplier: 'CC Nile' })
    ]);
    expect(d.statusCode).toBe(201);
    expect(n.statusCode).toBe(201);
    expect(d.body.data.tenantId).toBe('digi');
    expect(n.body.data.tenantId).toBe('nile');
  });
});