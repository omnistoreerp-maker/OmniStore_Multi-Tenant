'use strict';

// PHASE 25 — TENANT-SCOPED BUSINESS DATA ISOLATION (PURCHASES ONLY).
//
// PURCHASES is the second pilot business domain (after Sales, Phase 24) for
// real multi-tenant isolation: when ENABLE_TENANT_PURCHASES_ISOLATION=true and
// a TRUSTED tenant context is carried (req.tenantContext, re-built from the
// signed JWT claim by tenantCarry), every Purchases operation is scoped to the
// caller's tenant using the existing Phase 21/22 repository entity API. The
// tenant id is NEVER taken from body, query, or headers.
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
//   - stats/totals are tenant-scoped
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
  ISO: process.env.ENABLE_TENANT_PURCHASES_ISOLATION,
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

function purchaseRecords() {
  const t1 = '2026-02-01T10:00:00.000Z';
  const t2 = '2026-02-02T10:00:00.000Z';
  const t3 = '2026-02-03T10:00:00.000Z';
  return {
    invoices: [
      { id: 'PO-NILE-1', invoiceId: 'N-2001', items: [{ productId: 'p1', qty: 1 }], total: 100, supplier: 'Nile Supplier', paymentType: 'Cash', tenantId: 'nile', createdAt: t1, updatedAt: t1 },
      { id: 'PO-DIGI-1', invoiceId: 'D-3001', items: [{ productId: 'p2', qty: 2 }], total: 200, supplier: 'Digi Supplier', payment: 'Credit', tenantId: 'digi', createdAt: t2, updatedAt: t2 },
      { id: 'PO-LEG-1', invoiceId: 'L-0002', items: [{ productId: 'pX', qty: 1 }], total: 50, supplier: 'Legacy Supplier', payment: 'Cash', createdAt: t3, updatedAt: t3 }
    ]
  };
}

function seedAll(dir) {
  seed(dir, 'users', { users: userRecords() });
  seed(dir, 'companies', companies);
  seed(dir, 'purchases', purchaseRecords());
}

describe('Phase 25 — Purchases tenant isolation', () => {
  let serverOn;      // MULTI-COMPANY + ENABLE_TENANT_PURCHASES_ISOLATION=true
  let serverOff;     // MULTI-COMPANY, purchases isolation OFF (legacy behaviour)
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
    process.env.ENABLE_TENANT_PURCHASES_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dirOn = makeTempDataDir('npurc-on');
    tempDirs.push(dirOn);
    seedAll(dirOn);
    const sOn = await startServer(dirOn, { AUTH_REQUIRED: 'true' });
    serverOn = sOn.app;

    // ---- serverOff: same, but isolation flag OFF --------------------------
    delete process.env.ENABLE_TENANT_PURCHASES_ISOLATION;
    dirOff = makeTempDataDir('npurc-off');
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

  function storeRaw(dir) {
    return fs.readFileSync(path.join(dir, 'purchases.json'), 'utf-8');
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
      ['ISO', 'ENABLE_TENANT_PURCHASES_ISOLATION'],
      ['AUTH', 'AUTH_REQUIRED']
    ];
    for (const [k, envName] of map) {
      const orig = ORIGINAL_ENV[k];
      if (orig === undefined) delete process.env[envName];
      else process.env[envName] = orig;
    }
  });

  // -------------------------------------------------------------------------
  // 1/2/3 — CREATE ownership binding + rejection before write
  // -------------------------------------------------------------------------
  describe('create under isolation', () => {
    test('1. digi creates a Purchase without tenantId -> bound to digi (201 + tenantId)', async () => {
      const res = await request(serverOn)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PO-CREATE-1', items: [{ productId: 'p1', qty: 2, price: 10 }], total: 20, supplier: 'New Digi Supp' });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('digi');
    });

    test('2. digi claims tenantId=digi -> ACCEPTED, no tampering', async () => {
      const res = await request(serverOn)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PO-OK-1', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'digi', supplier: 'S' });
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('digi');
    });

    test('3. digi claims tenantId=nile in body -> REJECTED 400, store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PO-INTRUDER', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'nile', supplier: 'S' });
      expect(res.statusCode).toBe(400);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 4/5/6/7/8/9 — READ scoping
  // -------------------------------------------------------------------------
  describe('read scoping (list / byId)', () => {
    test('4. digi list -> ONLY digi-owned + legacy (nile never appears)', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-DIGI-1');
      expect(ids).toContain('PO-CREATE-1');
      expect(ids).toContain('PO-OK-1');
      expect(ids).toContain('PO-LEG-1');
      expect(ids).not.toContain('PO-NILE-1');
    });

    test('5. nile list -> ONLY nile + legacy; never digi', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenNile}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-NILE-1');
      expect(ids).toContain('PO-LEG-1');
      expect(ids).not.toContain('PO-DIGI-1');
    });

    test('6. digi list never contains nile-owned record', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).not.toContain('PO-NILE-1');
    });

    test('7. nile list never contains digi-owned record', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenNile}`);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).not.toContain('PO-DIGI-1');
    });

    test('8. digi gets OWN purchase by id (200)', async () => {
      const res = await request(serverOn).get('/api/v1/purchases/PO-CREATE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
    });

    test('9. digi cannot GET nile purchase by id (404 hidden)', async () => {
      const res = await request(serverOn).get('/api/v1/purchases/PO-NILE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 10/11/12/13 — UPDATE ownership
  // -------------------------------------------------------------------------
  describe('update ownership', () => {
    test('10. digi updates OWN purchase; tenantId preserved', async () => {
      const res = await request(serverOn)
        .put('/api/v1/purchases/PO-CREATE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ supplier: 'Digi Updated Supp' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.supplier).toBe('Digi Updated Supp');
      expect(res.body.data.tenantId).toBe('digi');
    });

    test('11. digi hijacks nile purchase -> 404 (hidden) + store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .put('/api/v1/purchases/PO-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ supplier: 'Hijack', total: 1 });
      expect(res.statusCode).toBe(404);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('12. ownership transfer A->B in patch is REJECTED, store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .put('/api/v1/purchases/PO-CREATE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ tenantId: 'nile' });
      expect([400, 404]).toContain(res.statusCode);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('13. patch with tenantId=digi leaves ownership unchanged (immutable)', async () => {
      const res = await request(serverOn)
        .put('/api/v1/purchases/PO-CREATE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ tenantId: 'digi', supplier: 'Still Digi' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.tenantId).toBe('digi');
    });
  });

  // -------------------------------------------------------------------------
  // 14/15/17 — DELETE ownership
  // -------------------------------------------------------------------------
  describe('delete ownership', () => {
    test('14. digi deletes OWN purchase -> 200 persisted', async () => {
      const res = await request(serverOn)
        .delete('/api/v1/purchases/PO-OK-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const raw = JSON.parse(storeRaw(dirOn));
      expect(raw.invoices.some(i => i.id === 'PO-OK-1')).toBe(false);
    });

    test('15. digi deletes nile purchase -> 404 (hidden) + store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/purchases/PO-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(404);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 16/17/18 — byte-identity of rejected ops (already partly covered; explicit)
  // -------------------------------------------------------------------------
  describe('byte-identical rejection guarantees', () => {
    test('16. rejected foreign UPDATE leaves store byte-identical (re-check after hijack)', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .put('/api/v1/purchases/PO-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ supplier: 'Hijack v2' });
      expect(res.statusCode).toBe(404);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('17. rejected foreign DELETE leaves store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/purchases/PO-NILE-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(404);
      expect(storeRaw(dirOn)).toBe(before);
    });

    test('18. rejected foreign CREATE leaves store byte-identical', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PO-SPOOF', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'nile', supplier: 'S' });
      expect(res.statusCode).toBe(400);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 19 — legacy behavior
  // -------------------------------------------------------------------------
  describe('legacy purchase behavior', () => {
    test('19. legacy (no tenantId) purchase is visible to a tenant but NOT deletable (read-only)', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .delete('/api/v1/purchases/PO-LEG-1')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect([200, 404]).toContain(res.statusCode);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 20/21 — backward compatibility
  // -------------------------------------------------------------------------
  describe('backward compatibility', () => {
    test('20. flag OFF -> digi token sees ALL purchases (legacy)', async () => {
      const res = await request(serverOff).get('/api/v1/purchases').set('Authorization', `Bearer ${tokenOff}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-NILE-1');
      expect(ids).toContain('PO-DIGI-1');
      expect(ids).toContain('PO-LEG-1');
    });

    test('21. flag ON + legacy login (no trusted context) -> legacy visibility, no invented tenant', async () => {
      const res = await request(serverOn).get('/api/v1/purchases').set('Authorization', `Bearer ${legacyToken}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-NILE-1');
      expect(ids).toContain('PO-DIGI-1');
    });
  });

  // -------------------------------------------------------------------------
  // 22/23/24/25 — client-supplied claims cannot override the trusted context
  // -------------------------------------------------------------------------
  describe('client-supplied tenant claims cannot override JWT', () => {
    test('22. X-Tenant-Id header cannot switch tenancy', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenNile}`)
        .set('X-Tenant-Id', 'digi');
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-NILE-1');
      expect(ids).not.toContain('PO-DIGI-1');
    });

    test('23. X-Company-Id header cannot switch tenancy', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .set('X-Company-Id', 'nile');
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-DIGI-1');
      expect(ids).not.toContain('PO-NILE-1');
    });

    test('24. query ?tenantId= cannot override the JWT tenant', async () => {
      const res = await request(serverOn)
        .get('/api/v1/purchases?tenantId=nile')
        .set('Authorization', `Bearer ${tokenDigi}`);
      expect(res.statusCode).toBe(200);
      const ids = (res.body.data.invoices || []).map(i => i.id);
      expect(ids).toContain('PO-DIGI-1');
      expect(ids).not.toContain('PO-NILE-1');
    });

    test('25. body.tenantId cannot override trusted context on create', async () => {
      const before = storeRaw(dirOn);
      const res = await request(serverOn)
        .post('/api/v1/purchases')
        .set('Authorization', `Bearer ${tokenDigi}`)
        .send({ id: 'PO-BODY-OVERRIDE', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'nile', supplier: 'S' });
      expect(res.statusCode).toBe(400);
      expect(storeRaw(dirOn)).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 26/27 — tampered token / claim-context mismatch
  // -------------------------------------------------------------------------
  describe('tamper & escalation', () => {
    test('26. tampered token (tenantId edited without resigning) is rejected', async () => {
      const token = tokenDigi;
      const parts = token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      payload.tenantId = 'nile';
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url').replace(/=+$/, '')}.${parts[2]}`;
      const res = await request(serverOn).get('/api/v1/purchases').set('Authorization', `Bearer ${tampered}`);
      expect([401, 403]).toContain(res.statusCode);
    });

    test('27. claim/context mismatch cannot escalate: accessor is the single source', async () => {
      // nile-owned record never visible/writable/deletable under digi context
      const vis = await request(serverOn).get('/api/v1/purchases/PO-NILE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(vis.statusCode).toBe(404);
      const upd = await request(serverOn).put('/api/v1/purchases/PO-NILE-1').set('Authorization', `Bearer ${tokenDigi}`).send({ total: 1 });
      expect(upd.statusCode).toBe(404);
      const del = await request(serverOn).delete('/api/v1/purchases/PO-NILE-1').set('Authorization', `Bearer ${tokenDigi}`);
      expect(del.statusCode).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 28/29 — stats / totals tenant-scoped
  // -------------------------------------------------------------------------
  describe('stats/totals tenant scoping', () => {
    test('28. stats count is tenant-scoped (digi != nile totals)', async () => {
      const digi = await request(serverOn).get('/api/v1/purchases/stats').set('Authorization', `Bearer ${tokenDigi}`);
      const nile = await request(serverOn).get('/api/v1/purchases/stats').set('Authorization', `Bearer ${tokenNile}`);
      expect(digi.statusCode).toBe(200);
      expect(nile.statusCode).toBe(200);
      // every tenant shares exactly the 1 legacy purchase; owned records differ
      expect(digi.body.data.count).not.toBe(nile.body.data.count);
    });

    test('29. totals exclude foreign-tenant amounts (digi never sees nile total)', async () => {
      const digi = await request(serverOn).get('/api/v1/purchases/stats').set('Authorization', `Bearer ${tokenDigi}`);
      const nile = await request(serverOn).get('/api/v1/purchases/stats').set('Authorization', `Bearer ${tokenNile}`);
      expect(digi.body.data.totalPurchases).not.toBe(nile.body.data.totalPurchases);
    });
  });
});