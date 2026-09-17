'use strict';

// PHASE 33 — MASTER CONTROL CENTER (platform scope)
//
// Security matrix:
//   A. Master Admin authentication
//   B. Non-master cannot access platform API
//   C. Tenant Owner cannot access platform API
//   D. Master can list companies
//   E. Master can suspend company
//   F. Suspended company login rejected
//   G. Existing company sessions revoked
//   H. Company activation restores access
//   I. Master can list users across tenants
//   J. Tenant user cannot see global directory
//   K. Master can disable user
//   L. Disabled user cannot login
//   M. Master can enable user
//   N. Force logout works
//   O. Presence heartbeat
//   P. Online/offline timeout
//   Q. Cross-tenant mutation protection still intact
//   R. Master actions audited
//   S. No secrets in audit
//   T. No tokens returned to frontend
//   U. ACTIVE_TENANT_ID tampering cannot affect platform scope (frontend, covered separately)
//   V–X. regression: existing tenant isolation / provisioning / user management (full suite)

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
    { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [{ id: 'MAIN', name: 'Main Branch', code: 'MAIN', isDefault: true, active: true }] },
    { id: 'nile', code: 'NILE', name: 'Nile Electronics', active: true, status: 'ACTIVE', branches: [{ id: 'NILE-MAIN', name: 'Nile Main', code: 'NILE-MAIN', isDefault: true, active: true }] }
  ]
};

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  return {
    users: [
      // platform master (username is in the platform store)
      { id: 'u-master', username: 'master', password: hash, fullName: 'Master Admin', role: 'Viewer', createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      // tenant owner (MUST NOT be a platform admin)
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-mgr', username: 'digiManager', password: hash, fullName: 'Digi Manager', role: 'Manager', tenantIds: ['digi'], tenantRoles: { digi: 'Manager' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-cash', username: 'digiCashier', password: hash, fullName: 'Digi Cashier', role: 'Cashier', tenantIds: ['digi'], tenantRoles: { digi: 'Cashier' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 },
      { id: 'u-nboss', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], tenantRoles: { nile: 'Owner' }, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 }
    ]
  };
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', userRecords());
  seed(dir, 'platformAdmins', { admins: [{ username: 'master', platformRole: 'MASTER_OWNER', createdAt: new Date().toISOString() }] });
  seed(dir, 'presence', { entries: [] });
}

describe('Phase 33 — Master Control Center (platform scope)', () => {
  let server;
  let dir;
  let masterToken;   // platform MASTER_OWNER (role: Viewer at tenant level — platform scope is separate)
  let ownerToken;    // tenant Owner @ digi — must NOT reach platform API
  let cashierToken;  // tenant Cashier @ digi
  let nileToken;     // tenant Owner @ nile

  beforeAll(async () => {
    jest.resetModules();
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    process.env.AUTH_REQUIRED = 'true';
    dir = makeTempDataDir('pmaster');
    tempDirs.push(dir);
    seedAll(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    const tok = async (u, c) => (await login(server, u, PASSWORD, c)).accessToken;
    masterToken = await tok('master', 'digi'); // master logs in as a tenant member but holds platform role
    ownerToken = await tok('digiOwner', 'digi');
    cashierToken = await tok('digiCashier', 'digi');
    nileToken = await tok('nileOwner', 'nile');
    expect(masterToken).toBeTruthy();
    expect(ownerToken).toBeTruthy();
    expect(cashierToken).toBeTruthy();
    expect(nileToken).toBeTruthy();
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  const api = (token) => ({
    get: (path) => request(server).get(path).set('Authorization', 'Bearer ' + token),
    post: (path, body) => request(server).post(path).set('Authorization', 'Bearer ' + token).send(body || {}),
    put: (path, body) => request(server).put(path).set('Authorization', 'Bearer ' + token).send(body || {}),
    del: (path) => request(server).delete(path).set('Authorization', 'Bearer ' + token)
  });
  // Lazily read the tokens: closures over the `let` bindings see the values
  // assigned in beforeAll (capturing them eagerly would freeze `undefined`).
  const M = {
    get: (p) => api(masterToken).get(p),
    post: (p, b) => api(masterToken).post(p, b),
    put: (p, b) => api(masterToken).put(p, b),
    del: (p) => api(masterToken).del(p)
  };
  const O = {
    get: (p) => api(ownerToken).get(p),
    post: (p, b) => api(ownerToken).post(p, b),
    put: (p, b) => api(ownerToken).put(p, b),
    del: (p) => api(ownerToken).del(p)
  };
  const C = {
    get: (p) => api(cashierToken).get(p),
    post: (p, b) => api(cashierToken).post(p, b),
    put: (p, b) => api(cashierToken).put(p, b),
    del: (p) => api(cashierToken).del(p)
  };

  // ---------- A/B/C: platform authentication ----------
  test('A: Master Admin reaches the platform API (me + summary)', async () => {
    const me = await M.get('/api/v1/platform/me');
    expect(me.status).toBe(200);
    expect(me.body.data.platformRole).toBe('MASTER_OWNER');
    const sum = await M.get('/api/v1/platform/summary');
    expect(sum.status).toBe(200);
    expect(sum.body.data.companies.total).toBe(2);
  });

  test('B: a non-platform user gets 403 on platform API', async () => {
    const res = await C.get('/api/v1/platform/companies');
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  test('C: a tenant Owner cannot access platform API', async () => {
    const res = await O.get('/api/v1/platform/companies');
    expect(res.status).toBe(403);
    const me = await O.get('/api/v1/platform/me');
    expect(me.status).toBe(404);
  });

  test('anonymous gets 401 on platform API', async () => {
    const res = await request(server).get('/api/v1/platform/companies');
    expect(res.status).toBe(401);
  });

  // ---------- D/E/F/G/H: company management + suspension ----------
  test('D: Master lists companies with derived stats', async () => {
    const res = await M.get('/api/v1/platform/companies');
    expect(res.status).toBe(200);
    const list = res.body.data.companies;
    expect(list.length).toBe(2);
    const digi = list.find(c => c.id === 'digi');
    expect(digi.status).toBe('ACTIVE');
    expect(digi.userCount).toBe(3); // owner + manager + cashier
    expect(digi.branchCount).toBe(1);
  });

  test('E: Master suspends a company', async () => {
    const res = await M.post('/api/v1/platform/companies/nile/suspend');
    expect(res.status).toBe(200);
    expect(res.body.data.company.status).toBe('SUSPENDED');
    const store = readStore(dir, 'companies');
    const arr = store.companies || store;
    const nile = arr.find(c => c.id === 'nile');
    expect(nile.status).toBe('SUSPENDED');
    expect(nile.active).toBe(false);
  });

  test('F: login into a suspended company is rejected (403 COMPANY_SUSPENDED)', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({ username: 'nileOwner', password: PASSWORD, company: 'nile' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('COMPANY_SUSPENDED');
  });

  test('G: existing sessions of the suspended company are revoked', async () => {
    // nileOwner's token was minted BEFORE the suspension — tokenVersion bump
    // invalidates it on every protected route (companies/active is public,
    // so probe a protected tenant route instead).
    const res = await api(nileToken).get('/api/v1/users');
    expect([401, 403]).toContain(res.status);
  });

  test('H: activation restores access', async () => {
    const res = await M.post('/api/v1/platform/companies/nile/activate');
    expect(res.status).toBe(200);
    expect(res.body.data.company.status).toBe('ACTIVE');
    const fresh = await login(server, 'nileOwner', PASSWORD, 'nile');
    expect(fresh.accessToken).toBeTruthy();
    const dir2 = await api(fresh.accessToken).get('/api/v1/users');
    expect(dir2.status).toBe(200);
  });

  // ---------- I/J: global user directory ----------
  test('I: Master sees users across tenants', async () => {
    const res = await M.get('/api/v1/platform/users');
    expect(res.status).toBe(200);
    const usernames = res.body.data.users.map(u => u.username);
    expect(usernames).toContain('digiOwner');
    expect(usernames).toContain('nileOwner');
    expect(usernames).toContain('master');
    const nileUser = res.body.data.users.find(u => u.username === 'nileOwner');
    expect(nileUser.companies.some(c => c.tenantId === 'nile')).toBe(true);
    // no password/hash in the payload
    expect(JSON.stringify(res.body)).not.toContain('$2a$');
    expect(JSON.stringify(res.body)).not.toContain('password');
  });

  test('J: a tenant user cannot see the global directory via /users (tenant-scoped)', async () => {
    const res = await O.get('/api/v1/users');
    expect(res.status).toBe(200);
    const usernames = res.body.data.users.map(u => u.username);
    expect(usernames).not.toContain('nileOwner');
  });

  // ---------- K/L/M/N: platform user lifecycle ----------
  test('K: Master disables a user in another tenant', async () => {
    const res = await M.post('/api/v1/platform/users/u-cash/disable');
    expect(res.status).toBe(200);
    expect(res.body.data.user.status).toBe('disabled');
  });

  test('L: the disabled user cannot login', async () => {
    const res = await request(server).post('/api/v1/auth/login').send({ username: 'digiCashier', password: PASSWORD, company: 'digi' });
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('ACCOUNT_DISABLED');
  });

  test('M: Master enables the user and login works again', async () => {
    await M.post('/api/v1/platform/users/u-cash/enable');
    const res = await request(server).post('/api/v1/auth/login').send({ username: 'digiCashier', password: PASSWORD, company: 'digi' });
    expect(res.status).toBe(200);
  });

  test('N: force logout invalidates every outstanding token', async () => {
    const before = await login(server, 'digiManager', PASSWORD, 'digi');
    const res = await M.post('/api/v1/platform/users/u-mgr/force-logout');
    expect(res.status).toBe(200);
    expect(res.body.data.forced).toBe(true);
    const still = await api(before.accessToken).get('/api/v1/users');
    expect([401, 403]).toContain(still.status);
  });

  test('N2: Master cannot disable the last Owner of a tenant', async () => {
    const res = await M.post('/api/v1/platform/users/u-nboss/disable');
    expect(res.status).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('LAST_OWNER_PROTECTION');
  });

  // ---------- O/P: presence ----------
  test('O: heartbeat records server-authoritative presence', async () => {
    // fresh login — the beforeAll cashier token was revoked by K/M (tokenVersion bump)
    const fresh = await login(server, 'digiCashier', PASSWORD, 'digi');
    const hb = await api(fresh.accessToken).post('/api/v1/platform/presence/heartbeat', { sessionId: 'sess-1', branchId: 'MAIN' });
    expect(hb.status).toBe(200);
    const list = await M.get('/api/v1/platform/presence');
    expect(list.status).toBe(200);
    const entry = list.body.data.presence.find(p => p.userId === 'u-cash');
    expect(entry).toBeTruthy();
    expect(entry.online).toBe(true);
    expect(entry.sessionId).toBe('sess-1');
  });

  test('P: a stale heartbeat counts as offline after the timeout', async () => {
    const store = readStore(dir, 'presence');
    const entries = store.entries || [];
    const now = Date.now();
    // simulate a heartbeat 10 minutes old
    store.entries = entries.map(e => e.userId === 'u-cash'
      ? { ...e, lastSeenAt: new Date(now - 10 * 60 * 1000).toISOString() }
      : e);
    fs.writeFileSync(require('path').join(dir, 'presence.json'), JSON.stringify(store, null, 2), 'utf-8');
    const list = await M.get('/api/v1/platform/presence');
    const entry = list.body.data.presence.find(p => p.userId === 'u-cash');
    expect(entry.online).toBe(false);
  });

  // ---------- Q: tenant isolation intact ----------
  test('Q: cross-tenant mutation protection is intact for tenant admins', async () => {
    // digi Owner cannot touch nile users via the tenant surface.
    const res = await O.put('/api/v1/users/u-nboss', { fullName: 'Hacked' });
    expect(res.status).toBe(403);
    const store = readStore(dir, 'users');
    expect(store.users.find(u => u.id === 'u-nboss').fullName).toBe('Nile Owner');
  });

  // ---------- licenses ----------
  test('license: Master assigns a license; values are stored and returned', async () => {
    const res = await M.put('/api/v1/platform/licenses', {
      tenantId: 'digi', plan: 'PROFESSIONAL', status: 'ACTIVE',
      licenseStart: '2026-01-01T00:00:00.000Z', licenseEnd: '2027-01-01T00:00:00.000Z',
      maxUsers: 50, maxBranches: 5
    });
    expect(res.status).toBe(200);
    expect(res.body.data.license.plan).toBe('PROFESSIONAL');
    const list = await M.get('/api/v1/platform/licenses');
    const lic = list.body.data.licenses.find(l => l.tenantId === 'digi');
    expect(lic.maxUsers).toBe(50);
    // company list now reflects the license
    const comps = await M.get('/api/v1/platform/companies');
    expect(comps.body.data.companies.find(c => c.id === 'digi').plan).toBe('PROFESSIONAL');
  });

  // ---------- integrations: secrets never leave the server ----------
  test('T: integration tokens are stored masked and never returned', async () => {
    const res = await M.put('/api/v1/platform/integrations', {
      tenantId: 'digi', provider: 'github', token: 'ghp_super-secret-value-1234567890'
    });
    expect(res.status).toBe(200);
    expect(res.body.data.integration.masked).toContain('••••');
    expect(res.body.data.integration.masked).toContain('7890');
    expect(JSON.stringify(res.body)).not.toContain('ghp_super-secret-value-1234567890');

    const list = await M.get('/api/v1/platform/integrations');
    expect(JSON.stringify(list.body)).not.toContain('ghp_super-secret-value-1234567890');
    // The store itself must never contain the full token either.
    const store = readStore(dir, 'platformIntegrations');
    expect(JSON.stringify(store)).not.toContain('ghp_super-secret-value-1234567890');
  });

  // ---------- R/S: audit ----------
  test('R: master actions are audited with PLATFORM_* events', async () => {
    const res = await M.get('/api/v1/platform/audit');
    expect(res.status).toBe(200);
    const actions = res.body.data.entries.map(e => e.action);
    expect(actions).toContain('PLATFORM_COMPANY_SUSPENDED');
    expect(actions).toContain('PLATFORM_COMPANY_ACTIVATED');
    expect(actions).toContain('PLATFORM_USER_DISABLED');
    expect(actions).toContain('PLATFORM_USER_FORCE_LOGOUT');
    expect(actions).toContain('PLATFORM_LICENSE_UPDATED');
    expect(actions).toContain('PLATFORM_INTEGRATION_UPDATED');
  });

  test('S: platform audit contains no secrets', async () => {
    const res = await M.get('/api/v1/platform/audit');
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('ghp_super-secret-value-1234567890');
    expect(raw).not.toContain('Pass#123');
    expect(raw).not.toContain('password');
  });

  // ---------- platform admins management ----------
  test('Master can grant and revoke a platform admin', async () => {
    const grant = await M.post('/api/v1/platform/admins', { username: 'digiOwner', platformRole: 'PLATFORM_ADMIN' });
    expect(grant.status).toBe(200);
    const me = await O.get('/api/v1/platform/me');
    expect(me.status).toBe(200);
    expect(me.body.data.platformRole).toBe('PLATFORM_ADMIN');

    const revoke = await M.del('/api/v1/platform/admins/digiOwner');
    expect(revoke.status).toBe(200);
    const me2 = await O.get('/api/v1/platform/me');
    expect(me2.status).toBe(404);
  });
});
