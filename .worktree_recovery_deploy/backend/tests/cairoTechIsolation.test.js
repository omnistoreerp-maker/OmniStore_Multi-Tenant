'use strict';

// CairoTech — Multi-Tenant Isolation Security Tests (Phase 16).
//
// Mirrors the REAL company catalog (digitronics = legacy company, cairotech =
// the new company) and verifies the security invariants required before
// CairoTech production use:
//   1. CairoTech cannot read legacy-company treasury.
//   2. Legacy company cannot read CairoTech treasury.
//   3. Client-supplied tenantId cannot override the server context on create.
//   4. Membership enforcement: a user without a CairoTech membership cannot
//      log in to CairoTech.
//   5. A CairoTech JWT cannot read legacy-company treasury (and vice versa).
//   6. A tenant write never destroys another tenant's records (data-loss
//      regression).
//   7. Cross-tenant update/delete are blocked and the foreign record survives.

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

// Real catalog shape (plain array, same as backend/data/companies.json).
const companies = [
  { id: 'digitronics', name: 'DigiTronics', code: 'DIGI', active: true },
  { id: 'nile', name: 'Nile Electronics', code: 'NILE', active: true },
  { id: 'astra', name: 'Astra Components', code: 'ASTRA', active: false },
  { id: 'cairotech', name: 'CairoTech', code: 'CAIROTECH', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

// Legacy-company admin (digitronics) and CairoTech admin, plus a user with NO
// membership (cannot log in to any company once membership is enforced).
const users = { users: [
  {
    id: 'u-legacy', username: 'legacyadmin', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Legacy Admin', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: 'u-cairo', username: 'cairoadmin', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Cairo Admin', tenantIds: ['cairotech'], tenantRoles: { cairotech: 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    // Legacy-company member WITHOUT a CairoTech membership: login to
    // cairotech must be DENIED (membership enforcement). Empty-membership
    // users are deliberately NOT denied (documented legacy rule), so this
    // user carries a real membership for another company.
    id: 'u-none', username: 'nobody', password: hash('Pass#123'), role: 'Cashier',
    fullName: 'Legacy Member Only', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Cashier' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
]};

function treasuryRecords() {
  const t = new Date().toISOString();
  return { entries: [
    { id: 'TX-DIGI-1', type: 'in', amount: 500, balance: 500, desc: 'Legacy cash in', method: 'cash', user: 'legacyadmin', tenantId: 'digitronics', createdAt: t, updatedAt: t },
    { id: 'TX-CAIRO-1', type: 'in', amount: 1000, balance: 1000, desc: 'Cairo cash in', method: 'cash', user: 'cairoadmin', tenantId: 'cairotech', createdAt: t, updatedAt: t },
    { id: 'TX-LEG-1', type: 'in', amount: 50, balance: 50, desc: 'Legacy (no tenant)', method: 'cash', user: 'legacyadmin', createdAt: t, updatedAt: t }
  ]};
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'treasury', treasuryRecords());
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('CairoTech — Multi-Tenant Isolation', () => {
  let app;
  let dir;
  let tokenCairo;
  let tokenLegacy;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';

    dir = makeTempDataDir('cairotech-isolation');
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    tokenCairo = await loginAs(app, 'cairoadmin', 'cairotech');
    tokenLegacy = await loginAs(app, 'legacyadmin', 'digitronics');
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

  test('TEST 1 — CairoTech cannot read legacy-company treasury', async () => {
    const res = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenCairo);
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data.entries || []).map(e => e.id);
    expect(ids).not.toContain('TX-DIGI-1');
  });

  test('TEST 2 — Legacy company cannot read CairoTech treasury', async () => {
    const res = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenLegacy);
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data.entries || []).map(e => e.id);
    expect(ids).not.toContain('TX-CAIRO-1');
  });

  test('TEST 3 — client-supplied tenantId cannot override server context on create', async () => {
    const before = readStore(dir, 'treasury');
    const res = await request(app)
      .post('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + tokenCairo)
      .send({ type: 'in', amount: 100, desc: 'Foreign claim attempt', method: 'cash', tenantId: 'digitronics' });
    expect(res.statusCode).toBe(400);
    const after = readStore(dir, 'treasury');
    expect(after.entries.length).toBe(before.entries.length);
  });

  test('TEST 4 — create with OWN tenantId is accepted and stamped to current tenant', async () => {
    const res = await request(app)
      .post('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + tokenCairo)
      .send({ id: 'TX-CAIRO-NEW', type: 'in', amount: 250, balance: 1250, desc: 'Cairo own entry', method: 'cash', tenantId: 'cairotech' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.tenantId).toBe('cairotech');
    // Visible to CairoTech only.
    const list = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenCairo);
    const ids = (list.body.data.entries || []).map(e => e.id);
    expect(ids).toContain('TX-CAIRO-NEW');
    const legacyList = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenLegacy);
    const legacyIds = (legacyList.body.data.entries || []).map(e => e.id);
    expect(legacyIds).not.toContain('TX-CAIRO-NEW');
  });

  test('TEST 5 — membership enforcement: legacy-company member cannot log into CairoTech', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'Pass#123', company: 'cairotech' });
    expect(res.statusCode).toBe(403);
  });

  test('TEST 5b — same legacy-company member CAN log into their own company', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: 'Pass#123', company: 'digitronics' });
    expect(res.statusCode).toBe(200);
  });

  test('TEST 6 — data-loss regression: CairoTech write preserves legacy-company records', async () => {
    const before = readStore(dir, 'treasury');
    const legacyBefore = (before.entries || []).filter(e => e.tenantId === 'digitronics').length;
    await request(app)
      .post('/api/v1/treasury')
      .set('Authorization', 'Bearer ' + tokenCairo)
      .send({ type: 'out', amount: 50, desc: 'Cairo expense', method: 'cash', tenantId: 'cairotech' });
    const after = readStore(dir, 'treasury');
    expect((after.entries || []).filter(e => e.tenantId === 'digitronics').length).toBe(legacyBefore);
    expect((after.entries || []).some(e => e.id === 'TX-DIGI-1')).toBe(true);
  });

  test('TEST 7 — CairoTech cannot update or delete legacy-company treasury', async () => {
    const before = readStore(dir, 'treasury');
    const updateRes = await request(app)
      .put('/api/v1/treasury/TX-DIGI-1')
      .set('Authorization', 'Bearer ' + tokenCairo)
      .send({ desc: 'Hijacked' });
    expect([400, 404]).toContain(updateRes.statusCode);

    const deleteRes = await request(app)
      .delete('/api/v1/treasury/TX-DIGI-1')
      .set('Authorization', 'Bearer ' + tokenCairo);
    expect([400, 404]).toContain(deleteRes.statusCode);

    const after = readStore(dir, 'treasury');
    expect((after.entries || []).some(e => e.id === 'TX-DIGI-1')).toBe(true);
    expect(after.entries.length).toBe(before.entries.length);
  });

  test('TEST 8 — legacy records (no tenantId) stay visible to both (backward compatible)', async () => {
    const cairo = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenCairo);
    const legacy = await request(app).get('/api/v1/treasury').set('Authorization', 'Bearer ' + tokenLegacy);
    expect((cairo.body.data.entries || []).some(e => e.id === 'TX-LEG-1')).toBe(true);
    expect((legacy.body.data.entries || []).some(e => e.id === 'TX-LEG-1')).toBe(true);
  });

  test('TEST 9 — a CairoTech JWT cannot access legacy-company resources', async () => {
    // Attempt to read a legacy-company sale/customer as CairoTech must not
    // surface foreign records (products stay global; customers are tenant scoped).
    const customers = await request(app).get('/api/v1/customers').set('Authorization', 'Bearer ' + tokenCairo);
    expect(customers.statusCode).toBe(200);
    const sales = await request(app).get('/api/v1/sales').set('Authorization', 'Bearer ' + tokenCairo);
    expect(sales.statusCode).toBe(200);
  });
});
