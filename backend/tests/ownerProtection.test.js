'use strict';

// Phase E — Last Owner protection and Owner-level authority rules.
// All assertions use the real HTTP API with company-aware login and the
// actual authorization engine. After every rejected operation we re-read the
// persisted store to prove the Owner was not mutated.

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
  { id: 't2', name: 'Team Two', active: true },
  { id: 't3', name: 'Solo Owner Tenant', active: true }
];

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('owner-protection');
  server = await startServer(dataDir);
  seed(dataDir, 'companies', companies);

  // t1 has TWO Owners (owner1 + coOwner1) so co-Owner management is reachable.
  await createUser(server.app, { username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'coOwner1', password: 'Owner#456', fullName: 'Co Owner One', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'coOwnerDel', password: 'Owner#789', fullName: 'Co Owner Delete Target', role: 'Owner', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin', extra: { tenantIds: ['t1'] } });
  await createUser(server.app, { username: 'manager1', password: 'Mgr#1234', fullName: 'Manager One', role: 'Manager', extra: { tenantIds: ['t1'] } });

  // t3 has exactly ONE Owner (soloOwner) — the last-Owner guard tenant.
  await createUser(server.app, { username: 'soloOwner', password: 'Solo#1234', fullName: 'Solo Owner', role: 'Owner', extra: { tenantIds: ['t3'] } });
  await createUser(server.app, { username: 'op_mgr_actor', password: 'Mgr#1234', fullName: 'OP Mgr Actor', role: 'Manager', extra: { tenantIds: ['t3'] } });
  await createUser(server.app, { username: 'op_admin_actor', password: 'Admin#123', fullName: 'OP Admin Actor', role: 'Admin', extra: { tenantIds: ['t3'] } });
  // Globally an Owner, but tenant-demoted to Manager in t3 and granted
  // users.disable + users.permissions.edit. This is the ONE actor that passes
  // both the route gates AND the controller's vertical guard (Owner-effective
  // via the signed global role) while NOT being counted among t3's Owners — so
  // the last-Owner 409 is reachable on disable AND permission stripping.
  await createUser(server.app, { username: 'op_demoted_owner', password: 'Owner#123', fullName: 'OP Demoted Owner', role: 'Owner', extra: { tenantIds: ['t3'], tenantRoles: { t3: 'Manager' }, permissions: ['users.disable', 'users.permissions.edit'] } });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

const PW = {
  owner1: 'Owner#123',
  coOwner1: 'Owner#456',
  admin1: 'Admin#123',
  manager1: 'Mgr#1234',
  soloOwner: 'Solo#1234',
  op_mgr_actor: 'Mgr#1234',
  op_admin_actor: 'Admin#123',
  op_demoted_owner: 'Owner#123'
};

async function getToken(app, username, company) {
  const session = await login(app, username, PW[username], company || 't1');
  return session.accessToken;
}

function readUser(id) {
  const store = readStore(dataDir, 'users');
  return store.users.find(u => u.id === id);
}

describe('Last Owner protection — delete', () => {
  test('deleting the last Owner of t3 is rejected with 409 LAST_OWNER_PROTECTION', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_admin_actor', 't3');
    const res = await request(server.app).delete('/api/v1/users/' + solo.id).set(authHeader(token));
    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    // The Owner must remain fully intact after the rejected delete.
    const after = readUser(solo.id);
    expect(after).toBeTruthy();
    expect(after.role).toBe('Owner');
  });

  test('deleting a co-Owner is allowed when another Owner remains', async () => {
    const store = readStore(dataDir, 'users');
    const co = store.users.find(u => u.username === 'coOwnerDel');
    const token = await getToken(server.app, 'owner1', 't1');
    const res = await request(server.app).delete('/api/v1/users/' + co.id).set(authHeader(token));
    expect(res.statusCode).toBe(200);
    const after = readUser(co.id);
    expect(after).toBeUndefined();
  });
});

describe('Last Owner protection — disable', () => {
  test('disabling with a non-Owner actor on an Owner target is refused (vertical escalation)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_admin_actor', 't3');
    const res = await request(server.app).post('/api/v1/users/' + solo.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    const after = readUser(solo.id);
    expect(after.status).not.toBe('disabled');
  });

  test('a policy-eligible actor cannot disable the last Owner of a tenant (409 LAST_OWNER_PROTECTION)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    // op_demoted_owner passes the users.disable route gate and — via its
    // GLOBAL Owner role signed into the token — the controller's vertical
    // guard, yet is tenant-demoted (Manager in t3) so it is not counted among
    // t3 Owners. t3's only Owner therefore triggers the last-Owner guard.
    const token = await getToken(server.app, 'op_demoted_owner', 't3');
    const res = await request(server.app).post('/api/v1/users/' + solo.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    const after = readUser(solo.id);
    expect(after.status).not.toBe('disabled');
  });
});

describe('Last Owner protection — demotion via PUT /users/:id', () => {
  test('demoting the sole Owner of t3 is rejected with 409 LAST_OWNER_PROTECTION', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_admin_actor', 't3');
    const res = await request(server.app).put('/api/v1/users/' + solo.id).set(authHeader(token)).send({ role: 'Manager' });
    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    const after = readUser(solo.id);
    expect(after.role).toBe('Owner');
  });
});

describe('Last Owner protection — permission removal via PUT /users/:id/permissions', () => {
  test('a policy-eligible actor cannot strip the last Owner of t3 permissions (409 LAST_OWNER_PROTECTION)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_demoted_owner', 't3');
    const res = await request(server.app).put('/api/v1/users/' + solo.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.view': false } });
    expect(res.statusCode).toBe(409);
    expect(res.body.details).toEqual({ code: 'LAST_OWNER_PROTECTION' });
    const after = readUser(solo.id);
    expect(after.tenantPermissions).toBeUndefined();
  });
});

describe('Owner authority — co-Owner management', () => {
  test('an Owner may manage another Owner when more than one Owner exists', async () => {
    const store = readStore(dataDir, 'users');
    const co = store.users.find(u => u.username === 'coOwner1');
    const token = await getToken(server.app, 'owner1', 't1');
    const res = await request(server.app).put('/api/v1/users/' + co.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(200);
    const after = readUser(co.id);
    expect(after.tenantPermissions.t1).toEqual({ 'sales.view': true });
  });

  test('an Owner may disable another Owner in the same tenant', async () => {
    const store = readStore(dataDir, 'users');
    const co = store.users.find(u => u.username === 'coOwner1');
    const token = await getToken(server.app, 'owner1', 't1');
    const res = await request(server.app).post('/api/v1/users/' + co.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(200);
    const after = readUser(co.id);
    expect(after.status).toBe('disabled');
    // Re-enable so later tests keep a stable t1 owner set.
    await request(server.app).post('/api/v1/users/' + co.id + '/enable').set(authHeader(token));
    const reEnabled = readUser(co.id);
    expect(reEnabled.status).toBe('active');
  });
});

describe('Admin/Manager cannot modify an Owner', () => {
  test('Admin cannot modify an Owner target permissions (403 PERMISSION_DENIED)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_admin_actor', 't3');
    const res = await request(server.app).put('/api/v1/users/' + solo.id + '/permissions').set(authHeader(token)).send({ overrides: { 'users.view': false } });
    // Actor is Admin; target is the sole Owner. The vertical-escalation guard
    // (Only Owner may modify Owner) fires BEFORE the last-Owner check.
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    const after = readUser(solo.id);
    expect(after.tenantPermissions).toBeUndefined();
  });

  test('Manager cannot disable an Owner target (403 PERMISSION_DENIED)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_mgr_actor', 't3');
    const res = await request(server.app).post('/api/v1/users/' + solo.id + '/disable').set(authHeader(token));
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
    const after = readUser(solo.id);
    expect(after.status).not.toBe('disabled');
  });

  test('Manager cannot modify an Owner target permissions (403 PERMISSION_DENIED)', async () => {
    const store = readStore(dataDir, 'users');
    const solo = store.users.find(u => u.username === 'soloOwner');
    const token = await getToken(server.app, 'op_mgr_actor', 't3');
    const res = await request(server.app).put('/api/v1/users/' + solo.id + '/permissions').set(authHeader(token)).send({ overrides: { 'sales.view': true } });
    expect(res.statusCode).toBe(403);
    const after = readUser(solo.id);
    expect(after.tenantPermissions).toBeUndefined();
  });
});