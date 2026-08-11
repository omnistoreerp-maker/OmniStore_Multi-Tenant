'use strict';

// Phase E — GET /api/v1/users/:id/permissions

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
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
  dataDir = makeTempDataDir('user-perms');
  server = await startServer(dataDir);
  seed(dataDir, 'companies', companies);

  await createUser(server.app, { username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'manager1', password: 'Mgr#1234', fullName: 'Manager One', role: 'Manager', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'cashier1', password: 'Cash#1234', fullName: 'Cashier One', role: 'Cashier', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'target2', password: 'Target#123', fullName: 'Target Two', role: 'Manager', extra: { tenantIds: ['t2'] } });
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
  manager_viewer: 'Mgr#1234'
};

async function getToken(app, username, company) {
  const session = await login(app, username, PW[username] || 'Target#123', company || 't1');
  return session.accessToken;
}

describe('GET /api/v1/users/:id/permissions', () => {
  test('anonymous request is rejected with 401', async () => {
    const res = await request(server.app).get('/api/v1/users/some-id/permissions');
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('missing users.permissions.view is denied with 403', async () => {
    const target = await createUser(server.app, { username: 'target_noperm', password: 'Target#123', fullName: 'No Perm Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'cashier1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('Admin can view permissions of same-tenant user', async () => {
    const target = await createUser(server.app, { username: 'admin_view_target', password: 'Target#123', fullName: 'Admin View Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('tenantId', 't1');
    expect(res.body.data).toHaveProperty('targetUser');
    expect(res.body.data.targetUser.id).toBe(target.id);
    expect(res.body.data).toHaveProperty('permissionGroups');
    expect(Array.isArray(res.body.data.permissionGroups)).toBe(true);
    expect(res.body.data).toHaveProperty('effective');
    expect(Array.isArray(res.body.data.effective)).toBe(true);
    expect(res.body.data).toHaveProperty('overrides');
    expect(typeof res.body.data.overrides).toBe('object');
  });

  test('Owner can view permissions of same-tenant user', async () => {
    const target = await createUser(server.app, { username: 'owner_view_target', password: 'Target#123', fullName: 'Owner View Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'owner1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('cross-tenant target is rejected with 403', async () => {
    const target2rec = await createUser(server.app, { username: 'cross_tenant_target', password: 'Target#123', fullName: 'Cross Tenant', role: 'Cashier', extra: { tenantIds: ['t2'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).get('/api/v1/users/' + target2rec.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('non-existent user returns 404', async () => {
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).get('/api/v1/users/non-existent-id/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
  });

  test('effective permissions include baseline + overrides', async () => {
    const target = await createUser(server.app, { username: 'override_target', password: 'Target#123', fullName: 'Override Target', role: 'Cashier', extra: { tenantIds: ['t1'], tenantPermissions: { t1: { 'sales.delete': true } } } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.effective).toContain('sales.delete');
    expect(res.body.data.overrides).toEqual({ 'sales.delete': true });
  });

  test('explicit false override appears in overrides and removes from effective', async () => {
    const target = await createUser(server.app, { username: 'false_override_target', password: 'Target#123', fullName: 'False Override', role: 'Cashier', extra: { tenantIds: ['t1'], tenantPermissions: { t1: { 'sales.view': false } } } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.overrides).toEqual({ 'sales.view': false });
    expect(res.body.data.effective).not.toContain('sales.view');
  });

  test('absent override inherits the role baseline', async () => {
    const target = await createUser(server.app, { username: 'inherit_target', password: 'Target#123', fullName: 'Inherit Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.effective).toContain('sales.create'); // Cashier baseline
    expect(res.body.data.overrides).toEqual({});
  });

  test('Manager with users.permissions.view can view', async () => {
    await createUser(server.app, { username: 'manager_viewer', password: 'Mgr#1234', fullName: 'Manager Viewer', role: 'Manager', extra: { tenantIds: ['t1'], permissions: ['users.permissions.view'] } });
    const target = await createUser(server.app, { username: 'mgr_target', password: 'Target#123', fullName: 'MGR Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'manager_viewer');
    const res = await request(server.app).get('/api/v1/users/' + target.id + '/permissions').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET permissions — tenant forgery vectors', () => {
  test('forged X-Tenant-Id header is ignored', async () => {
    const target = await createUser(server.app, { username: 'forge_tid_target', password: 'Target#123', fullName: 'Forged TID', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app)
      .get('/api/v1/users/' + target.id + '/permissions')
      .set(authHeader(token))
      .set('X-Tenant-Id', 't2');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('t1');
  });

  test('forged X-Company-Id header is ignored', async () => {
    const target = await createUser(server.app, { username: 'forge_cid_target', password: 'Target#123', fullName: 'Forged CID', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app)
      .get('/api/v1/users/' + target.id + '/permissions')
      .set(authHeader(token))
      .set('X-Company-Id', 't2');
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('t1');
  });

  test('forged query tenantId is ignored', async () => {
    const target = await createUser(server.app, { username: 'forge_query_target', password: 'Target#123', fullName: 'Forged Query', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app)
      .get('/api/v1/users/' + target.id + '/permissions?tenantId=t2')
      .set(authHeader(token));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('t1');
  });
});