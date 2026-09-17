'use strict';

// REAL MULTI-COMPANY GO-LIVE VALIDATION (Phase 24 â€” validation only).
//
// Boots a REAL express server against a fully isolated temporary data
// directory, with every tenant feature enabled, and validates the actual
// business requirement: multiple companies on ONE installation, each logging
// in separately, each operating its own tenant-owned data, with no cross-
// tenant access.
//
// This phase adds NO architecture. It only exercises what already exists:
//   - multi-company catalog (companies.json) + dynamic active filtering
//   - login -> companyContext -> membership -> tenantRole -> tenantCarry -> JWT
//   - compartmentalized effective-role authorization (Phase 20)
//   - repository entity isolation (Phase 21/22)
//   - legacy fallback (no tenant / unknown / inactive company)
//   - token integrity (tampering rejection)
//
// Production data (backend/data) is NEVER touched: everything runs against
// mkdtemp directories that are removed in afterAll.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const PASSWORD = 'Pass#123';

const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ISO: process.env.ENABLE_TENANT_ENTITY_ISOLATION,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const tempDirs = [];

// 2. Real production-like catalog (5 active/inactive companies; MUST scale to
// 3 / 15 / 50 without code changes).
const companies = [
  { id: 'digitronics', code: 'DIGI', name: 'DigiTronics', active: true },
  { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true },
  { id: 'omni', code: 'OMNI', name: 'Omni Components', active: true },
  { id: 'astra', code: 'ASTRA', name: 'Astra Components', active: false },
  { id: 'galaxy', code: 'GALX', name: 'Galaxy Systems', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-a', username: 'companyA', password, fullName: 'Company A', role: 'Manager',
      tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Admin' }, createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-b', username: 'companyB', password, fullName: 'Company B', role: 'Manager',
      tenantIds: ['nile'], tenantRoles: { nile: 'Admin' }, createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-ab', username: 'multiUser', password, fullName: 'Multi User A/B', role: 'Manager',
      tenantIds: ['digitronics', 'nile'], tenantRoles: { digitronics: 'Admin', nile: 'Manager' },
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-legacy', username: 'legacyUser', password, fullName: 'Legacy User', role: 'Admin',
      createdAt: stamp, updatedAt: stamp
    }
  ];
}

// Seed the company "customers" store with tenant-owned + legacy data so the
// entity-layer isolation checks have real, distinct records per tenant.
function seedCustomerRecords(dir) {
  seed(dir, 'customers', {
    customers: [
      { id: 'c-digit-1', name: 'Digit Co', tenantId: 'digitronics' },
      { id: 'c-nile-1', name: 'Nile Co', tenantId: 'nile' },
      { id: 'c-legacy-1', name: 'Legacy Co' }
    ]
  });
}

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return require('../utils/jwt');
}

function freshRepo(storeName, accessor) {
  jest.resetModules();
  const BaseRepository = require('../repositories/BaseRepository');
  return new BaseRepository(storeName, accessor);
}

describe('Real Multi-Company Go-Live Validation (isolated, full flags)', () => {
  let app;
  let dir;
  let jwt;
  let login;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    dir = makeTempDataDir('golive');
    tempDirs.push(dir);
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync(PASSWORD, 10)) });
    seedCustomerRecords(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    jwt = jwtFor();

    login = async (username, company) => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send(company ? { username, password: PASSWORD, company } : { username, password: PASSWORD });
      const d = res.body && res.body.data;
      let tenant;
      try { tenant = d && d.accessToken ? jwt.verifyAccessToken(d.accessToken).tenantId : undefined; } catch (e) {}
      return { status: res.statusCode, body: res.body, accessToken: d ? d.accessToken : undefined, refreshToken: d ? d.refreshToken : undefined, tenantId: tenant };
    };
  });

  afterAll(() => {
    for (const d of tempDirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    }
    tempDirs.length = 0;
    const mapping = {
      ENABLE_MULTI_COMPANY_LOGIN: 'MC',
      ENABLE_TENANT_USER_MEMBERSHIP: 'MEM',
      ENABLE_TENANT_ROLES: 'ROLES',
      ENABLE_TENANT_CARRY: 'CARRY',
      ENABLE_TENANT_ENTITY_ISOLATION: 'ISO',
      AUTH_REQUIRED: 'AUTH',
      DIGITRONICS_DATA_DIR: 'DATA'
    };
    for (const [envKey, origKey] of Object.entries(mapping)) {
      const orig = ORIGINAL_ENV[origKey];
      if (orig === undefined) delete process.env[envKey];
      else process.env[envKey] = orig;
    }
  });

  // -------------------------------------------------------------------------
  // 4/5/6/7 â€” LOGIN MATRIX
  // -------------------------------------------------------------------------
  describe('login matrix', () => {
    test('companyA + digitronics -> 200, tenant=digitronics, role=Admin', async () => {
      const r = await login('companyA', 'digitronics');
      expect(r.status).toBe(200);
      expect(r.accessToken).toBeTruthy();
      expect(r.refreshToken).toBeTruthy();
      expect(r.tenantId).toBe('digitronics');
      expect(r.body.data.effectiveRole).toBe('Admin');
    });

    test('companyA + nile -> 403, NO tokens (membership preserved)', async () => {
      const r = await login('companyA', 'nile');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeUndefined();
      expect(r.refreshToken).toBeUndefined();
    });

    test('companyB + nile -> 200, tenantId=nile, role=Admin', async () => {
      const r = await login('companyB', 'nile');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBe('nile');
      expect(r.body.data.effectiveRole).toBe('Admin');
    });

    test('multiUser + digitronics -> 200, role=Admin', async () => {
      const r = await login('multiUser', 'digitronics');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBe('digitronics');
      expect(r.body.data.effectiveRole).toBe('Admin');
    });

    test('multiUser + nile -> 200, role=Manager (tenant switch changes role)', async () => {
      const r = await login('multiUser', 'nile');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBe('nile');
      expect(r.body.data.effectiveRole).toBe('Manager');
    });

    test('legacyUser + digitronics -> legacy login (ENSURE no invented membership)', async () => {
      const r = await login('legacyUser', 'digitronics');
      expect(r.status).toBe(200);
      expect(r.accessToken).toBeTruthy();
      expect(r.tenantId).toBe('digitronics');
      expect(r.body.data.effectiveRole).toBe('Admin'); // global role fallback
    });

    test('legacyUser + nile -> backward-compatible legacy login (no forced membership)', async () => {
      const r = await login('legacyUser', 'nile');
      expect(r.status).toBe(200);
      expect(r.accessToken).toBeTruthy();
      expect(r.tenantId).toBe('nile'); // valid active company -> carried tenant, no 403
      expect(r.body.data.effectiveRole).toBe('Admin'); // global role fallback inside tenant
    });

    test('auth/me works for a bound tenant login', async () => {
      const r = await login('companyA', 'digitronics');
      const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${r.accessToken}`);
      expect(me.statusCode).toBe(200);
      expect(me.body.data.user.username).toBe('companyA');
    });
  });

  // -------------------------------------------------------------------------
  // 17/18 â€” INACTIVE / UNKNOWN COMPANY fallback (existing GoLive behavior)
  // -------------------------------------------------------------------------
  describe('fallback companies', () => {
    test('inactive company (astra) keeps existing GoLive fallback: legacy login, no tenant binding', async () => {
      const r = await login('companyA', 'astra');
      expect(r.status).toBe(200); // companyContext ignores inactive -> legacy login
      expect(r.tenantId).toBeUndefined();
      expect(r.accessToken).toBeTruthy();
    });

    test('unknown company (ghost) keeps existing GoLive fallback: legacy login, no tenant binding', async () => {
      const r = await login('companyA', 'ghost');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBeUndefined();
      expect(r.accessToken).toBeTruthy();
    });

    test('no company -> legacy login (no tenant binding, backward compatible)', async () => {
      const r = await login('multiUser');
      expect(r.status).toBe(200);
      expect(r.tenantId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // 8 â€” CROSS-TENANT EFFECTIVE AUTHORIZATION (tenant-scoped role switching)
  // -------------------------------------------------------------------------
  describe('cross-tenant effective authorization', () => {
    test('multiUser in nile (Manager) can write via /api/v1/users', async () => {
      const r = await login('multiUser', 'nile');
      const res = await request(app).post('/api/v1/users')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ username: 'made-by-manager', password: PASSWORD, role: 'Cashier' });
      expect(res.statusCode).toBe(201);
    });

    test('multiUser in digitronics (Admin) can write too', async () => {
      const r = await login('multiUser', 'digitronics');
      const res = await request(app).post('/api/v1/users')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ username: 'made-by-admin', password: PASSWORD, role: 'Cashier' });
      expect(res.statusCode).toBe(201);
    });

    test('companyA CANNOT access a nile-scoped write (nile login itself is 403)', async () => {
      const denied = await login('companyA', 'nile');
      expect(denied.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // 9â€“13 â€” TENANT ENTITY ISOLATION at the repository layer (Phase 21/22)
  // -------------------------------------------------------------------------
  describe('tenant entity isolation (repository entity API)', () => {
    const acc = (tenantId) => ({ getCurrentTenant: () => ({ tenantId }) });

    test('digitronics sees digitronics + legacy, NEVER nile (FIND)', () => {
      const repo = freshRepo('customers', acc('digitronics'));
      expect(repo.findEntity('customers', 'c-digit-1').name).toBe('Digit Co');
      expect(repo.findEntity('customers', 'c-legacy-1').name).toBe('Legacy Co'); // legacy visible
      expect(repo.findEntity('customers', 'c-nile-1')).toBeNull(); // never nile
    });

    test('nile sees nile + legacy, NEVER digitronics (FIND)', () => {
      const repo = freshRepo('customers', acc('nile'));
      expect(repo.findEntity('customers', 'c-nile-1').name).toBe('Nile Co');
      expect(repo.findEntity('customers', 'c-legacy-1').name).toBe('Legacy Co');
      expect(repo.findEntity('customers', 'c-digit-1')).toBeNull();
    });

    test('CREATE: no tenantId -> auto bound to current tenant', () => {
      const repo = freshRepo('customers', acc('digitronics'));
      const created = repo.createEntity('customers', { id: 'c-new', name: 'New Digit' });
      expect(created.tenantId).toBe('digitronics');
    });

    test('CREATE: tenantId=nile while in digitronics -> REJECTED, nothing written', () => {
      const before = fs.readFileSync(`${dir}/customers.json`, 'utf-8');
      const repo = freshRepo('customers', acc('digitronics'));
      const created = repo.createEntity('customers', { id: 'c-intruder', name: 'Intruder', tenantId: 'nile' });
      expect(created).toBeNull();
      expect(fs.readFileSync(`${dir}/customers.json`, 'utf-8')).toBe(before);
    });

    test('UPDATE: digit owns record ok; nile-owned reject + store unchanged', () => {
      const repoD = freshRepo('customers', acc('digitronics'));
      const updated = repoD.updateEntity('customers', 'c-digit-1', { name: 'Digit Co 2' });
      expect(updated.name).toBe('Digit Co 2');

      const before = fs.readFileSync(`${dir}/customers.json`, 'utf-8');
      const repoD2 = freshRepo('customers', acc('digitronics'));
      expect(repoD2.updateEntity('customers', 'c-nile-1', { name: 'Hijack' })).toBeNull();
      expect(fs.readFileSync(`${dir}/customers.json`, 'utf-8')).toBe(before);
    });

    test('DELETE: own ok true; nile-owned rejected false, store unchanged', () => {
      const repoD = freshRepo('customers', acc('digitronics'));
      const created = repoD.createEntity('customers', { id: 'c-del-1', name: 'ToDelete' });
      expect(created.tenantId).toBe('digitronics');
      expect(repoD.deleteEntity('customers', 'c-del-1')).toBe(true);

      const before = fs.readFileSync(`${dir}/customers.json`, 'utf-8');
      const repoD2 = freshRepo('customers', acc('digitronics'));
      expect(repoD2.deleteEntity('customers', 'c-nile-1')).toBe(false);
      expect(fs.readFileSync(`${dir}/customers.json`, 'utf-8')).toBe(before);
    });
  });

  // -------------------------------------------------------------------------
  // 14 â€” COMPANY SWITCHING (no stale tenant state)
  // -------------------------------------------------------------------------
  describe('company switch (logout -> login -> other company)', () => {
    test('multiUser: digitronics then logout then nile - each token bound to its own tenant', async () => {
      const first = await login('multiUser', 'digitronics');
      expect(first.tenantId).toBe('digitronics');
      await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${first.accessToken}`)
        .send({}).expect(200);
      const second = await login('multiUser', 'nile');
      expect(second.tenantId).toBe('nile'); // fresh binding, no stale digitronics
    });
  });

  // -------------------------------------------------------------------------
  // 15 â€” LEGACY TOKEN (no tenant claim) / 16 â€” TAMPER
  // -------------------------------------------------------------------------
  describe('token security', () => {
    test('legacy token WITHOUT tenantId authenticates and never invents a tenant', async () => {
      const legacy = jwt.verifyAccessToken(jwt.signAccessToken({ id: 'u-legacy', username: 'legacyUser', role: 'Admin' }));
      const me = await request(app).get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${jwt.signAccessToken({ id: 'u-legacy', username: 'legacyUser', role: 'Admin' })}`);
      expect(me.statusCode).toBe(200);
      expect(legacy.tenantId).toBeUndefined(); // no DEFAULT_TENANT substitution
    });

    test('tampered token (tenantId edited, not resigned) is REJECTED', () => {
      const valid = jwt.signAccessToken({ id: 'u-ab', username: 'multiUser', role: 'Manager', tenantId: 'digitronics' });
      const parts = valid.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      payload.tenantId = 'nile'; // tamper without resigning
      const tampered = `${parts[0]}.${Buffer.from(JSON.stringify(payload)).toString('base64url').replace(/=+$/, '')}.${parts[2]}`;
      expect(jwt.verifyAccessToken(tampered)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // 21 â€” BUSINESS MODULE SMOKE (regression detection, read-only)
  // -------------------------------------------------------------------------
  describe('business module smoke', () => {
    let token;
    beforeAll(async () => {
      const r = await login('multiUser', 'digitronics');
      token = r.accessToken;
    });

    const smoke = ['/api/v1/dashboard', '/api/v1/sales', '/api/v1/purchases', '/api/v1/inventory', '/api/v1/treasury', '/api/v1/reports', '/api/v1/users'];
    smoke.forEach(path => {
      test(`GET ${path} responds without server error`, async () => {
        const res = await request(app).get(path).set('Authorization', `Bearer ${token}`);
        expect(res.statusCode).toBeLessThan(500);
        expect(res.statusCode).toBeGreaterThanOrEqual(200);
      });
    });
  });
});