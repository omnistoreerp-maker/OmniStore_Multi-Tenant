'use strict';

// Phase E — PUT /api/v1/users/:id/permissions

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
  dataDir = makeTempDataDir('perm-update');
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

const PW = { owner1: 'Owner#123', admin1: 'Admin#123', manager1: 'Mgr#1234', cashier1: 'Cash#1234', pe_mgr_noedit: 'Mgr#1234' };

async function getToken(app, username, company) {
  const session = await login(app, username, PW[username], company || 't1');
  return session.accessToken;
}

describe('PUT /api/v1/users/:id/permissions', () => {
  test('anonymous request is rejected with 401', async () => {
    const res = await request(server.app).put('/api/v1/users/some-id/permissions').send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(401);
  });

  test('missing users.permissions.edit is denied with 403', async () => {
    const target = await createUser(server.app, { username: 'pe_noedit_t', password: 'Target#123', fullName: 'No Edit', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'cashier1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('valid update grants a true override', async () => {
    const target = await createUser(server.app, { username: 'pe_grant_t', password: 'Target#123', fullName: 'Grant Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.delete': true } });
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toHaveProperty('password');
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toEqual({ t1: { 'sales.delete': true } });
  });

  test('false override revokes from baseline', async () => {
    const target = await createUser(server.app, { username: 'pe_revoke_t', password: 'Target#123', fullName: 'Revoke Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': false } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions.t1['sales.view']).toBe(false);
  });

  test('unknown permission returns 400', async () => {
    const target = await createUser(server.app, { username: 'pe_unknown_t', password: 'Target#123', fullName: 'Unknown Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.nonexistent': true } });
    expect(res.statusCode).toBe(400);
  });

  test('non-boolean value returns 400', async () => {
    const target = await createUser(server.app, { username: 'pe_nonbool_t', password: 'Target#123', fullName: 'Non Bool', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': 'true' } });
    expect(res.statusCode).toBe(400);
  });

  test('null overrides returns 400', async () => {
    const target = await createUser(server.app, { username: 'pe_null_t', password: 'Target#123', fullName: 'Null Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: null });
    expect(res.statusCode).toBe(400);
  });

  test('array overrides returns 400', async () => {
    const target = await createUser(server.app, { username: 'pe_array_t', password: 'Target#123', fullName: 'Array Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: ['sales.view'] });
    expect(res.statusCode).toBe(400);
  });

  test('self-permission modification is denied with 403', async () => {
    const token = await getToken(server.app, 'cashier1');
    const self = await login(server.app, 'cashier1', PW.cashier1, 't1');
    const res = await request(server.app).put('/api/v1/users/' + self.user.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('cross-tenant target is denied with 403', async () => {
    const target = await createUser(server.app, { username: 'pe_cross_t', password: 'Target#123', fullName: 'Cross Tenant', role: 'Cashier', extra: { tenantIds: ['t2'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('forged X-Tenant-Id header does not switch tenants', async () => {
    const target = await createUser(server.app, { username: 'pe_forge_t', password: 'Target#123', fullName: 'Forged', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).set('X-Tenant-Id', 't2').send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toHaveProperty('t1');
    expect(rec.tenantPermissions).not.toHaveProperty('t2');
  });

  test('actor cannot grant a permission they lack (escalation guard)', async () => {
    const manager = await createUser(server.app, { username: 'pe_mgr_noedit', password: 'Mgr#1234', fullName: 'Mgr No Edit', role: 'Manager', extra: { tenantIds: ['t1'], permissions: ['users.permissions.edit'] } });
    const target = await createUser(server.app, { username: 'pe_esc_t', password: 'Target#123', fullName: 'Esc Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'pe_mgr_noedit');
    // Manager baseline lacks users.password.reset; attempt to grant it is refused.
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.password.reset': true } });
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });

  test('no partial persistence after a rejected update', async () => {
    const target = await createUser(server.app, { username: 'pe_atomic_t', password: 'Target#123', fullName: 'Atomic', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true, 'sales.bogus': true } });
    expect(res.statusCode).toBe(400);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions).toBeUndefined();
  });

  test('overrides merge with existing per-tenant overrides', async () => {
    const target = await createUser(server.app, { username: 'pe_merge_t', password: 'Target#123', fullName: 'Merge', role: 'Cashier', extra: { tenantIds: ['t1'], tenantPermissions: { t1: { 'sales.delete': true } } } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.create': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'users');
    const rec = store.users.find(u => u.id === target.id);
    expect(rec.tenantPermissions.t1).toEqual({ 'sales.delete': true, 'sales.create': true });
  });

  test('audit USER_PERMISSIONS_CHANGED is recorded without secrets', async () => {
    const target = await createUser(server.app, { username: 'pe_audit_t', password: 'Target#123', fullName: 'Audit Target', role: 'Cashier', extra: { tenantIds: ['t1'] } });
    const token = await getToken(server.app, 'admin1');
    const res = await request(server.app).put('/api/v1/users/' + target.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const store = readStore(dataDir, 'auditLog');
    const entry = store.entries.find(e => e.action === 'USER_PERMISSIONS_CHANGED' && e.resourceId === target.id);
    expect(entry).toBeTruthy();
    expect(entry.resourceId).toBe(target.id);
    expect(entry.changes.after.overrides).toEqual({ 'sales.view': true });
    // The Phase E audit entry itself carries only boolean overrides.
    const entryRaw = JSON.stringify(entry);
    expect(entryRaw).not.toMatch(/password/i);
    expect(entryRaw).not.toMatch(/tokenVersion/i);
    // No literal secret value ever reaches the trail (redaction replaces values).
    const raw = JSON.stringify(store.entries);
    expect(raw).not.toContain('Target#123');
    expect(raw).not.toContain('Admin#123');
  });
});