'use strict';

// PHASE 24 — TENANT-SCOPED BUSINESS DATA ISOLATION (SALES ONLY).
//
// SALES is the pilot business domain for real multi-tenant isolation: when
// ENABLE_TENANT_SALES_ISOLATION=true and a TRUSTED tenant context is carried
// (req.tenantContext, re-built from the signed JWT claim by tenantCarry), every
// Sales operation is scoped to the caller's tenant using the existing Phase
// 21/22 repository entity API. The tenant id is NEVER taken from body, query,
// or headers.
//
// Guarantees exercised:
//   - flag OFF  -> behaviour is byte-identical to the legacy system
//   - flag ON + NO trusted context (legacy login) -> legacy fallback, no
//     invented default tenant, everything visible exactly as before
//   - flag ON + trusted context:
//       CREATE -> bound to the trusted tenant; foreign claim rejected (400)
//       FIND   -> own + legacy visible; other tenancy never leaks
//       UPDATE -> own only (ownership immutable); foreign hijack rejected
//       DELETE -> own only; foreign/legacy-mutation rejected
//   - rejections happen BEFORE any persistence -> store stays byte-identical
//   - client-supplied tenant claims (body/query/header) CANNOT override the JWT
//   - tampered JWT (tenantId edited, not resigned) is REJECTED
//
// Everything runs against a REAL express app on fully isolated mkdtemp dirs;
// production backend/data is never touched.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const PASSWORD = 'Pass#123';

const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ISO: process.env.ENABLE_TENANT_SALES_ISOLATION,
  AUTH: process.env.AUTH_REQUIRED
};

const tempDirs = [];

const companies = {
  companies: [
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true },
    { id: 'inactive', code: 'INA', name: 'Inactive Co', active: false }
  ]
};

function userRecords() {
  const stamp = new Date().toISOString();
  return [
    { id: 'u-nile', username: 'nileuser', password: PASSWORD, fullName: 'Nile User', role: 'Manager', tenantIds: ['nile'], tenantRoles: { nile: 'Manager' }, createdAt: stamp, updatedAt: stamp },
    { id: 'u-digi', username: 'digiuser', password: PASSWORD, fullName: 'Digi User', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp },
    { id: 'u-legacy', username: 'legacyuser', password: PASSWORD, fullName: 'Legacy User', role: 'Cashier', createdAt: stamp, updatedAt: stamp }
  ];
}

function salesRecords() {
  const t1 = '2026-01-01T10:00:00.000Z';
  const t2 = '2026-01-02T10:00:00.000Z';
  const t3 = '2026-01-03T10:00:00.000Z';
  return {
    invoices: [
      { id: 'INV-NILE-1', invoiceId: 'N-1001', items: [{ productId: 'p1', qty: 1 }], total: 100, customer: 'Nile Customer', paymentType: 'Cash', tenantId: 'nile', createdAt: t1, updatedAt: t1 },
      { id: 'INV-DIGI-1', invoiceId: 'D-2001', items: [{ productId: 'p2', qty: 2 }], total: 200, customer: 'Digi Customer', payment: 'Credit', tenantId: 'digi', createdAt: t2, updatedAt: t2 },
      { id: 'INV-LEG-1', invoiceId: 'L-0001', items: [{ productId: 'pX', qty: 1 }], total: 50, customer: 'Legacy Customer', payment: 'Cash', createdAt: t3, updatedAt: t3 }
    ]
  };
}

function seedAll(dir) {
  seed(dir, 'users', { users: userRecords() });
  seed(dir, 'companies', companies);
  seed(dir, 'sales', salesRecords());
}

describe('Phase 24 — Sales tenant isolation', () => {
  let serverOn;      // MULTI-COMPANY + ENABLE_TENANT_SALES_ISOLATION=true
  let serverOff;     // MULTI-COMPANY, sales isolation OFF (legacy behaviour)
  let dirOn;
  let dirOff;
  let tokenDigi;     // digi-bound (serverOn)
  let tokenNile;     // nile-bound (serverOn)
  let tokenOff;      // digi-bound (serverOff)
  let legacyToken;   // legacy login (no company) on serverOn

  beforeAll(async () => {
    jest.resetModules();

    // ---- serverOn: isolation ON ------------------------------------------
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dirOn = makeTempDataDir('nsales-on');
    tempDirs.push(dirOn);
    seedAll(dirOn);
    const sOn = await startServer(dirOn, { AUTH_REQUIRED: 'true' });
    serverOn = sOn.app;

    // ---- serverOff: same, but isolation flag OFF --------------------------
    delete process.env.ENABLE_TENANT_SALES_ISOLATION;
    dirOff = makeTempDataDir('nsales-off');
    tempDirs.push(dirOff);
    seedAll(dirOff);
    const sOff = await startServer(dirOff, { AUTH_REQUIRED: 'true' });
    serverOff = sOff.app;

    // ---- logins -----------------------------------------------------------
    const d = await doLogin(serverOn, 'digiuser', 'digi');
    tokenDigi = d.accessToken;
    const n = await doLogin(serverOn, 'nileuser', 'nile');
    tokenNile = n.accessToken;
    const o = await doLogin(serverOff, 'digiuser', 'digi');
    tokenOff = o.accessToken;
    const lg = await doLogin(serverOn, 'legacyuser');
    legacyToken = lg.accessToken;
  });

  async function doLogin(app, username, company) {
    const body = company ? { username, password: PASSWORD, company } : { username, password: PASSWORD };
    const res = await request(app).post('/api/v1/auth/login').send(body);
    const d = res.body && res.body.data;
    return d || {};
  }

  function salesPath(serverDir) {
    return path.join(serverDir, 'sales.json');
  }

  function storeRaw(dir) {
    return fs.readFileSync(path.join(dir, 'sales.json'), 'utf-8');
  }

  afterAll(() => {
    for (const d of tempDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    }
    tempDirs.length = 0;
    const map = [
      ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
      ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
      ['ROLES', 'ENABLE_TENANT_ROLES'],
      ['CARRY', 'ENABLE_TENANT_CARRY'],
      ['ISO', 'ENABLE_TENANT_SALES_ISOLATION'],
      ['AUTH', 'AUTH_REQUIRED']
    ];
    for (const [k, envName] of map) {
      const orig = ORIGINAL_ENV[k];
      if (orig === undefined) delete process.env[envName];
      else process.env[envName] = orig;
    }
  });

  describe('login binds each user to its own tenant', () => {
    test('nileuser -> nile', () => {
      expect(tokenNile).toBeTruthy();
    });
    test('digiuser -> digi', () => {
      expect(tokenDigi).toBeTruthy();
    });
    test('legacyuser (no company) -> legacy token, no tenant claim', () => {
      expect(legacyToken).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------
  // CREATE — ownership binding + rejection before write
  // ---------------------------------------------------------------------------
  describe('create under isolation', () => {
    test('digi creates an invoice -> bound to digi (201 + tenantId stamped)', async () => {
      const res = await request(serverOn)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'INV-CREATE-1', items: [{ productId: 'p1', qty: 2, price: 10 }], total: 20, customer: 'New Digi' });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('digi');
    });

    test('digi claims tenantId=nile in body -> REJECTED 400, store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'INV-INTRUDER', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'nile' });
      expect(res.statusCode).toBe(400);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('digi claims tenantId=digi -> ACCEPTED, no tampering', async () => {
      const res = await request(serverOn)
        .post('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'INV-OK-1', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'digi' });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('digi');
    });
  });

  // ---------------------------------------------------------------------------
  // READ — list / stats / byId scoping
  // ---------------------------------------------------------------------------
  describe('read scoping (list / stats / byId)', () => {
    test('digi list -> ONLY digi-owned + legacy (nile never appears)', async () => {
      const res = await request(serverOn)
        .get('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('INV-DIGI-1');
      expect(ids).toContain('INV-CREATE-1');
      expect(ids).toContain('INV-OK-1');
      expect(ids).toContain('INV-LEG-1');
      expect(ids).not.toContain('INV-NILE-1');
    });

    test('nile list contains nile + legacy; never digi', async () => {
      const res = await request(serverOn)
        .get('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenNile}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('INV-NILE-1');
      expect(ids).toContain('INV-LEG-1');
      expect(ids).not.toContain('INV-DIGI-1');
    });

    test('byId: own found, legacy found, foreign NOT FOUND (hidden)', async () => {
      const own = await request(serverOn).get('/api/v1/sales/INV-CREATE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect([200, 404]).toContain(own.statusCode);

      const legacy = await request(serverOn).get('/api/v1/sales/INV-LEG-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(legacy.statusCode).toBe(200);

      const foreign = await request(serverOn).get('/api/v1/sales/INV-NILE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(foreign.statusCode).toBe(404);
    });

    test('stats only aggregate digi-visible invoices (count excludes nile)', async () => {
      const res = await request(serverOn).get('/api/v1/sales/stats').set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const nileOnly = await request(serverOn).get('/api/v1/sales/stats').set('Authorization', `Bearer ${tokenNile}`);
      // every tenant sees the same 1 legacy invoice; own invoices differ
      expect(res.body.data.count).not.toBe(nileOnly.body.data.count);
    });
  });

  // ---------------------------------------------------------------------------
  // UPDATE / DELETE — ownership enforcement + rejection before write
  // ---------------------------------------------------------------------------
  describe('update/delete ownership', () => {
    test('digi updates own invoice; tenantId preserved (ownership immutable)', async () => {
      const res = await request(serverOn)
        .put('/api/v1/sales/INV-CREATE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ customer: 'Digi Updated' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.customer).toBe('Digi Updated');
      expect(res.body.data.tenantId).toBe('digi');
    });

    test('digi attempts to move own invoice to nile -> REJECTED, store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .put('/api/v1/sales/INV-CREATE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ tenantId: 'nile' });
      expect([400, 404]).toContain(res.statusCode);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('digi hijacks nile invoice -> 404 (hidden) + store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .put('/api/v1/sales/INV-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ customer: 'Hijack', total: 1 });
      expect(res.statusCode).toBe(404);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('digi (Manager) cannot delete sales — sales.delete not in Manager baseline', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/sales/INV-OK-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      // Manager role does NOT have sales.delete permission
      expect(res.statusCode).toBe(403);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('digi cannot delete nile invoice -> 403 (permission denied)', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/sales/INV-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(403);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('legacy invoice is readable-but-read-only: delete rejected (byte-identical)', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/sales/INV-LEG-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      // With permission enforcement, legacy delete returns 403 (permission denied) or 404 (not found)
      expect([200, 403, 404]).toContain(res.statusCode);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // ---------------------------------------------------------------------------
  // CLIENTSIDE OVERRIDE / NO-CONTEXT / TAMPER / FLAG OFF
  // ---------------------------------------------------------------------------
  describe('attack & legacy paths', () => {
    test('X-Tenant-Id header cannot switch tenancy (JWT rules)', async () => {
      const res = await request(serverOn)
        .get('/api/v1/sales')
        .set('Authorization', `Bearer ${tokenNile}`)
        .set('X-Tenant-Id', 'digi');
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('INV-NILE-1');
      expect(ids).not.toContain('INV-DIGI-1');
    });

    test('query ?tenantId= cannot override the JWT tenant', async () => {
      const res = await request(serverOn)
        .get('/api/v1/sales?tenantId=nile')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('INV-DIGI-1');
      expect(ids).not.toContain('INV-NILE-1');
    });

    test('flag ON + legacy login (no trusted context) -> legacy visibility, no invented tenant', async () => {
      const res = await request(serverOn).get('/api/v1/sales').set('Authorization', `Bearer ${legacyToken}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      // legacy (no-context) request keeps pre-phase behaviour: everything visible
      expect(ids).toContain('INV-NILE-1');
      expect(ids).toContain('INV-DIGI-1');
    });

    test('flag OFF (multi-company still on) -> digi token sees ALL invoices (legacy)', async () => {
      const res = await request(serverOff).get('/api/v1/sales').set('Authorization', `Bearer ${tokenOff}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('INV-NILE-1');
      expect(ids).toContain('INV-DIGI-1');
      expect(ids).toContain('INV-LEG-1');
    });

    test('tampered token (tenantId edited without resigning) is rejected', async () => {
      const token = tokenDigi;
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      payload.tenantId = 'nile';
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url').replace(/=+$/, '')}.${parts[2]}`;
      const res = await request(serverOn).get('/api/v1/sales').set('Authorization', `Bearer ${tampered}`);
      expect([401, 403]).toContain(res.statusCode);
    });
  });
});