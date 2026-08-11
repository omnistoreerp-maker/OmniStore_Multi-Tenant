'use strict';

// Phase E — privilege escalation defenses around PUT /api/v1/users/:id/permissions.
// Every assertion uses the real HTTP API with company-aware login and the
// actual authorization engine (never mocks).

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP
};

const companies = [
  { id: 't1', name: 'Team One', active: true },
  { id: 't2', name: 'Team Two', active: true }
];

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('escalation');
  server = await startServer(dataDir);
  seed(dataDir, 'companies', companies);

  await createUser(server.app, { username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'manager1', password: 'Mgr#1234', fullName: 'Manager One', role: 'Manager', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'cashier1', password: 'Cash#1234', fullName: 'Cashier One', role: 'Cashier', extra: { tenantIds: ['t1'] } });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

const PW = {
  owner1: 'Owner#123',
  admin1: 'Admin#123',
  manager1: 'Mgr#1234',
  cashier1: 'Cash#1234',
  esc_mgr_perm: 'Mgr#1234',
  superrole: 'Role#1234'
};

async function getToken(app, username, company) {
  const session = await login(app, username, PW[username], company || 't1');
  return session.accessToken;
}

describe('PUT /api/v1/users/:id/permissions — escalation defenses', () => {
  test('self-permission modification is denied with 403 PERMISSION_DENIED', async () => {
    const token = await getToken(server.app, 'admin1', 't1');
    const self = await login(server.app, 'admin1', PW.admin1, 't1');
    const res = await request(server.app).put('/api/v1/users/' + self.user.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('Manager cannot grant an admin-only permission', async () => {
    // Manager explicitly granted users.permissions.edit (passes the route gate),
    // but the controller still refuses admin-only grants via canGrantPermission.
    await createUser(server.app, { username: 'esc_mgr_perm', password: 'Mgr#1234', fullName: 'Esc Mgr Perm', role: 'Manager', extra: { tenantIds: ['t1'], permissions: ['users.permissions.edit'] } });
    const target = await createUser(server.app, { username: 'esc_mgr_target', password: 'Target#123', fullName: 'Esc Mgr Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'esc_mgr_perm', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.password.reset': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toBeUndefined();
  });

  test('Cashier cannot grant a permission they never hold', async () => {
    const target = await createUser(server.app, { username: 'esc_cash_target', password: 'Target#123', fullName: 'Esc Cash Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'cashier1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.password.reset': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('Admin cannot modify an Owner of the same tenant', async () => {
    const coOwner = await createUser(server.app, { username: 'esc_co_owner', password: 'Owner#123', fullName: 'Esc Co-Owner', role: 'Owner', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + coOwner.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.view': false } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === coOwner.id);
    expect(rec.tenantPermissions).toBeUndefined();
  });

  test('cross-tenant target is denied with 403', async () => {
    const target = await createUser(server.app, { username: 'esc_cross_target', password: 'Target#123', fullName: 'Esc Cross', role: 'Manager', extra: { tenantIds: ['t2'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('unknown role gains no permission-gate bypass', async () => {
    await createUser(server.app, { username: 'superrole', password: 'Role#1234', fullName: 'Super Role', role: 'SuperAdmin', extra: { tenantIds: ['t1'] } });
    const target = await createUser(server.app, { username: 'esc_super_target', password: 'Target#123', fullName: 'Esc Super Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'superrole', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    // SuperAdmin is not a known role: baseline is empty, no privilege bypass.
    expect(res.statusCode).toBe(403);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toBeUndefined();
  });

  test('unknown permission name is rejected with 400', async () => {
    const target = await createUser(server.app, { username: 'esc_unknown_target', password: 'Target#123', fullName: 'Esc Unknown', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.bogus': true } });
    expect(res.statusCode).toBe(400);
  });

  test('non-boolean permission value is rejected with 400', async () => {
    const target = await createUser(server.app, { username: 'esc_nonbool_target', password: 'Target#123', fullName: 'Esc NonBool', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': 'true' } });
    expect(res.statusCode).toBe(400);
  });
});

describe('PUT /api/v1/users/:id/permissions — forged tenant vectors', () => {
  test('forged X-Tenant-Id header cannot switch tenants', async () => {
    const target = await createUser(server.app, { username: 'esc_forge_tid', password: 'Target#123', fullName: 'Esc Forge TID', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).set('X-Tenant-Id', 't2').send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toHaveProperty('t1');
    expect(rec.tenantPermissions).not.toHaveProperty('t2');
  });

  test('forged X-Company-Id header cannot switch tenants', async () => {
    const target = await createUser(server.app, { username: 'esc_forge_cid', password: 'Target#123', fullName: 'Esc Forge CID', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).set('X-Company-Id', 't2').send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toHaveProperty('t1');
    expect(rec.tenantPermissions).not.toHaveProperty('t2');
  });

  test('forged body tenantId cannot change the trusted tenant', async () => {
    const target = await createUser(server.app, { username: 'esc_forge_body', password: 'Target#123', fullName: 'Esc Forge Body', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true }, tenantId: 't2' });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toHaveProperty('t1');
    expect(rec.tenantPermissions).not.toHaveProperty('t2');
  });

  test('forged query tenantId cannot change the trusted tenant', async () => {
    const target = await createUser(server.app, { username: 'esc_forge_query', password: 'Target#123', fullName: 'Esc Forge Query', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions?tenantId=t2').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toHaveProperty('t1');
    expect(rec.tenantPermissions).not.toHaveProperty('t2');
  });
});