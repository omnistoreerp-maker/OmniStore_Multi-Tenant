'use strict';

// Phase G — Security / tenant-isolation expansion.
//
// Focus: the base /api/v1/users CRUD surface that Phase E hardened on the
// SUB-resources (permissions/reset-password/disable/enable) but left open on
// list/getById/stats/update/delete.
//
// Verified gaps (STEP 3 matrix #4 #5 #6), demonstrated and then closed:
//   G/04 — cross-tenant READ of the user directory in tenant mode
//          (list / getById / stats ignore the trusted tenant).
//   G/05 — vertical escalation: a Manager can overwrite an Owner/Admin's
//          password (update() only gates role changes, not password/fields).
//   G/06 — cross-tenant UPDATE/DELETE of users in tenant mode (no canManageUser).
//
// Tenant identity must always come from the TRUSTED server-side tenant context
// (the JWT claim carried by tenantCarry). The X-Tenant-Id / X-Company-Id /
// body.tenantId / query.tenantId vectors MUST never grant visibility.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED
};

const companies = [
  { id: 'digi', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true }
];

const PASSWORD = 'Pass#123';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('phaseg-users');
  seed(dataDir, 'companies', companies);
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      // digi tenant
      { id: 'u-owner', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-adm', username: 'digiAdmin', password: hash, fullName: 'Digi Admin', role: 'Admin', tenantIds: ['digi'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-mgr', username: 'digiManager', password: hash, fullName: 'Digi Manager', role: 'Manager', tenantIds: ['digi'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-cash', username: 'digiCashier', password: hash, fullName: 'Digi Cashier', role: 'Cashier', tenantIds: ['digi'], createdAt: stamp, updatedAt: stamp },
      // nile tenant (must never be visible to digi actors)
      { id: 'u-nboss', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-nonly', username: 'nileOnly', password: hash, fullName: 'Nile Only', role: 'Cashier', tenantIds: ['nile'], createdAt: stamp, updatedAt: stamp }
    ]
  });
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function tokenFor(username, company) {
  const session = await login(server.app, username, PASSWORD, company);
  return session.accessToken;
}

function digiToken() {
  return tokenFor('digiManager', 'digi');
}

const notVisible = (body) =>
  body.data && body.data.users && !body.data.users.some((u) => u.username === 'nileOnly');

describe('Phase G — trusted tenant identity (users CRUD)', () => {
  test('anonymous is rejected in the hardened posture', async () => {
    const res = await request(server.app).get('/api/v1/users');
    expect(res.statusCode).toBe(401);
  });

  test('forged X-Tenant-Id never reveals another tenant', async () => {
    const res = await request(server.app).get('/api/v1/users')
      .set(authHeader(await digiToken()))
      .set('X-Tenant-Id', 'nile');
    expect(res.statusCode).toBe(200);
    expect(notVisible(res.body)).toBe(true);
  });

  test('forged X-Company-Id never reveals another tenant', async () => {
    const res = await request(server.app).get('/api/v1/users')
      .set(authHeader(await digiToken()))
      .set('X-Company-Id', 'nile');
    expect(notVisible(res.body)).toBe(true);
  });

  test('forged query tenantId never reveals another tenant', async () => {
    const res = await request(server.app).get('/api/v1/users?tenantId=nile')
      .set(authHeader(await digiToken()));
    expect(notVisible(res.body)).toBe(true);
  });

  test('forged body tenantId never reveals another tenant', async () => {
    const res = await request(server.app).get('/api/v1/users')
      .set(authHeader(await digiToken()))
      .send({ tenantId: 'nile' });
    expect(notVisible(res.body)).toBe(true);
  });
});

describe('Phase G — cross-tenant reads (list/getById/stats)', () => {
  test('tenant-scoped list hides other tenants', async () => {
    const res = await request(server.app).get('/api/v1/users')
      .set(authHeader(await digiToken()));
    expect(res.statusCode).toBe(200);
    expect(notVisible(res.body)).toBe(true);
    const usernames = res.body.data.users.map((u) => u.username);
    expect(usernames).toContain('digiManager');
    expect(usernames).not.toContain('nileOnly');
  });

  test('tenant-scoped getById hides other tenants', async () => {
    const res = await request(server.app).get('/api/v1/users/u-nonly')
      .set(authHeader(await digiToken()));
    expect(res.statusCode).toBe(404);
  });

  test('same-tenant getById still resolves', async () => {
    const res = await request(server.app).get('/api/v1/users/u-cash')
      .set(authHeader(await digiToken()));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.username).toBe('digiCashier');
  });

  test('tenant-scoped stats count excludes other tenants', async () => {
    const res = await request(server.app).get('/api/v1/users/stats')
      .set(authHeader(await digiToken()));
    expect(res.statusCode).toBe(200);
    // digi has 4 users (owner, admin, manager, cashier); 2 other-tenant users must be excluded.
    expect(res.body.data.count).toBe(4);
  });
});

describe('Phase G — vertical escalation (update)', () => {
  test('Owner can still manage users in the tenant', async () => {
    const res = await request(server.app).put('/api/v1/users/u-cash')
      .set(authHeader(await tokenFor('digiOwner', 'digi')))
      .send({ fullName: 'Digi Cashier Owner-Edited' });
    expect(res.statusCode).toBe(200);
  });

  test('Manager cannot overwrite an Owner password in the same tenant', async () => {
    const res = await request(server.app).put('/api/v1/users/u-owner')
      .set(authHeader(await digiToken()))
      .send({ password: 'Hacked#123' });
    expect(res.statusCode).toBe(403);
    const store = readStore(dataDir, 'users');
    const owner = store.users.find((u) => u.id === 'u-owner');
    expect(owner.password).not.toMatch(/Hacked/);
  });

  test('Manager cannot overwrite a cross-tenant user password', async () => {
    const res = await request(server.app).put('/api/v1/users/u-nonly')
      .set(authHeader(await digiToken()))
      .send({ password: 'Hacked#123' });
    expect(res.statusCode).toBe(403);
  });

  test('Manager can still edit a same-tenant non-privileged user', async () => {
    const res = await request(server.app).put('/api/v1/users/u-cash')
      .set(authHeader(await digiToken()))
      .send({ fullName: 'Digi Cashier Updated' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.fullName).toBe('Digi Cashier Updated');
  });

  test('Last-Owner protection still triggers on role demotion', async () => {
    const res = await request(server.app).put('/api/v1/users/u-owner')
      .set(authHeader(await tokenFor('digiAdmin', 'digi')))
      .send({ role: 'Manager' });
    expect(res.statusCode).toBe(409);
    expect(res.body.details && res.body.details.code).toBe('LAST_OWNER_PROTECTION');
  });
});

describe('Phase G — cross-tenant delete', () => {
  test('Manager cannot delete a cross-tenant user', async () => {
    const res = await request(server.app).delete('/api/v1/users/u-nonly')
      .set(authHeader(await digiToken()));
    expect(res.statusCode).toBe(403);
    const store = readStore(dataDir, 'users');
    expect(store.users.some((u) => u.id === 'u-nonly')).toBe(true);
  });

  test('Owner can delete a same-tenant non-privileged user', async () => {
    const res = await request(server.app).delete('/api/v1/users/u-cash')
      .set(authHeader(await tokenFor('digiOwner', 'digi')));
    expect(res.statusCode).toBe(200);
  });
});