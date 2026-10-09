'use strict';

// membershipRevocation.test.js — tenant-membership/role changes invalidate sessions.
//
// A genuine tenantIds/tenantRoles change through PUT /users/:id bumps
// tokenVersion, so access tokens issued before the change fail closed on the
// next request. Omitted fields are never treated as removals, unchanged values
// never bump, and user deletion keeps the explicitly accepted legacy/synthetic
// identity behavior (unchanged by this task).

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 't1', name: 'Team One', active: true },
  { id: 't2', name: 'Team Two', active: true }
];

const PW = {
  admin: 'Admin#1234',
  target: 'Target#123',
  roles: 'Roles#1234',
  stable: 'Stable#123',
  disable: 'Disable#123',
  refr: 'Refresh#123',
  gone: 'Gone#12345'
};

let app;
let dir;
const ids = {};

beforeEach(async () => {
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  process.env.ENABLE_TENANT_ROLES = 'true';
  dir = makeTempDataDir('member-revoke');
  seed(dir, 'companies', companies);
  // Create users with the auth gate off, then boot the hardened app.
  let server = startServer(dir);
  const admin = await createUser(server.app, { username: 'revAdmin', password: PW.admin, fullName: 'Rev Admin', role: 'Admin', extra: { tenantIds: ['t1'] } });
  const target = await createUser(server.app, { username: 'revTarget', password: PW.target, fullName: 'Rev Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  const roles = await createUser(server.app, { username: 'revRoles', password: PW.roles, fullName: 'Rev Roles', role: 'Cashier', extra: { tenantIds: ['t1'], tenantRoles: { t1: 'Cashier' } } });
  const stable = await createUser(server.app, { username: 'revStable', password: PW.stable, fullName: 'Rev Stable', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  const disable = await createUser(server.app, { username: 'revDisable', password: PW.disable, fullName: 'Rev Disable', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  const refr = await createUser(server.app, { username: 'revRefresh', password: PW.refr, fullName: 'Rev Refresh', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  const gone = await createUser(server.app, { username: 'revGone', password: PW.gone, fullName: 'Rev Gone', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  Object.assign(ids, { admin: admin.id, target: target.id, roles: roles.id, stable: stable.id, disable: disable.id, refr: refr.id, gone: gone.id });
  server = startServer(dir, { AUTH_REQUIRED: 'true' });
  app = server.app;
});

afterEach(() => {
  try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
});

afterAll(() => {
  if (ORIGINAL_ENV.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  if (ORIGINAL_ENV.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_ENV.MC;
  if (ORIGINAL_ENV.MEM === undefined) delete process.env.ENABLE_TENANT_USER_MEMBERSHIP; else process.env.ENABLE_TENANT_USER_MEMBERSHIP = ORIGINAL_ENV.MEM;
  if (ORIGINAL_ENV.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_ENV.ROLES;
  if (ORIGINAL_ENV.AUTH === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
  if (ORIGINAL_ENV.DATA === undefined) delete process.env.DIGITRONICS_DATA_DIR; else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
});

const perms = (token) => request(app).get('/api/v1/tenant/education/centers').set(authHeader(token));

function readUser(id) {
  return readStore(dir, 'users').users.find((u) => u.id === id);
}

describe('tenant membership/role revocation invalidates sessions', () => {
  test('A. removing tenant membership invalidates the existing access token', async () => {
    const before = await login(app, 'revTarget', PW.target, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).put('/api/v1/users/' + ids.target).set(authHeader(admin.accessToken)).send({ tenantIds: [] });
    expect(res.statusCode).toBe(200);
    expect(Number(readUser(ids.target).tokenVersion)).toBeGreaterThan(0);
    expect((await perms(before.accessToken)).statusCode).toBe(401);
    expect((await perms(admin.accessToken)).statusCode).toBe(200);
  });

  test('B. changing tenantRoles invalidates the existing access token', async () => {
    const before = await login(app, 'revRoles', PW.roles, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).put('/api/v1/users/' + ids.roles).set(authHeader(admin.accessToken)).send({ tenantRoles: { t1: 'Manager' } });
    expect(res.statusCode).toBe(200);
    expect(Number(readUser(ids.roles).tokenVersion)).toBeGreaterThan(0);
    expect((await perms(before.accessToken)).statusCode).toBe(401);
  });

  test('C. an update that leaves tenant scope untouched does not bump tokenVersion', async () => {
    const session = await login(app, 'revStable', PW.stable, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).put('/api/v1/users/' + ids.stable).set(authHeader(admin.accessToken)).send({ fullName: 'Rev Stable Renamed' });
    expect(res.statusCode).toBe(200);
    expect(Number(readUser(ids.stable).tokenVersion)).toBe(0);
    // Still authenticated (403 = valid token, no education grant), so no bump.
    expect((await perms(session.accessToken)).statusCode).toBe(403);
  });

  test('D. disabling a user still invalidates existing access tokens', async () => {
    const before = await login(app, 'revDisable', PW.disable, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).post('/api/v1/users/' + ids.disable + '/disable').set(authHeader(admin.accessToken));
    expect(res.statusCode).toBe(200);
    expect((await perms(before.accessToken)).statusCode).toBe(401);
  });

  test('E. refresh after membership revocation is rejected', async () => {
    const session = await login(app, 'revRefresh', PW.refr, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).put('/api/v1/users/' + ids.refr).set(authHeader(admin.accessToken)).send({ tenantIds: [] });
    expect(res.statusCode).toBe(200);
    const refresh = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: session.refreshToken });
    expect([401, 403]).toContain(refresh.statusCode);
  });

  test('G. user deletion keeps the accepted legacy/synthetic identity contract', async () => {
    const session = await login(app, 'revGone', PW.gone, 't1');
    const admin = await login(app, 'revAdmin', PW.admin, 't1');
    const res = await request(app).delete('/api/v1/users/' + ids.gone).set(authHeader(admin.accessToken));
    expect(res.statusCode).toBe(200);
    // Contract unchanged by this task: a deleted record leaves the previously
    // issued token's signature/expiry as the only remaining gate, so the
    // request still authenticates and answers 403 (no education grant)
    // instead of 401.
    expect((await perms(session.accessToken)).statusCode).toBe(403);
  });
});
