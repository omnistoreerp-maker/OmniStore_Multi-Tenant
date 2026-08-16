'use strict';

// P0-004 — Refresh Token Revocation & Company Deactivation Security
//
// Verifies that a refresh token can NEVER mint a fresh access token after the
// server-side authorization that justified it has lapsed:
//   - user disabled
//   - membership revoked for the carried tenant
//   - membership no longer includes the carried tenant
//   - company deactivated
//   - a role change is reflected immediately (no stale role continuation)
//
// The refresh token's tenant claim is treated as a context HINT only; every
// refresh must re-validate the current user, company and membership state.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const ACTIVE_COMPANIES = [
  { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
  { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

function usersPayload(tenantIds, tenantRoles, status) {
  return { users: [
    {
      id: 'u-member', username: 'member', password: hash('Pass#123'), role: 'Manager',
      fullName: 'Member User', tenantIds: tenantIds || [],
      tenantRoles: tenantRoles || {},
      status: status || 'active',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }
  ]};
}

describe('P0-004 — Refresh Token Revocation & Company Deactivation', () => {
  let app;
  let dir;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('p0004-refresh');
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
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

  async function loginAs(username, company) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username, password: 'Pass#123', company });
    const data = res.body && res.body.data;
    return { status: res.statusCode, data };
  }

  async function refreshAs(refreshToken) {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    return { status: res.statusCode, body: res.body };
  }

  // Test 1 — valid refresh: active user + active company + valid membership
  test('valid refresh succeeds while user, company and membership are active', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);
    expect(r.data.refreshToken).toBeDefined();

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.accessToken).toBeDefined();
  });

  // Test 2 — revoked membership: tenant removed from a multi-tenant membership
  test('revoked membership denies refresh for the carried tenant', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);

    // Membership for corp-a is revoked (kept membership in corp-b).
    seed(dir, 'users', usersPayload(['corp-b'], { 'corp-b': 'Cashier' }));

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(403);
    expect(refresh.body.data).toBeUndefined();
  });

  // Test 3 — deleted membership: the carried tenant is no longer in the list
  test('deleted membership for the carried tenant denies refresh', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a'], { 'corp-a': 'Admin' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);

    // Membership is moved/deleted: the user now belongs only to corp-b.
    seed(dir, 'users', usersPayload(['corp-b'], { 'corp-b': 'Cashier' }));

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(403);
    expect(refresh.body.data).toBeUndefined();
  });

  // Test 4 — deactivated company: active flag flipped to false
  test('deactivated company denies refresh for the carried tenant', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);

    // Company corp-a is deactivated after the token was issued.
    seed(dir, 'companies', [
      { id: 'corp-a', name: 'Corp A', code: 'CA', active: false },
      { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
    ]);

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(401);
    expect(refresh.body.data).toBeUndefined();
  });

  // Test 5 — deactivated user: status flipped to 'disabled'
  test('disabled user cannot refresh even with a valid token', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);

    // User is disabled after the token was issued (tokenVersion untouched, so
    // the P0-004 status gate is what must reject the refresh).
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }, 'disabled'));

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(403);
    expect(refresh.body.data).toBeUndefined();
  });

  // Test 6 — role change: a refreshed token must reflect the CURRENT role
  test('role change is reflected immediately on refresh (no stale role)', async () => {
    seed(dir, 'companies', ACTIVE_COMPANIES);
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Admin', 'corp-b': 'Cashier' }));

    const r = await loginAs('member', 'corp-a');
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Admin');

    // The user is demoted to Cashier in corp-a after the token was issued.
    seed(dir, 'users', usersPayload(['corp-a', 'corp-b'], { 'corp-a': 'Cashier', 'corp-b': 'Cashier' }));

    const refresh = await refreshAs(r.data.refreshToken);
    expect(refresh.status).toBe(200);
    expect(refresh.body.data.effectiveRole).toBe('Cashier');
  });
});
