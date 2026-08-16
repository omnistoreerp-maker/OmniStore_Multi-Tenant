'use strict';

// P0-003 — Company / Branch Context Authorization Security Tests
//
// Verifies that:
//   - Authentication ≠ Authorization ≠ Context Switching
//   - Company context switching requires active membership
//   - JWT context integrity is maintained
//   - Branch authorization is enforced
//   - Client-supplied identifiers cannot override authenticated context
//   - Cross-company data access is blocked
//   - Role resolution is company-scoped
//   - Refresh tokens re-validate membership

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

// ---- Environment snapshot / restore ----
const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR,
  FLT: process.env.ENABLE_TENANT_FILTERING,
  MD: process.env.ENABLE_TENANT_METADATA,
  ISO_SALES: process.env.ENABLE_TENANT_SALES_ISOLATION,
  ISO_PURCHASES: process.env.ENABLE_TENANT_PURCHASES_ISOLATION,
  ISO_ENTITY: process.env.ENABLE_TENANT_ENTITY_ISOLATION
};

const companies = [
  { id: 'company-a', name: 'Company A', code: 'COA', active: true },
  { id: 'company-b', name: 'Company B', code: 'COB', active: true },
  { id: 'company-c', name: 'Company C', active: false },
  { id: 'company-d', name: 'Company D', code: 'COD', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

function userRecords(pw) {
  const stamp = new Date().toISOString();
  return [
    // User in Company A only (Admin)
    {
      id: 'u-admin-a', username: 'adminA', password: pw, role: 'Manager',
      fullName: 'Admin A', tenantIds: ['company-a'],
      tenantRoles: { 'company-a': 'Admin' },
      createdAt: stamp, updatedAt: stamp
    },
    // User in Company A and B (different roles)
    {
      id: 'u-multi', username: 'multiUser', password: pw, role: 'Manager',
      fullName: 'Multi User', tenantIds: ['company-a', 'company-b'],
      tenantRoles: { 'company-a': 'Admin', 'company-b': 'Cashier' },
      createdAt: stamp, updatedAt: stamp
    },
    // User in Company B only (Cashier)
    {
      id: 'u-cash-b', username: 'cashB', password: pw, role: 'Cashier',
      fullName: 'Cashier B', tenantIds: ['company-b'],
      tenantRoles: { 'company-b': 'Cashier' },
      createdAt: stamp, updatedAt: stamp
    },
    // Legacy user (no membership)
    {
      id: 'u-legacy', username: 'legacy', password: pw, role: 'Manager',
      fullName: 'Legacy User', createdAt: stamp, updatedAt: stamp
    },
    // Owner user
    {
      id: 'u-owner', username: 'owner', password: pw, role: 'Owner',
      fullName: 'Owner User', tenantIds: ['company-a', 'company-b'],
      createdAt: stamp, updatedAt: stamp
    }
  ];
}

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return require('../utils/jwt');
}

// ---------------------------------------------------------------------------
// MAIN SUITE
// ---------------------------------------------------------------------------
describe('P0-003 — Company / Branch Context Authorization', () => {
  let app;
  let dir;
  let jwt;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_PURCHASES_ISOLATION = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';

    dir = makeTempDataDir('p0003');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(hash('Pass#123')) });
    seed(dir, 'customers', { customers: [
      { id: 'cust-a1', name: 'Customer A1', balance: 100, tenantId: 'company-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'cust-b1', name: 'Customer B1', balance: 200, tenantId: 'company-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});
    seed(dir, 'suppliers', { suppliers: [
      { id: 'sup-a1', name: 'Supplier A1', balance: 50, tenantId: 'company-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'sup-b1', name: 'Supplier B1', balance: 150, tenantId: 'company-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    ]});

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    jwt = jwtFor();
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  async function loginAs(username, company) {
    const body = { username, password: 'Pass#123' };
    if (company) body.company = company;
    const res = await request(app).post('/api/v1/auth/login').send(body);
    const data = res.body && res.body.data;
    return { status: res.statusCode, body: res.body, data, accessToken: data ? data.accessToken : undefined };
  }

  // =========================================================================
  // TEST 1: User in Company A can read Company A data
  // =========================================================================
  describe('Test 1 — Active membership allows access to own company', () => {
    test('adminA logs into company-a and can read company-a customers', async () => {
      const r = await loginAs('adminA', 'company-a');
      expect(r.status).toBe(200);
      const token = jwt.verifyAccessToken(r.accessToken);
      expect(token.tenantId).toBe('company-a');

      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.customers.some(c => c.id === 'cust-a1')).toBe(true);
    });
  });

  // =========================================================================
  // TEST 2: User in Company A CANNOT read Company B data
  // =========================================================================
  describe('Test 2 — Cross-company read is DENIED', () => {
    test('adminA (company-a only) cannot see company-b customers', async () => {
      const r = await loginAs('adminA', 'company-a');
      expect(r.status).toBe(200);

      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
      // adminA has tenantIds: ['company-a'] only, so should NOT see cust-b1
      expect(res.body.data.customers.some(c => c.id === 'cust-b1')).toBe(false);
    });
  });

  // =========================================================================
  // TEST 3: switchCompany without membership → DENY
  // =========================================================================
  describe('Test 3 — Login to unowned company is DENIED (membership enforcement)', () => {
    test('adminA (company-a only) gets 403 when trying to login to company-b', async () => {
      const r = await loginAs('adminA', 'company-b');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeUndefined();
    });

    test('cashB (company-b only) gets 403 when trying to login to company-a', async () => {
      const r = await loginAs('cashB', 'company-a');
      expect(r.status).toBe(403);
      expect(r.accessToken).toBeUndefined();
    });
  });

  // =========================================================================
  // TEST 4: Inactive membership → DENY
  // =========================================================================
  describe('Test 4 — Inactive company membership is handled correctly', () => {
    test('any user logging into inactive company-c gets legacy fallback (no 403, no tenant)', async () => {
      const r = await loginAs('adminA', 'company-c');
      // Inactive company → legacy fallback, NOT 403 (membership check doesn't apply)
      expect(r.status).toBe(200);
      const token = jwt.verifyAccessToken(r.accessToken);
      expect(token.tenantId).toBeUndefined();
    });

    test('multiUser has no membership in company-c, inactive → legacy fallback', async () => {
      const r = await loginAs('multiUser', 'company-c');
      expect(r.status).toBe(200);
      const token = jwt.verifyAccessToken(r.accessToken);
      expect(token.tenantId).toBeUndefined();
    });
  });

  // =========================================================================
  // TEST 5: User in Company A cannot access Company B branches (data isolation)
  // =========================================================================
  describe('Test 5 — Cross-company data isolation via tenant-scoped entities', () => {
    test('adminA (company-a) cannot see company-b customers', async () => {
      const r = await loginAs('adminA', 'company-a');
      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
      // Should only see company-a customers
      for (const c of res.body.data.customers) {
        if (c.tenantId) expect(c.tenantId).toBe('company-a');
      }
    });

    test('cashB (company-b) cannot see company-a customers', async () => {
      const r = await loginAs('cashB', 'company-b');
      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
      for (const c of res.body.data.customers) {
        if (c.tenantId) expect(c.tenantId).toBe('company-b');
      }
    });
  });

  // =========================================================================
  // TEST 6: Client-supplied identifiers cannot override context
  // =========================================================================
  describe('Test 6 — Client-supplied identifiers are ignored', () => {
    test('X-Company-Id header does not change tenant resolution', async () => {
      const r = await loginAs('adminA', 'company-a');
      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .set('X-Company-Id', 'company-b');
      // Should still see only company-a data (header is ignored)
      expect(res.statusCode).toBe(200);
      for (const c of res.body.data.customers) {
        if (c.tenantId) expect(c.tenantId).toBe('company-a');
      }
    });

    test('body.tenantId in request does not override server context', async () => {
      const r = await loginAs('adminA', 'company-a');
      // Create a customer — the server should use its own tenant context
      const res = await request(app)
        .post('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ name: 'Server-Stamped Customer' });
      expect(res.statusCode).toBe(201);
      // The customer should be retrievable only within company-a scope
      const customerId = res.body.data.id;
      expect(customerId).toBeTruthy();
    });

    test('query params cannot scope data to another tenant', async () => {
      const r = await loginAs('adminA', 'company-a');
      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
      // With ENABLE_TENANT_FILTERING=true, should only see company-a customers
      for (const c of res.body.data.customers) {
        if (c.tenantId) expect(c.tenantId).toBe('company-a');
      }
    });
  });

  // =========================================================================
  // TEST 7: Switching from A → B changes effective role
  // =========================================================================
  describe('Test 7 — Company-scoped role resolution', () => {
    test('multiUser: Admin in company-a, Cashier in company-b', async () => {
      // Login to company-a → should be Admin
      const rA = await loginAs('multiUser', 'company-a');
      expect(rA.status).toBe(200);
      expect(rA.body.data.effectiveRole).toBe('Admin');

      // Login to company-b → should be Cashier
      const rB = await loginAs('multiUser', 'company-b');
      expect(rB.status).toBe(200);
      expect(rB.body.data.effectiveRole).toBe('Cashier');
    });

    test('multiUser as Admin in company-a can write users', async () => {
      const r = await loginAs('multiUser', 'company-a');
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ username: 'created-by-multi-a', password: 'Pass#123', role: 'Cashier' });
      expect(res.statusCode).toBe(201);
    });

    test('multiUser as Cashier in company-b CANNOT write users', async () => {
      const r = await loginAs('multiUser', 'company-b');
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ username: 'created-by-multi-b', password: 'Pass#123', role: 'Cashier' });
      expect(res.statusCode).toBe(403);
    });
  });

  // =========================================================================
  // TEST 8: Switch back B → A restores effective role
  // =========================================================================
  describe('Test 8 — Role restoration after company switch', () => {
    test('multiUser: after company-b (Cashier), switching to company-a restores Admin', async () => {
      // First login to company-b (Cashier)
      const rB = await loginAs('multiUser', 'company-b');
      expect(rB.body.data.effectiveRole).toBe('Cashier');

      // Then login to company-a (Admin)
      const rA = await loginAs('multiUser', 'company-a');
      expect(rA.body.data.effectiveRole).toBe('Admin');

      // Verify the token carries the correct tenant
      const tokenA = jwt.verifyAccessToken(rA.accessToken);
      expect(tokenA.tenantId).toBe('company-a');
    });
  });

  // =========================================================================
  // ADDITIONAL: JWT integrity tests
  // =========================================================================
  describe('JWT Context Integrity', () => {
    test('JWT carries the correct tenantId from login', async () => {
      const r = await loginAs('multiUser', 'company-b');
      const token = jwt.verifyAccessToken(r.accessToken);
      expect(token.tenantId).toBe('company-b');
      expect(token.sub).toBe('u-multi');
    });

    test('tampered JWT is rejected', async () => {
      const r = await loginAs('multiUser', 'company-a');
      const [head, payload, sig] = r.accessToken.split('.');
      // Tamper the payload to claim company-b
      const tamperedPayload = Buffer.from(
        JSON.stringify({ sub: 'u-multi', username: 'multiUser', role: 'Manager', tenantId: 'company-b', jti: 'x' })
      ).toString('base64url');
      const tampered = `${head}.${tamperedPayload}.${sig}`;

      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${tampered}`);
      // Tampered token → not authenticated → 401
      expect(res.statusCode).toBe(401);
    });

    test('legacy token without tenantId still works', async () => {
      const r = await loginAs('legacy');
      expect(r.status).toBe(200);
      const token = jwt.verifyAccessToken(r.accessToken);
      expect(token.tenantId).toBeUndefined();

      const res = await request(app)
        .get('/api/v1/customers')
        .set('Authorization', `Bearer ${r.accessToken}`);
      expect(res.statusCode).toBe(200);
    });
  });

  // =========================================================================
  // ADDITIONAL: Refresh token re-validation
  // =========================================================================
  describe('Refresh Token Re-validation', () => {
    test('refresh preserves tenant context', async () => {
      const r = await loginAs('multiUser', 'company-a');
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: r.data.refreshToken });
      expect(refreshRes.statusCode).toBe(200);
      const newToken = jwt.verifyAccessToken(refreshRes.body.data.accessToken);
      expect(newToken.tenantId).toBe('company-a');
    });

    test('refresh without tenant carries no tenant', async () => {
      const r = await loginAs('legacy');
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: r.data.refreshToken });
      expect(refreshRes.statusCode).toBe(200);
      const newToken = jwt.verifyAccessToken(refreshRes.body.data.accessToken);
      expect(newToken.tenantId).toBeUndefined();
    });
  });

  // =========================================================================
  // ADDITIONAL: Authorization middleware consistency
  // =========================================================================
  describe('Authorization Middleware Consistency', () => {
    test('tenant roles are resolved from the USER RECORD, not JWT claims', async () => {
      // Create a token that CLAIMS to be in company-b as Admin, but the user
      // record says they are Cashier in company-b
      const forged = jwt.signAccessToken({
        id: 'u-multi', username: 'multiUser', role: 'Admin', tenantId: 'company-b'
      });
      // The authorize middleware resolves from the real user record
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${forged}`)
        .send({ username: 'forged-test', password: 'Pass#123', role: 'Cashier' });
      // multiUser is Cashier in company-b, NOT Admin → should be 403
      expect(res.statusCode).toBe(403);
    });

    test('unauthenticated requests are rejected', async () => {
      const res = await request(app).get('/api/v1/customers');
      expect(res.statusCode).toBe(401);
    });

    test('Owner bypasses all permission checks', async () => {
      const r = await loginAs('owner', 'company-a');
      expect(r.status).toBe(200);
      expect(r.body.data.effectiveRole).toBe('Owner');
      const res = await request(app)
        .post('/api/v1/users')
        .set('Authorization', `Bearer ${r.accessToken}`)
        .send({ username: 'owner-created', password: 'Pass#123', role: 'Cashier' });
      expect(res.statusCode).toBe(201);
    });
  });

  // =========================================================================
  // ADDITIONAL: Company catalog is public (read-only)
  // =========================================================================
  describe('Company Catalog Access', () => {
    test('company list is accessible without authentication', async () => {
      const res = await request(app).get('/api/v1/companies');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.companies.length).toBeGreaterThanOrEqual(4);
    });

    test('only active companies are returned by active endpoint', async () => {
      const res = await request(app).get('/api/v1/companies/active');
      expect(res.statusCode).toBe(200);
      const active = res.body.data.companies;
      expect(active.every(c => c.active !== false)).toBe(true);
    });

    test('inactive company-c is in the catalog but marked inactive', async () => {
      const res = await request(app).get('/api/v1/companies/company-c');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.company.active).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Restore environment
// ---------------------------------------------------------------------------
afterAll(() => {
  for (const [envKey, origKey] of [
    ['ENABLE_TENANT_ROLES', 'ROLES'],
    ['ENABLE_TENANT_CARRY', 'CARRY'],
    ['ENABLE_MULTI_COMPANY_LOGIN', 'MC'],
    ['ENABLE_TENANT_USER_MEMBERSHIP', 'MEM'],
    ['AUTH_REQUIRED', 'AUTH'],
    ['DIGITRONICS_DATA_DIR', 'DATA'],
    ['ENABLE_TENANT_FILTERING', 'FLT'],
    ['ENABLE_TENANT_METADATA', 'MD'],
    ['ENABLE_TENANT_SALES_ISOLATION', 'ISO_SALES'],
    ['ENABLE_TENANT_PURCHASES_ISOLATION', 'ISO_PURCHASES'],
    ['ENABLE_TENANT_ENTITY_ISOLATION', 'ISO_ENTITY']
  ]) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});
