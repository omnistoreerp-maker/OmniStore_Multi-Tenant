'use strict';

// Phase C — Tenant-scoped authorization: effective roles/permissions resolved
// per trusted tenant, and tamper vectors proving the trusted tenant is ONLY the
// server-side bound tenant (token claim / reconstructed context) — never header,
// query, or a forged JWT role claim.

const express = require('express');
const request = require('supertest');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP
};

const companies = [
  { id: 'digitronics', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true },
  { id: 'omni', name: 'Omni Components', active: true }
];

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  const s = await startServer();
  server = s;
  dataDir = s.dataDir;
  seed(dataDir, 'companies', companies);

  await mkUser('a', { role: 'Admin', tenantIds: ['digitronics', 'nile', 'omni'], tenantRoles: { digitronics: 'Admin', nile: 'Manager', omni: 'Cashier' } });
  await mkUser('boss', { role: 'Owner', tenantIds: ['digitronics', 'nile'], tenantRoles: { digitronics: 'Owner', nile: 'Cashier' } });
  await mkUser('kit', { role: 'Admin', tenantIds: ['nile'], tenantRoles: { nile: 'Cashier' } });
  await mkUser('xy', { role: 'Cashier', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Admin' } });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function mkUser(username, extra) {
  const res = await request(server.app).post('/api/v1/users').send({ username, password: 'Pass#123', ...extra });
  if (res.statusCode !== 201) throw new Error(`createUser(${username}) failed ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function loginAs(username, company) {
  const res = await request(server.app)
    .post('/api/v1/auth/login')
    .send(company ? { username, password: 'Pass#123', company } : { username, password: 'Pass#123' });
  if (res.statusCode !== 200) throw new Error(`login(${username}) failed ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// 1. E2E — full server, tenant features ON
// ---------------------------------------------------------------------------
describe('Phase C — tenant-scoped /auth/me enrichment', () => {
  test('Admin acting in digitronics sees the full effective permission set', async () => {
    const session = await loginAs('a', 'digitronics');
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.effectiveRole).toBe('Admin');
    expect(res.body.data.effectivePermissions).toEqual(expect.arrayContaining(['sales.delete', 'users.permissions.view']));
  });

  test('Manager acting in nile gets tenant-scoped permissions (no privileged user ops)', async () => {
    const session = await loginAs('a', 'nile');
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.effectiveRole).toBe('Manager');
    expect(res.body.data.effectivePermissions).toEqual(expect.arrayContaining(['sales.edit']));
    expect(res.body.data.effectivePermissions).toContain('users.edit');
    expect(res.body.data.effectivePermissions).not.toContain('users.permissions.view');
    expect(res.body.data.effectivePermissions).not.toContain('users.password.reset');
    expect(res.body.data.effectivePermissions).not.toContain('users.enable');
  });

  test('Owner acting in digitronics retains Owner access', async () => {
    const session = await loginAs('boss', 'digitronics');
    const me = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(me.body.data.effectiveRole).toBe('Owner');
    const reg = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(reg.statusCode).toBe(200);
  });

  test('a tenant override downgrades a global Owner and removes the bypass', async () => {
    const session = await loginAs('boss', 'nile');
    const me = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(me.body.data.effectiveRole).toBe('Cashier');
    expect(me.body.data.effectivePermissions).toContain('sales.view');
    expect(me.body.data.effectivePermissions).not.toContain('sales.delete');
    const reg = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(reg.statusCode).toBe(403);
  });

  test('legacy login (no tenant) leaves /auth/me unchanged', async () => {
    const session = await loginAs('boss');
    const jwt = jwtFor();
    expect(jwt.verifyAccessToken(session.accessToken).tenantId).toBeUndefined();
    const res = await request(server.app).get('/api/v1/auth/me').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.effectiveRole).toBeUndefined();
    expect(res.body.data.effectivePermissions).toBeUndefined();
  });
});

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return require('../utils/jwt');
}

// ---------------------------------------------------------------------------
// 2. Forgery vectors — the trusted tenant is the server-bound one, only
// ---------------------------------------------------------------------------
describe('Phase C — tamper vectors vs the trusted tenant', () => {
  function mini() {
    jest.resetModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    const { authMiddleware } = require('../middleware/auth');
    const tenantCarry = require('../middleware/tenantCarry');
    const { requirePermission, resolveTenantRoleForRequest } = require('../middleware/authorize');
    const jwt = require('../utils/jwt');
    const app = express();
    app.use(authMiddleware);
    app.use(tenantCarry);
    app.get('/whoami', (req, res) => {
      const effective = resolveTenantRoleForRequest(req);
      res.json({ effectiveRole: req.user ? (req.user.effectiveRole !== undefined ? req.user.effectiveRole : effective) : null });
    });
    app.get('/secret', requirePermission('users.permissions.view'), (req, res) => res.json({ ok: true }));
    app.get('/delete', requirePermission('sales.delete'), (req, res) => res.json({ ok: true }));
    return { app, jwt };
  }

  function denied(res) {
    expect(res.statusCode).toBe(403);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  }

  test('a forged Admin role claim cannot escape a tenant downgrade', async () => {
    const { app, jwt } = mini();
    const token = jwt.signAccessToken({ id: 'k1', username: 'kit', role: 'Admin', tenantId: 'nile' });
    const who = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(who.body.effectiveRole).toBe('Cashier');
    const res = await request(app).get('/secret').set('Authorization', `Bearer ${token}`);
    denied(res);
  });

  test('query/header tenant injection cannot switch the trusted tenant', async () => {
    const { app, jwt } = mini();
    const token = jwt.signAccessToken({ id: 'b1', username: 'boss', role: 'Owner', tenantId: 'nile' });
    const who = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(who.body.effectiveRole).toBe('Cashier');
    const res = await request(app)
      .get('/delete?tenant=digitronics')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', 'digitronics');
    denied(res);
  });

  test('a cross-tenant Admin grant does not leak into an unbound tenant', async () => {
    const { app, jwt } = mini();
    const token = jwt.signAccessToken({ id: 'x1', username: 'xy', role: 'Cashier', tenantId: 'nile' });
    const who = await request(app).get('/whoami').set('Authorization', `Bearer ${token}`);
    expect(who.body.effectiveRole).toBe('Cashier');
    const res = await request(app).get('/secret').set('Authorization', `Bearer ${token}`);
    denied(res);
  });

  test('header-provided identity is never trusted without a valid token', async () => {
    const { app } = mini();
    const res = await request(app)
      .get('/secret')
      .set('x-test-user', JSON.stringify({ role: 'Owner' }))
      .set('X-Tenant-Id', 'digitronics');
    expect(res.statusCode).toBe(401);
  });
});