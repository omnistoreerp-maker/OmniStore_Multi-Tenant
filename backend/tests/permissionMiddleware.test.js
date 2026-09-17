'use strict';

// Phase C — HTTP wiring: GET /api/v1/permissions and the authoritative
// requirePermission path resolved against REAL user records (feature-off scope,
// i.e. no tenant context). Synthetic header-only identities keep the legacy
// permissions-array behavior, which middleware.test.js already covers.

const express = require('express');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP
};

let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  // This suite asserts the single-tenant (tenant-features OFF) behavior.
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'false';
  }
  dataDir = makeTempDataDir('perm');
  server = await startServer(dataDir);
  await createUser(server.app, { username: 'owner1', password: 'Owner#123', fullName: 'Owner One', role: 'Owner' });
  await createUser(server.app, { username: 'admin1', password: 'Admin#123', fullName: 'Admin One', role: 'Admin' });
  await createUser(server.app, { username: 'manager1', password: 'Mgr#1234', fullName: 'Manager One', role: 'Manager' });
  await createUser(server.app, { username: 'cashier1', password: 'Cash#1234', fullName: 'Cashier One', role: 'Cashier', extra: { permissions: ['sales.delete'] } });
  await createUser(server.app, { username: 'tech1', password: 'Tech#1234', fullName: 'Tech One', role: 'Technician' });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

// Mini app with the REAL auth + authorize middleware against the seeded store.
function permApp() {
  jest.resetModules();
  const { authMiddleware } = require('../middleware/auth');
  const { requirePermission } = require('../middleware/authorize');
  const app = express();
  app.use(authMiddleware);
  app.get('/perm-sales-create', requirePermission('sales.create'), (req, res) => res.json({ ok: true }));
  app.get('/perm-sales-delete', requirePermission('sales.delete'), (req, res) => res.json({ ok: true }));
  app.get('/perm-sales-edit', requirePermission('sales.edit'), (req, res) => res.json({ ok: true }));
  app.get('/perm-perms-view', requirePermission('users.permissions.view'), (req, res) => res.json({ ok: true }));
  return app;
}

describe('GET /api/v1/permissions', () => {
  test('anonymous request is rejected with 401', async () => {
    const res = await request(server.app).get('/api/v1/permissions');
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('Admin can list the registry', async () => {
    const session = await login(server.app, 'admin1', 'Admin#123');
    const res = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    const groups = res.body.data.groups;
    expect(Array.isArray(groups)).toBe(true);
    expect(groups.find(g => g.group === 'sales').permissions).toContain('sales.create');
  });

  test('Owner can list the registry', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123');
    const res = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
  });

  test('Manager without users.permissions.view is denied with 403', async () => {
    const session = await login(server.app, 'manager1', 'Mgr#1234');
    const res = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
  });

  test('Cashier is denied with 403', async () => {
    const session = await login(server.app, 'cashier1', 'Cash#1234');
    const res = await request(server.app).get('/api/v1/permissions').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
  });
});

describe('real-user requirePermission (authoritative record path)', () => {
  test('Owner bypasses permission checks end-to-end', async () => {
    const session = await login(server.app, 'owner1', 'Owner#123');
    for (const path of ['/perm-sales-create', '/perm-sales-delete', '/perm-perms-view']) {
      const res = await request(permApp()).get(path).set(authHeader(session.accessToken));
      expect(res.statusCode).toBe(200);
    }
  });

  test('Admin bypasses permission checks end-to-end', async () => {
    const session = await login(server.app, 'admin1', 'Admin#123');
    const res = await request(permApp()).get('/perm-sales-delete').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
  });

  test('Cashier baseline grants sales.create', async () => {
    const session = await login(server.app, 'cashier1', 'Cash#1234');
    const res = await request(permApp()).get('/perm-sales-create').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
  });

  test('Cashier explicit grant unlocks sales.delete', async () => {
    const session = await login(server.app, 'cashier1', 'Cash#1234');
    const res = await request(permApp()).get('/perm-sales-delete').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(200);
  });

  test('Technician is denied sales.create (baseline mismatch)', async () => {
    const session = await login(server.app, 'tech1', 'Tech#1234');
    const res = await request(permApp()).get('/perm-sales-create').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
  });

  test('Manager is denied users.permissions.view', async () => {
    const session = await login(server.app, 'manager1', 'Mgr#1234');
    const res = await request(permApp()).get('/perm-perms-view').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
  });

  test('denial carries the PERMISSION_DENIED envelope', async () => {
    const session = await login(server.app, 'tech1', 'Tech#1234');
    const res = await request(permApp()).get('/perm-sales-edit').set(authHeader(session.accessToken));
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.details).toEqual({ code: 'PERMISSION_DENIED' });
  });
});