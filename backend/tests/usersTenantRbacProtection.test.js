'use strict';

// W1 — tenant-mode RBAC protection on the generic user update route.
//
// PUT /api/v1/users/:id is a profile update. `users.edit` (a default Manager
// baseline permission) must NOT imply `users.permissions.grant`, and must not
// allow tenant membership edits. Permission grants belong to
// PUT /users/:id/permissions, which enforces users.permissions.edit,
// canGrantPermission, self-modification refusal and last-Owner protection.
//
// Real auth middleware, authorization engine, tenant context and JSON store run
// here; nothing is mocked.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Rbac#1234';
const FLAGS = [
  'ENABLE_TENANT_ROLES',
  'ENABLE_TENANT_CARRY',
  'ENABLE_MULTI_COMPANY_LOGIN',
  'ENABLE_TENANT_USER_MEMBERSHIP'
];
const ORIGINAL_FLAGS = {};

const companies = {
  companies: [
    { id: 't1', code: 'T1', name: 'Tenant One', active: true, branches: [{ id: 'MAIN', name: 'Main', code: 'MAIN', isDefault: true, active: true }] },
    { id: 't2', code: 'T2', name: 'Tenant Two', active: true, branches: [{ id: 'MAIN2', name: 'Main 2', code: 'MAIN2', isDefault: true, active: true }] }
  ]
};

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  const base = { password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 };
  return {
    users: [
      { ...base, id: 'u-owner', username: 'owner1', fullName: 'Owner One', role: 'Owner', tenantIds: ['t1'], tenantRoles: { t1: 'Owner' } },
      { ...base, id: 'u-admin', username: 'admin1', fullName: 'Admin One', role: 'Admin', tenantIds: ['t1'], tenantRoles: { t1: 'Admin' } },
      { ...base, id: 'u-mgr', username: 'manager1', fullName: 'Manager One', role: 'Manager', tenantIds: ['t1'], tenantRoles: { t1: 'Manager' } },
      { ...base, id: 'u-mgrperm', username: 'managerperm', fullName: 'Manager Perm', role: 'Manager', tenantIds: ['t1'], tenantRoles: { t1: 'Manager' }, permissions: ['users.permissions.edit'] },
      { ...base, id: 'u-cash', username: 'cashier1', fullName: 'Cashier One', role: 'Cashier', tenantIds: ['t1'], tenantRoles: { t1: 'Cashier' } },
      { ...base, id: 'u-cash2', username: 'cashier2', fullName: 'Cashier Two', role: 'Cashier', tenantIds: ['t2'], tenantRoles: { t2: 'Cashier' } }
    ]
  };
}

let server;
let dataDir;
let ownerToken;
let adminToken;
let managerToken;
let managerPermToken;

function user(id) {
  return readStore(dataDir, 'users').users.find((u) => u.id === id);
}

function put(token, id, body) {
  return request(server.app).put('/api/v1/users/' + id).set(authHeader(token)).send(body);
}

function putPermissions(token, id, overrides) {
  return request(server.app).put('/api/v1/users/' + id + '/permissions').set(authHeader(token)).send({ overrides });
}

beforeAll(async () => {
  for (const key of FLAGS) {
    ORIGINAL_FLAGS[key] = process.env[key];
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('tenant-rbac');
  seed(dataDir, 'companies', companies);
  seed(dataDir, 'users', userRecords());
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  ownerToken = (await login(server.app, 'owner1', PASSWORD, 't1')).accessToken;
  adminToken = (await login(server.app, 'admin1', PASSWORD, 't1')).accessToken;
  managerToken = (await login(server.app, 'manager1', PASSWORD, 't1')).accessToken;
  managerPermToken = (await login(server.app, 'managerperm', PASSWORD, 't1')).accessToken;
  expect(ownerToken && adminToken && managerToken && managerPermToken).toBeTruthy();
});

afterAll(() => {
  for (const key of FLAGS) {
    if (ORIGINAL_FLAGS[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_FLAGS[key];
  }
});

registerCleanup(() => [server], () => [dataDir]);

describe('Manager (users.edit) — profile updates stay allowed', () => {
  test('can update ordinary profile fields of a same-tenant user', async () => {
    const res = await put(managerToken, 'u-cash', { fullName: 'Cashier Renamed', phone: '0111' });

    expect(res.statusCode).toBe(200);
    expect(user('u-cash').fullName).toBe('Cashier Renamed');
    expect(user('u-cash').phone).toBe('0111');
  });
});

describe('Manager — cannot grant permissions or edit membership via PUT', () => {
  test('permissions:["all"] is rejected and nothing is written', async () => {
    const res = await put(managerToken, 'u-cash', { permissions: ['all'] });

    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    expect(user('u-cash').permissions).toBeUndefined();
  });

  test('adding tenantIds is rejected and membership is unchanged', async () => {
    const before = user('u-cash').tenantIds.slice();

    const res = await put(managerToken, 'u-cash', { tenantIds: ['t1', 't2'] });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash').tenantIds).toEqual(before);
  });

  test('tenantRoles cannot be rewritten through PUT', async () => {
    const before = user('u-cash').tenantRoles;

    const res = await put(managerToken, 'u-cash', { tenantRoles: { t1: 'Manager' } });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash').tenantRoles).toEqual(before);
  });

  test('tenantPermissions is ignored on PUT (official route only)', async () => {
    const before = user('u-cash').tenantPermissions;

    const res = await put(managerToken, 'u-cash', { tenantPermissions: { t1: { 'users.delete': true } } });

    expect(res.statusCode).toBe(200);
    expect(user('u-cash').tenantPermissions).toEqual(before);
    expect(user('u-cash').tenantPermissions).toBeUndefined();
  });

  test('a permission editor still cannot mass-assign permissions through PUT', async () => {
    const res = await put(managerPermToken, 'u-cash', { permissions: ['all'] });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash').permissions).toBeUndefined();
  });

  test('self-escalation is rejected (role and permissions)', async () => {
    const roleRes = await put(managerToken, 'u-mgr', { role: 'Owner' });
    expect(roleRes.statusCode).toBe(403);

    const permRes = await put(managerToken, 'u-mgr', { permissions: ['all'] });
    expect(permRes.statusCode).toBe(403);

    expect(user('u-mgr').role).toBe('Manager');
    expect(user('u-mgr').permissions).toBeUndefined();
  });

  test('a cross-tenant target cannot be updated', async () => {
    const res = await put(managerToken, 'u-cash2', { fullName: 'Cross Tenant' });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash2').fullName).toBe('Cashier Two');
  });
});

describe('Official permissions route — policy still enforced', () => {
  test('Manager without users.permissions.edit is refused', async () => {
    const res = await putPermissions(managerToken, 'u-cash', { 'sales.delete': true });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash').tenantPermissions).toBeUndefined();
  });

  test('Manager with users.permissions.edit is still denied (unchanged fail-closed policy)', async () => {
    // The route gate admits this actor, but the controller's per-permission
    // check runs against the signed identity, which carries no grants, so a
    // non-privileged actor can never grant. That is stricter than the registry
    // requires, never weaker, and it is unchanged by this fix (escalation and
    // permissionUpdate suites pin that behavior).
    const res = await putPermissions(managerPermToken, 'u-cash', { 'sales.view': true });

    expect(res.statusCode).toBe(403);
    expect(user('u-cash').tenantPermissions).toBeUndefined();
  });

  test('unknown permissions are rejected by the official route', async () => {
    const res = await putPermissions(adminToken, 'u-cash', { 'sales.bogus': true });

    expect(res.statusCode).toBe(400);
    expect(user('u-cash').tenantPermissions).toBeUndefined();
  });

  test('the official route refuses cross-tenant targets and self-modification', async () => {
    const crossTenant = await putPermissions(managerPermToken, 'u-cash2', { 'sales.view': true });
    expect(crossTenant.statusCode).toBe(403);

    const self = await putPermissions(managerPermToken, 'u-mgrperm', { 'sales.view': true });
    expect(self.statusCode).toBe(403);
  });
});

describe('Owner/Admin — legitimate administration keeps working', () => {
  test('Admin can assign a lower role', async () => {
    const res = await put(adminToken, 'u-cash', { role: 'Manager' });

    expect(res.statusCode).toBe(200);
    expect(user('u-cash').tenantRoles.t1).toBe('Manager');
  });

  test('Admin can change tenant membership and the session is revoked (main behaviour)', async () => {
    const before = Number(user('u-cash').tokenVersion) || 0;

    const res = await put(adminToken, 'u-cash', { tenantIds: ['t1', 't2'] });

    expect(res.statusCode).toBe(200);
    expect(user('u-cash').tenantIds).toEqual(['t1', 't2']);
    expect(Number(user('u-cash').tokenVersion)).toBe(before + 1);
  });

  test('Admin can grant permissions through the official route', async () => {
    const res = await putPermissions(adminToken, 'u-cash', { 'reports.view': false });

    expect(res.statusCode).toBe(200);
    expect(user('u-cash').tenantPermissions.t1['reports.view']).toBe(false);
  });

  test('last-Owner protection still blocks demoting the sole Owner', async () => {
    const res = await put(ownerToken, 'u-owner', { role: 'Admin' });

    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    expect(user('u-owner').tenantRoles.t1).toBe('Owner');
  });

  test('Owner retains ownership of the tenant after all updates', async () => {
    const db = readStore(dataDir, 'users');
    const owners = db.users.filter((u) => u.tenantRoles && u.tenantRoles.t1 === 'Owner');
    expect(owners).toHaveLength(1);
    expect(fs.existsSync(dataDir)).toBe(true);
  });
});
