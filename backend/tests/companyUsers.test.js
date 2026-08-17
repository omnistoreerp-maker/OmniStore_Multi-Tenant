'use strict';

// COMPANY-SCOPED USER & RBAC MANAGEMENT — المستخدمون والصلاحيات
//
// Exercises the users management surface with full multi-tenant security:
//   - read access requires users.view for authenticated actors (legacy
//     unauthenticated access preserved)
//   - tenant-scoped create binds the user to the TRUSTED tenant only and
//     rejects every client-supplied tenant claim (tenantId / tenantIds /
//     tenantRoles) that disagrees with the JWT
//   - role assignment is rank-permitted; Owner/Admin creation is gated
//   - branch must belong to the current company
//   - cross-tenant read/update/disable/enable/reset/role/delete are blocked
//     and the other tenant's record always survives
//   - Owner protection, self-protection, last-Owner protection
//   - disabled membership blocks login; enable restores it
//   - the same user can hold different roles per company (tenantRoles)
//   - JWT carries the correct tenantId + effectiveRole per company
//   - audit events never contain passwords/secrets

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

const companies = {
  companies: [
    {
      id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true,
      branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }]
    },
    {
      id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true,
      branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }]
    }
  ]
};

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  return {
    users: [
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-adm', username: 'digiAdmin', password: hash, fullName: 'Digi Admin', role: 'Admin', tenantIds: ['digi'], tenantRoles: { digi: 'Admin' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-mgr', username: 'digiManager', password: hash, fullName: 'Digi Manager', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-cash', username: 'digiCashier', password: hash, fullName: 'Digi Cashier', role: 'Cashier', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-viewer', username: 'digiViewer', password: hash, fullName: 'Digi Viewer', role: 'Viewer', tenantIds: ['digi'], tenantRoles: { digi: 'Viewer' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-nboss', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-ncash', username: 'nileCashier', password: hash, fullName: 'Nile Cashier', role: 'Cashier', tenantIds: ['nile'], tenantRoles: { nile: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      // same user, different role per company (global Cashier)
      { id: 'u-multi', username: 'multiUser', password: hash, fullName: 'Multi User', role: 'Cashier', tenantIds: ['digi', 'nile'], tenantRoles: { digi: 'Manager', nile: 'Viewer' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  };
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', userRecords());
}

describe('Company-scoped user & RBAC management — المستخدمون والصلاحيات', () => {
  let server;
  let dir;
  let ownerToken;   // digiOwner @ digi
  let adminToken;   // digiAdmin @ digi
  let managerToken; // digiManager @ digi
  let cashierToken; // digiCashier @ digi
  let nileToken;    // nileOwner @ nile

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dir = makeTempDataDir('cusers');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    const tok = async (u) => (await login(server, u, PASSWORD, u.startsWith('digi') ? 'digi' : 'nile')).accessToken;
    ownerToken = await tok('digiOwner');
    adminToken = await tok('digiAdmin');
    managerToken = await tok('digiManager');
    cashierToken = await tok('digiCashier');
    nileToken = await tok('nileOwner');
    expect(ownerToken).toBeTruthy();
    expect(adminToken).toBeTruthy();
    expect(managerToken).toBeTruthy();
    expect(cashierToken).toBeTruthy();
    expect(nileToken).toBeTruthy();
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const get = (token, path) => request(server).get(path).set('Authorization', 'Bearer ' + token);
  const post = (token, path, body) => request(server).post(path).set('Authorization', 'Bearer ' + token).send(body || {});
  const put = (token, path, body) => request(server).put(path).set('Authorization', 'Bearer ' + token).send(body || {});
  const del = (token, path) => request(server).delete(path).set('Authorization', 'Bearer ' + token);

  // ---------- RBAC: reads ----------
  test('Owner can list the tenant-scoped user directory', async () => {
    const res = await get(ownerToken, '/api/v1/users');
    expect(res.status).toBe(200);
    const usernames = res.body.data.users.map(u => u.username);
    expect(usernames).toContain('digiOwner');
    expect(usernames).not.toContain('nileCashier');
    expect(usernames).not.toContain('nileOwner');
  });

  test('Admin and Manager can list (they hold users.view)', async () => {
    expect((await get(adminToken, '/api/v1/users')).status).toBe(200);
    expect((await get(managerToken, '/api/v1/users')).status).toBe(200);
  });

  test('Cashier (no users.view) gets 403 on the directory', async () => {
    const res = await get(cashierToken, '/api/v1/users');
    expect(res.status).toBe(403);
    expect((await get(cashierToken, '/api/v1/users/stats')).status).toBe(403);
  });

  test('Viewer (no users.view) gets 403 on the directory', async () => {
    const v = (await login(server, 'digiViewer', PASSWORD, 'digi')).accessToken;
    expect((await get(v, '/api/v1/users')).status).toBe(403);
  });

  // ---------- RBAC: creates ----------
  test('Owner creates a user bound to the current tenant only', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'newmgr', password: 'New#Pass123', fullName: 'New Manager', role: 'Manager', branchId: 'MAIN'
    });
    expect(res.status).toBe(201);
    const u = res.body.data;
    expect(u.username).toBe('newmgr');
    expect(u.role).toBe('Manager');
    expect(u.tenantIds).toEqual(['digi']);
    expect(u.tenantRoles).toEqual({ digi: 'Manager' });
    expect(u.branchId).toBe('MAIN');
    // password never returned
    expect('password' in u).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('New#Pass123');
    // stored record matches (membership stamped server-side)
    const store = readStore(dir, 'users');
    const stored = store.users.find(x => x.id === u.id);
    expect(stored.tenantIds).toEqual(['digi']);
    expect(stored.tenantRoles).toEqual({ digi: 'Manager' });
  });

  test('duplicate username is rejected (409) and nothing changes', async () => {
    const before = readStore(dir, 'users');
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'newmgr', password: 'Other#123', fullName: 'Dup', role: 'Cashier'
    });
    expect(res.status).toBe(409);
    expect(JSON.stringify(readStore(dir, 'users'))).toBe(JSON.stringify(before));
  });

  test('client-supplied foreign tenantIds cannot override the JWT tenant (403)', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'evil1', password: 'Evil#Pass123', fullName: 'Evil', role: 'Cashier', tenantIds: ['nile']
    });
    expect(res.status).toBe(403);
    expect((await get(nileToken, '/api/v1/users')).body.data.users.some(u => u.username === 'evil1')).toBe(false);
  });

  test('client-supplied foreign tenantRoles cannot bind to another tenant (403)', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'evil2', password: 'Evil#Pass123', fullName: 'Evil', role: 'Cashier', tenantRoles: { nile: 'Owner' }
    });
    expect(res.status).toBe(403);
  });

  test('client-supplied body tenantId for another tenant is rejected (403)', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'evil3', password: 'Evil#Pass123', fullName: 'Evil', role: 'Cashier', tenantId: 'nile'
    });
    expect(res.status).toBe(403);
  });

  test('a branch from another company is rejected (400)', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'br1', password: 'Br#Pass123', fullName: 'Br', role: 'Cashier', branchId: 'NILE-MAIN'
    });
    expect(res.status).toBe(400);
    expect(res.body.details && res.body.details.code).toBe('INVALID_BRANCH');
  });

  test('Manager can create a strictly-lower role but never Owner/Admin', async () => {
    const ok = await post(managerToken, '/api/v1/users', {
      username: 'mgrcreates', password: 'Mgr#Pass123', fullName: 'Mgr Creates', role: 'Cashier'
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.tenantIds).toEqual(['digi']);

    const owner = await post(managerToken, '/api/v1/users', {
      username: 'mgrOwn', password: 'Mgr#Pass123', fullName: 'X', role: 'Owner'
    });
    expect(owner.status).toBe(403);

    const admin = await post(managerToken, '/api/v1/users', {
      username: 'mgrAdm', password: 'Mgr#Pass123', fullName: 'X', role: 'Admin'
    });
    expect(admin.status).toBe(403);
  });

  test('Cashier cannot create any user (no users.create)', async () => {
    const res = await post(cashierToken, '/api/v1/users', {
      username: 'cashCreates', password: 'Cash#Pass123', fullName: 'X', role: 'Viewer'
    });
    expect(res.status).toBe(403);
  });

  // ---------- cross-tenant attack surface ----------
  test('cross-tenant getById is indistinguishable from missing (404)', async () => {
    const res = await get(adminToken, '/api/v1/users/u-ncash');
    expect(res.status).toBe(404);
  });

  test('cross-tenant update is blocked and the record survives', async () => {
    const res = await put(adminToken, '/api/v1/users/u-ncash', { fullName: 'Hacked' });
    expect(res.status).toBe(403);
    const store = readStore(dir, 'users');
    const t = store.users.find(u => u.id === 'u-ncash');
    expect(t.fullName).toBe('Nile Cashier');
  });

  test('cross-tenant disable is blocked', async () => {
    const res = await post(adminToken, '/api/v1/users/u-ncash/disable');
    expect(res.status).toBe(403);
  });

  test('cross-tenant enable is blocked', async () => {
    const res = await post(adminToken, '/api/v1/users/u-ncash/enable');
    expect(res.status).toBe(403);
  });

  test('cross-tenant reset-password is blocked', async () => {
    const res = await post(adminToken, '/api/v1/users/u-ncash/reset-password', { newPassword: 'Hacked#123' });
    expect(res.status).toBe(403);
    // Nile user still logs in with the original password.
    const l = await request(server).post('/api/v1/auth/login').send({ username: 'nileCashier', password: PASSWORD, company: 'nile' });
    expect(l.status).toBe(200);
  });

  test('cross-tenant role change is blocked', async () => {
    const res = await put(adminToken, '/api/v1/users/u-ncash', { role: 'Manager' });
    expect(res.status).toBe(403);
  });

  test('cross-tenant delete is blocked and the record survives', async () => {
    const res = await del(adminToken, '/api/v1/users/u-ncash');
    expect(res.status).toBe(403);
    const store = readStore(dir, 'users');
    expect(store.users.some(u => u.id === 'u-ncash')).toBe(true);
  });

  // ---------- owner / self protection ----------
  test('Admin cannot disable an Owner', async () => {
    const res = await post(adminToken, '/api/v1/users/u-owner/disable');
    expect(res.status).toBe(403);
  });

  test('a user cannot disable themselves', async () => {
    const res = await post(adminToken, '/api/v1/users/u-adm/disable');
    expect(res.status).toBe(403);
  });

  test('last-Owner role change is refused (409 LAST_OWNER_PROTECTION)', async () => {
    const res = await put(adminToken, '/api/v1/users/u-owner', { role: 'Manager' });
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('LAST_OWNER_PROTECTION');
  });

  // ---------- disable / enable lifecycle ----------
  test('disabled membership blocks login; enable restores it', async () => {
    const dis = await post(adminToken, '/api/v1/users/u-viewer/disable');
    expect(dis.status).toBe(200);
    const blocked = await request(server).post('/api/v1/auth/login').send({ username: 'digiViewer', password: PASSWORD, company: 'digi' });
    expect(blocked.status).toBe(403);
    expect(blocked.body.details && blocked.body.details.code).toBe('ACCOUNT_DISABLED');

    const en = await post(adminToken, '/api/v1/users/u-viewer/enable');
    expect(en.status).toBe(200);
    const back = await request(server).post('/api/v1/auth/login').send({ username: 'digiViewer', password: PASSWORD, company: 'digi' });
    expect(back.status).toBe(200);
  });

  // ---------- role change takes effect in the auth flow ----------
  test('role change updates the tenant-effective role for the same company', async () => {
    // digiCashier is Cashier in digi.
    const before = await login(server, 'digiCashier', PASSWORD, 'digi');
    expect(before.effectiveRole).toBe('Cashier');

    const res = await put(adminToken, '/api/v1/users/u-cash', { role: 'Manager' });
    expect(res.status).toBe(200);

    // After the change, a fresh login reflects the new effective role.
    const after = await login(server, 'digiCashier', PASSWORD, 'digi');
    expect(after.effectiveRole).toBe('Manager');
    const store = readStore(dir, 'users');
    const t = store.users.find(u => u.id === 'u-cash');
    expect(t.tenantRoles).toEqual({ digi: 'Manager' });
  });

  // ---------- per-company roles for the same user ----------
  test('the same user holds different effective roles per company', async () => {
    const digi = await login(server, 'multiUser', PASSWORD, 'digi');
    expect(digi.effectiveRole).toBe('Manager');
    const nile = await login(server, 'multiUser', PASSWORD, 'nile');
    expect(nile.effectiveRole).toBe('Viewer');

    // JWT carries the correct tenantId per company.
    const claim = (tok) => JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(claim(digi.accessToken).tenantId).toBe('digi');
    expect(claim(nile.accessToken).tenantId).toBe('nile');
  });

  // ---------- tenant identity is server-authoritative ----------
  test('companyId/tenantId sent by the client can never redirect the read scope', async () => {
    const res = await get(adminToken, '/api/v1/users?companyId=nile&tenantId=nile')
      .set('X-Company-Id', 'nile')
      .set('X-Tenant-Id', 'nile');
    expect(res.status).toBe(200);
    const usernames = res.body.data.users.map(u => u.username);
    expect(usernames).not.toContain('nileCashier');
    expect(usernames).toContain('digiOwner');
  });

  // ---------- audit ----------
  test('audit log records USER_CREATED without any password/secret', async () => {
    const store = readStore(dir, 'auditLog');
    const entries = (store && store.entries) || [];
    const created = entries.filter(e => e.action === 'USER_CREATED');
    expect(created.length).toBeGreaterThan(0);
    const raw = JSON.stringify(created);
    expect(raw).not.toContain('New#Pass123');
    expect(raw).not.toContain('password');
  });

  // ---------- no membership leakage ----------
  test('a created user is not added to any other company', async () => {
    const res = await post(ownerToken, '/api/v1/users', {
      username: 'solo', password: 'Solo#Pass123', fullName: 'Solo', role: 'Cashier'
    });
    expect(res.status).toBe(201);
    expect(res.body.data.tenantIds).toEqual(['digi']);
    // Nile's directory does not see them.
    const nileDir = await get(nileToken, '/api/v1/users');
    expect(nileDir.body.data.users.some(u => u.username === 'solo')).toBe(false);
  });
});
