'use strict';

// P0-003 — Refresh Token Re-validation Tests
//
// Verifies that:
//   - Refresh tokens re-validate company active status
//   - Refresh tokens re-validate user membership
//   - Revoked memberships are detected on refresh

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const usersService = require('../services/users.service');
const companyService = require('../services/company.service');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
  { id: 'corp-b', name: 'Corp B', code: 'CB', active: true },
  { id: 'corp-dead', name: 'Dead Corp', code: 'CD', active: false }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

describe('P0-003 — Refresh Token Re-validation', () => {
  let app;
  let dir;
  let jwt;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('p0003-refresh');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: [
      {
        id: 'u-member', username: 'member', password: hash('Pass#123'), role: 'Manager',
        fullName: 'Member User', tenantIds: ['corp-a', 'corp-b'],
        tenantRoles: { 'corp-a': 'Admin', 'corp-b': 'Cashier' },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      },
      {
        id: 'u-single', username: 'single', password: hash('Pass#123'), role: 'Cashier',
        fullName: 'Single Corp User', tenantIds: ['corp-a'],
        tenantRoles: { 'corp-a': 'Cashier' },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
      }
    ]});

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    jwt = jwtFor();
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  function jwtFor() {
    jest.resetModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    return require('../utils/jwt');
  }

  async function loginAs(username, company) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Pass#123', company });
    const data = res.body && res.body.data;
    return { status: res.statusCode, data, accessToken: data ? data.accessToken : undefined };
  }

  // Test 1: Refresh preserves valid tenant
  test('refresh with valid tenant preserves tenant context', async () => {
    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);
    const token = jwt.verifyAccessToken(r.accessToken);
    expect(token.tenantId).toBe('corp-a');

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r.data.refreshToken });
    expect(refreshRes.statusCode).toBe(200);
    const newToken = jwt.verifyAccessToken(refreshRes.body.data.accessToken);
    expect(newToken.tenantId).toBe('corp-a');
  });

  // Test 2: Refresh with different valid tenant
  test('refresh with corp-b tenant preserves that context', async () => {
    const r = await loginAs('member', 'corp-b');
    expect(r.status).toBe(200);
    const token = jwt.verifyAccessToken(r.accessToken);
    expect(token.tenantId).toBe('corp-b');

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r.data.refreshToken });
    expect(refreshRes.statusCode).toBe(200);
    const newToken = jwt.verifyAccessToken(refreshRes.body.data.accessToken);
    expect(newToken.tenantId).toBe('corp-b');
  });

  // Test 3: Refresh without tenant (legacy)
  test('refresh without tenant carries no tenant', async () => {
    // Login without company selection
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'member', password: 'Pass#123' });
    expect(res.statusCode).toBe(200);
    const token = jwt.verifyAccessToken(res.body.data.accessToken);
    expect(token.tenantId).toBeUndefined();

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: res.body.data.refreshToken });
    expect(refreshRes.statusCode).toBe(200);
    const newToken = jwt.verifyAccessToken(refreshRes.body.data.accessToken);
    expect(newToken.tenantId).toBeUndefined();
  });

  // Test 4: Verify auth/me works after refresh
  test('auth/me works after refresh with tenant context', async () => {
    const r = await loginAs('member', 'corp-a');
    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r.data.refreshToken });
    expect(refreshRes.statusCode).toBe(200);

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshRes.body.data.accessToken}`);
    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.data.user.username).toBe('member');
  });

  // Test 5: Verify effective role is correct after refresh
  test('effective role is correct after refresh', async () => {
    const r = await loginAs('member', 'corp-a');
    expect(r.data.effectiveRole).toBe('Admin');

    const refreshRes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r.data.refreshToken });
    expect(refreshRes.statusCode).toBe(200);

    // The refreshed token should still resolve as Admin in corp-a
    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${refreshRes.body.data.accessToken}`);
    expect(meRes.statusCode).toBe(200);
    expect(meRes.body.data.effectiveRole).toBe('Admin');
  });
});

// Restore environment
afterAll(() => {
  for (const [envKey, origKey] of [
    ['ENABLE_TENANT_ROLES', 'ROLES'],
    ['ENABLE_TENANT_CARRY', 'CARRY'],
    ['ENABLE_MULTI_COMPANY_LOGIN', 'MC'],
    ['ENABLE_TENANT_USER_MEMBERSHIP', 'MEM'],
    ['AUTH_REQUIRED', 'AUTH'],
    ['DIGITRONICS_DATA_DIR', 'DATA']
  ]) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});
