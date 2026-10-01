'use strict';

// Platform Control Center — RBAC, isolation, audit and developer/data-entry
// surfaces.
//
// Security matrix covered:
//   A. Unauthenticated      -> 401 on every control-center endpoint
//   B. Tenant user          -> 403 (platform scope separate from tenant scope)
//   C. MASTER_OWNER         -> allowed on every surface
//   D. PLATFORM_ADMIN       -> operations only; no diagnostics / matrix / mutation
//   E. DEVELOPER            -> diagnostics + dashboard, never team/role mgmt
//   F. DATA_ENTRY           -> platform content only, never team/security
//   G. Role spoofing        -> client-supplied roles/permissions ignored
//   H. Privilege escalation -> non-owner cannot grant/revoke or self-promote
//   I. Disabled member      -> loses platform access immediately
//   J. Last-owner guard     -> last MASTER_OWNER cannot be demoted/removed
//   K. Audit                -> team + catalog mutations recorded, no secrets
//   L. Diagnostics          -> never leaks secrets/env material

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const tempDirs = [];

const companies = {
  companies: [
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }] },
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true, status: 'ACTIVE', branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }] }
  ]
};

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  return {
    users: [
      // Platform team (server-side platform roles live in platformAdmins.json)
      { id: 'u-master', username: 'master', password: hash, fullName: 'Master Owner', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-padmin', username: 'padmin', password: hash, fullName: 'Ops Admin', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-dev', username: 'dev', password: hash, fullName: 'Platform Dev', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-entry', username: 'entry', password: hash, fullName: 'Data Entry', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      // Tenant users — MUST NOT reach platform scope
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-cash', username: 'digiCashier', password: hash, fullName: 'Digi Cashier', role: 'Cashier', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  };
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', userRecords());
  seed(dir, 'platformAdmins', {
    admins: [
      { username: 'master', platformRole: 'MASTER_OWNER', status: 'active', createdAt: new Date().toISOString() },
      { username: 'padmin', platformRole: 'PLATFORM_ADMIN', status: 'active', createdAt: new Date().toISOString() },
      { username: 'dev', platformRole: 'DEVELOPER', status: 'active', createdAt: new Date().toISOString() },
      { username: 'entry', platformRole: 'DATA_ENTRY', status: 'active', createdAt: new Date().toISOString() }
    ]
  });
  seed(dir, 'presence', { entries: [] });
  seed(dir, 'errors', { issues: [] });
}

const CC = '/api/v1/platform/control-center';

function client(app, token) {
  const auth = token ? { Authorization: 'Bearer ' + token } : {};
  return {
    get: (p) => request(app).get(p).set(auth),
    post: (p, body) => request(app).post(p).set(auth).send(body || {}),
    patch: (p, body) => request(app).patch(p).set(auth).send(body || {}),
    del: (p) => request(app).delete(p).set(auth)
  };
}

describe('Platform Control Center — role-based access control', () => {
  let app;
  let dir;
  let M, A, D, E, O, C, ANON, BAD;

  beforeAll(async () => {
    dir = makeTempDataDir('platform-cc');
    tempDirs.push(dir);
    seedAll(dir);
    const server = await startServer(dir, { RATE_LIMIT_MAX: '10000' });
    app = server.app;
    M = client(app, (await login(app, 'master', PASSWORD)).accessToken);
    A = client(app, (await login(app, 'padmin', PASSWORD)).accessToken);
    D = client(app, (await login(app, 'dev', PASSWORD)).accessToken);
    E = client(app, (await login(app, 'entry', PASSWORD)).accessToken);
    O = client(app, (await login(app, 'digiOwner', PASSWORD, 'digi')).accessToken);
    C = client(app, (await login(app, 'digiCashier', PASSWORD, 'digi')).accessToken);
    ANON = client(app, null);
    BAD = client(app, 'not-a-real-jwt-token');
  });

  test('A: unauthenticated -> 401 on every control-center endpoint', async () => {
    const eps = ['/access', '/dashboard', '/matrix', '/diagnostics', '/diagnostics/errors', '/catalog'];
    for (const ep of eps) {
      const res = await ANON.get(CC + ep);
      expect(res.status).toBe(401);
    }
    expect((await ANON.post(CC + '/catalog', { title: 'x' })).status).toBe(401);
    expect((await ANON.get('/api/v1/platform/admins')).status).toBe(401);
  });

  test('A: malformed bearer token is treated as unauthenticated (401)', async () => {
    expect((await BAD.get(CC + '/dashboard')).status).toBe(401);
    expect((await BAD.get('/api/v1/platform/admins')).status).toBe(401);
  });

  test('B: tenant Owner AND Cashier are DENIED every control-center endpoint (403)', async () => {
    for (const who of [O, C]) {
      for (const ep of ['/access', '/dashboard', '/matrix', '/diagnostics', '/diagnostics/errors', '/catalog']) {
        expect((await who.get(CC + ep)).status).toBe(403);
      }
      expect((await who.post(CC + '/catalog', { title: 'x' })).status).toBe(403);
    }
  });

  test('B: tenant users are DENIED the legacy platform surfaces too', async () => {
    for (const who of [O, C]) {
      for (const ep of ['/api/v1/platform/summary', '/api/v1/platform/companies', '/api/v1/platform/admins']) {
        expect([403, 404]).toContain((await who.get(ep)).status);
      }
    }
  });

  test('C: MASTER_OWNER is allowed on every surface', async () => {
    for (const ep of ['/access', '/dashboard', '/matrix', '/diagnostics', '/diagnostics/errors', '/catalog']) {
      expect((await M.get(CC + ep)).status).toBe(200);
    }
    expect((await M.get('/api/v1/platform/admins')).status).toBe(200);
    expect((await M.get('/api/v1/platform/summary')).status).toBe(200);
  });

  test('C: /access returns the server-resolved role + permissions', async () => {
    const res = await M.get(CC + '/access');
    expect(res.status).toBe(200);
    expect(res.body.data.platformRole).toBe('MASTER_OWNER');
    expect(res.body.data.permissions).toEqual(['*']);
    expect(res.body.data.fullAccess).toBe(true);
  });

  test('D: PLATFORM_ADMIN -> operations only (no diagnostics/matrix/team mutation)', async () => {
    expect((await A.get(CC + '/dashboard')).status).toBe(200);
    expect((await A.get(CC + '/access')).status).toBe(200);
    expect((await A.get('/api/v1/platform/admins')).status).toBe(200);
    expect((await A.get('/api/v1/platform/summary')).status).toBe(200);

    expect((await A.get(CC + '/diagnostics')).status).toBe(403);
    expect((await A.get(CC + '/diagnostics/errors')).status).toBe(403);
    expect((await A.get(CC + '/matrix')).status).toBe(403);
    expect((await A.post('/api/v1/platform/admins', { username: 'x', platformRole: 'DEVELOPER' })).status).toBe(403);
    expect((await A.patch('/api/v1/platform/admins/dev', { platformRole: 'DATA_ENTRY' })).status).toBe(403);
    expect((await A.del('/api/v1/platform/admins/dev')).status).toBe(403);
    expect((await A.post(CC + '/catalog', { title: 'x' })).status).toBe(403);
  });

  test('E: DEVELOPER -> diagnostics + dashboard, never team/role management', async () => {
    expect((await D.get(CC + '/access')).status).toBe(200);
    expect((await D.get(CC + '/dashboard')).status).toBe(200);
    expect((await D.get(CC + '/diagnostics')).status).toBe(200);
    expect((await D.get(CC + '/diagnostics/errors')).status).toBe(200);

    expect((await D.get('/api/v1/platform/admins')).status).toBe(403);
    expect((await D.post('/api/v1/platform/admins', { username: 'x', platformRole: 'MASTER_OWNER' })).status).toBe(403);
    expect((await D.get(CC + '/matrix')).status).toBe(403);
    expect((await D.post(CC + '/catalog', { title: 'x' })).status).toBe(403);
    // Legacy broad admin surface stays closed for DEVELOPER
    expect((await D.get('/api/v1/platform/companies')).status).toBe(403);
    expect((await D.post('/api/v1/platform/companies/digi/suspend')).status).toBe(403);
    // …but the permitted technical log IS available to DEVELOPER.
    expect((await D.get('/api/v1/platform/audit')).status).toBe(200);
  });

  test('F: DATA_ENTRY -> platform content catalog only, never team/security', async () => {
    expect((await E.get(CC + '/access')).status).toBe(200);
    expect((await E.get(CC + '/dashboard')).status).toBe(200);
    expect((await E.get(CC + '/catalog')).status).toBe(200);

    expect((await E.get('/api/v1/platform/admins')).status).toBe(403);
    expect((await E.post('/api/v1/platform/admins', { username: 'entry', platformRole: 'MASTER_OWNER' })).status).toBe(403);
    expect((await E.patch('/api/v1/platform/admins/entry', { platformRole: 'MASTER_OWNER' })).status).toBe(403);
    expect((await E.get(CC + '/diagnostics')).status).toBe(403);
    expect((await E.get(CC + '/matrix')).status).toBe(403);
    expect((await E.get('/api/v1/platform/companies')).status).toBe(403);
    expect((await E.get('/api/v1/platform/users')).status).toBe(403);
    expect((await E.get('/api/v1/platform/licenses')).status).toBe(403);
    expect((await E.get('/api/v1/platform/audit')).status).toBe(403);
  });

  test('G: role spoofing — client-supplied platform role in body/query/header is ignored', async () => {
    // The server derives the platform role from the platform store by the
    // authenticated username only. Injecting a role in the body changes nothing.
    const spoof = await E.post(CC + '/catalog', {
      title: 'spoof',
      platformRole: 'MASTER_OWNER',
      role: 'MASTER_OWNER',
      permissions: ['platform.team.manage', 'platform.roles.manage']
    });
    expect(spoof.status).toBe(201); // DATA_ENTRY legitimately has catalog.create
    expect(spoof.body.data.entry.createdBy).toBe('entry');

    // Tampering through headers/query can never make a denied call succeed.
    const asOwnerViaQuery = await request(app)
      .get(CC + '/diagnostics?platformRole=MASTER_OWNER')
      .set('Authorization', 'Bearer ' + (await login(app, 'entry', PASSWORD)).accessToken)
      .set('x-platform-role', 'MASTER_OWNER')
      .set('x-role', 'MASTER_OWNER');
    expect(asOwnerViaQuery.status).toBe(403);

    // Self-promotion attempt via the team endpoint is denied outright.
    const escalate = await E.patch('/api/v1/platform/admins/entry', {
      platformRole: 'MASTER_OWNER',
      permissions: ['platform.roles.manage']
    });
    expect(escalate.status).toBe(403);
    const store = readStore(dir, 'platformAdmins');
    expect(store.admins.find(a => a.username === 'entry').platformRole).toBe('DATA_ENTRY');
    expect(store.admins.find(a => a.username === 'entry').permissions).toBeUndefined();
  });

  test('H: privilege escalation — only MASTER_OWNER may grant/revoke platform members', async () => {
    // DEVELOPER / DATA_ENTRY / tenant users already denied above; PLATFORM_ADMIN too.
    const before = readStore(dir, 'platformAdmins').admins.length;
    const denied = await A.post('/api/v1/platform/admins', { username: 'padmin', platformRole: 'MASTER_OWNER' });
    expect(denied.status).toBe(403);
    expect(readStore(dir, 'platformAdmins').admins.length).toBe(before);
  });

  test('I: MASTER_OWNER adds a team member; the store is updated server-side', async () => {
    const res = await M.post('/api/v1/platform/admins', {
      username: 'newdev', platformRole: 'DEVELOPER', displayName: 'New Dev'
    });
    expect(res.status).toBe(200);
    expect(res.body.data.member.platformRole).toBe('DEVELOPER');
    const store = readStore(dir, 'platformAdmins');
    expect(store.admins.find(a => a.username === 'newdev').status).toBe('active');
    expect(store.admins.find(a => a.username === 'newdev').addedBy).toBe('master');

    const list = await M.get('/api/v1/platform/admins');
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body.data.admins)).toBe(true);
    expect(list.body.data.admins.some(a => a.username === 'newdev')).toBe(true);
    // Effective permissions are computed server-side from the role.
    const added = list.body.data.team.find(a => a.username === 'newdev');
    expect(added.effectivePermissions).toContain('platform.diagnostics.view');
    expect(added.effectivePermissions).not.toContain('platform.team.manage');
  });

  test('I: duplicate member + invalid role are rejected without writing', async () => {
    const before = readStore(dir, 'platformAdmins').admins.length;
    const dup = await M.post('/api/v1/platform/admins', { username: 'newdev', platformRole: 'DEVELOPER' });
    expect(dup.status).toBe(400);
    const bad = await M.post('/api/v1/platform/admins', { username: 'someone', platformRole: 'SUPERUSER' });
    expect(bad.status).toBe(400);
    expect(readStore(dir, 'platformAdmins').admins.length).toBe(before);
  });

  test('J: last-owner guard — the last MASTER_OWNER cannot be demoted, disabled or removed', async () => {
    const demote = await M.patch('/api/v1/platform/admins/master', { platformRole: 'PLATFORM_ADMIN' });
    expect(demote.status).toBe(409);
    const disable = await M.patch('/api/v1/platform/admins/master', { status: 'disabled' });
    expect(disable.status).toBe(409);
    const remove = await M.del('/api/v1/platform/admins/master');
    expect(remove.status).toBe(409);
    const store = readStore(dir, 'platformAdmins').admins;
    expect(store.find(a => a.username === 'master').platformRole).toBe('MASTER_OWNER');
    expect(store.find(a => a.username === 'master').status).toBe('active');
  });

  test('I/K: a DISABLED team member loses platform access immediately', async () => {
    expect((await E.get(CC + '/dashboard')).status).toBe(200);
    const dis = await M.patch('/api/v1/platform/admins/entry', { status: 'disabled' });
    expect(dis.status).toBe(200);
    // Same still-valid JWT, but the server no longer resolves a platform role.
    expect((await E.get(CC + '/dashboard')).status).toBe(403);
    expect((await E.get(CC + '/access')).status).toBe(403);
    expect((await E.get('/api/v1/platform/admins')).status).toBe(403);

    const re = await M.patch('/api/v1/platform/admins/entry', { status: 'active' });
    expect(re.status).toBe(200);
    expect((await E.get(CC + '/dashboard')).status).toBe(200);
  });

  test('K: team + catalog mutations are audited (who/what/when/target/result)', async () => {
    const res = await M.get('/api/v1/platform/audit');
    expect(res.status).toBe(200);
    const actions = res.body.data.entries.map(e => e.action);
    expect(actions).toContain('PLATFORM_TEAM_MEMBER_ADDED');
    expect(actions).toContain('PLATFORM_TEAM_MEMBER_UPDATED');
    expect(actions).toContain('PLATFORM_CATALOG_ENTRY_CREATED');

    const added = res.body.data.entries.find(e => e.action === 'PLATFORM_TEAM_MEMBER_ADDED');
    expect(added.changes.actor).toBe('master');
    expect(added.changes.target).toBe('newdev');
    expect(added.changes.result).toBe('added');
    expect(added.resourceId).toBe('newdev');
  });

  test('K: audit stores no passwords or tokens', async () => {
    const res = await M.get('/api/v1/platform/audit');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(PASSWORD);
    expect(raw).not.toContain('not-a-real-jwt-token');
    expect(raw.toLowerCase()).not.toContain('password":');
  });

  test('L: developer diagnostics expose NO secrets/env material', async () => {
    const res = await D.get(CC + '/diagnostics');
    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('test-jwt-secret-for-jest-suites'); // JWT_SECRET
    expect(raw).not.toContain(PASSWORD);
    expect(raw.toLowerCase()).not.toContain('jwtsecret');
    expect(raw.toLowerCase()).not.toContain('passwordhash');
    expect(res.body.data.health).toBeTruthy();
    expect(res.body.data.build).toBeTruthy();
    expect(res.body.data.build.version).toBeTruthy();
    // Error summaries are message-only — no stack traces.
    expect(Array.isArray(res.body.data.errors.recent)).toBe(true);
    for (const e of res.body.data.errors.recent) expect(e).not.toHaveProperty('stack');
  });

  test('DASHBOARD: reports real numbers (no fabricated metrics)', async () => {
    const res = await M.get(CC + '/dashboard');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.businesses.total).toBe(2);        // seeded companies
    expect(d.users.total).toBeGreaterThanOrEqual(6);
    expect(typeof d.orders).toBe('object');
    expect(d.orders).toHaveProperty('today');
    expect(Array.isArray(d.activeServices)).toBe(true);
    expect(typeof d.security.auditEntries).toBe('number');
    expect(d.system.status).toBe('ok');
    expect(typeof d.generatedAt).toBe('string');
  });

  test('F: DATA_ENTRY can create + update platform content (catalog CRUD)', async () => {
    const created = await E.post(CC + '/catalog', { title: 'Feature A', type: 'feature', body: 'Body A' });
    expect(created.status).toBe(201);
    const id = created.body.data.entry.id;
    expect(created.body.data.entry.createdBy).toBe('entry');

    const updated = await E.patch(CC + '/catalog/' + id, { status: 'published' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.entry.status).toBe('published');
    expect(updated.body.data.entry.updatedBy).toBe('entry');

    const list = await E.get(CC + '/catalog');
    expect(list.status).toBe(200);
    expect(list.body.data.entries.some(e => e.id === id)).toBe(true);

    // Validation: unknown type and missing target are real errors, not writes.
    const badType = await E.post(CC + '/catalog', { title: 'X', type: 'malware' });
    expect(badType.status).toBe(400);
    const missing = await E.patch(CC + '/catalog/does-not-exist', { title: 'y' });
    expect(missing.status).toBe(404);

    // DEVELOPER has no catalog mutation permission.
    expect((await D.patch(CC + '/catalog/' + id, { title: 'hijack' })).status).toBe(403);
  });

  test('TENANT: tenantId in query/body cannot influence platform scope', async () => {
    const dash = await M.get(CC + '/dashboard?tenantId=digi');
    expect(dash.status).toBe(200);
    const created = await E.post(CC + '/catalog', { title: 'Tenant spoof', tenantId: 'digi', tenant_id: 'nile' });
    expect(created.status).toBe(201);
    const store = readStore(dir, 'platformContent');
    const entry = store.entries.find(e => e.id === created.body.data.entry.id);
    expect(entry).toBeTruthy();
    expect(entry.tenantId).toBeUndefined();
    expect(entry.tenant_id).toBeUndefined();
  });

  test('MATRIX: only MASTER_OWNER holds team/role/security control', async () => {
    const res = await M.get(CC + '/matrix');
    expect(res.status).toBe(200);
    const roles = res.body.data.matrix;
    expect(roles.map(r => r.role).sort()).toEqual(
      ['DATA_ENTRY', 'DEVELOPER', 'MASTER_OWNER', 'PLATFORM_ADMIN'].sort()
    );
    const byRole = Object.fromEntries(roles.map(r => [r.role, r.permissions]));
    expect(byRole.MASTER_OWNER).toEqual(['*']);
    expect(byRole.DATA_ENTRY).not.toContain('platform.team.manage');
    expect(byRole.DATA_ENTRY).not.toContain('platform.roles.manage');
    expect(byRole.DATA_ENTRY).not.toContain('platform.security.manage');
    expect(byRole.DATA_ENTRY).not.toContain('platform.users.manage');
    expect(byRole.DEVELOPER).not.toContain('platform.team.manage');
    expect(byRole.DEVELOPER).not.toContain('platform.roles.manage');
    expect(byRole.DEVELOPER).not.toContain('platform.security.manage');
    expect(byRole.PLATFORM_ADMIN).not.toContain('platform.roles.manage');
    expect(byRole.PLATFORM_ADMIN).not.toContain('platform.security.manage');
    expect(byRole.DATA_ENTRY).toEqual(expect.arrayContaining(['catalog.read', 'catalog.create', 'catalog.update']));
  });
});

registerCleanup(() => [], () => tempDirs);


