'use strict';

// Users auth-gap protection: with AUTH_REQUIRED=false, routes that were
// guarded by requirePermissionIfAuth (bypasses auth when disabled) now use
// requireAuth + requirePermission. Verifies 401 without token, 403 without
// permission, 200 with permission, and no regression on sensitive user routes.

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'AuthGap#1234';

function userRecords() {
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  const base = { password: hash, createdAt: stamp, updatedAt: stamp, tokenVersion: 0 };
  return {
    users: [
      { ...base, id: 'u-owner', username: 'owner1', fullName: 'Owner One', role: 'Owner', tenantIds: ['t1'], tenantRoles: { t1: 'Owner' } },
      { ...base, id: 'u-cash', username: 'cashier1', fullName: 'Cashier One', role: 'Cashier', tenantIds: ['t1'], tenantRoles: { t1: 'Cashier' } }
    ]
  };
}

let server;
let dataDir;
let ownerToken;
let cashierToken;

beforeAll(async () => {
  dataDir = makeTempDataDir('users-authgap');
  seed(dataDir, 'users', userRecords());
  server = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
  ownerToken = (await login(server.app, 'owner1', PASSWORD, 't1')).accessToken;
  cashierToken = (await login(server.app, 'cashier1', PASSWORD, 't1')).accessToken;
  expect(ownerToken).toBeTruthy();
  expect(cashierToken).toBeTruthy();
});

registerCleanup(() => [server], () => [dataDir]);

describe('AUTH_REQUIRED=false — users routes require auth+permission', () => {
  test('GET /api/v1/users without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/users');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/users with Cashier (no users.view) → 403', async () => {
    const res = await request(server.app).get('/api/v1/users').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/users with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/users').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('POST /api/v1/users without token → 401', async () => {
    const res = await request(server.app).post('/api/v1/users').send({ username: 'newuser', password: 'New#1234', role: 'Cashier' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/users with Cashier (no users.create) → 403', async () => {
    const res = await request(server.app).post('/api/v1/users').set(authHeader(cashierToken)).send({ username: 'newuser', password: 'New#1234', role: 'Cashier' });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/v1/users with Owner → 201', async () => {
    const res = await request(server.app).post('/api/v1/users').set(authHeader(ownerToken)).send({ username: 'newuser2', password: 'New#1234', role: 'Cashier' });
    expect(res.statusCode).toBe(201);
  });

  test('GET /api/v1/users/stats without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/users/stats');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/users/stats with Cashier → 403', async () => {
    const res = await request(server.app).get('/api/v1/users/stats').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/users/stats with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/users/stats').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/v1/users/:id without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/users/u-cash');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/users/:id with Cashier → 403', async () => {
    const res = await request(server.app).get('/api/v1/users/u-cash').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/users/:id with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/users/u-cash').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('PUT /api/v1/users/:id without token → 401', async () => {
    const res = await request(server.app).put('/api/v1/users/u-cash').send({ phone: '0111' });
    expect(res.statusCode).toBe(401);
  });

  test('PUT /api/v1/users/:id with Cashier (no users.edit) → 403', async () => {
    const res = await request(server.app).put('/api/v1/users/u-cash').set(authHeader(cashierToken)).send({ phone: '0111' });
    expect(res.statusCode).toBe(403);
  });

  test('DELETE /api/v1/users/:id without token → 401', async () => {
    const res = await request(server.app).delete('/api/v1/users/u-cash');
    expect(res.statusCode).toBe(401);
  });

  test('DELETE /api/v1/users/:id with Cashier (no users.delete) → 403', async () => {
    const res = await request(server.app).delete('/api/v1/users/u-cash').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });
});

describe('Sensitive user routes — no regression with requireAuth preserved', () => {
  test('POST /api/v1/users/:id/reset-password requires requireAuth+requirePermission', async () => {
    const res = await request(server.app).post('/api/v1/users/u-cash/reset-password').send({ newPassword: 'Reset#1234' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/users/:id/reset-password with Cashier → 403 (no users.password.reset)', async () => {
    const res = await request(server.app).post('/api/v1/users/u-cash/reset-password').set(authHeader(cashierToken)).send({ newPassword: 'Reset#1234' });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/v1/users/:id/reset-password with Owner → 200', async () => {
    const res = await request(server.app).post('/api/v1/users/u-cash/reset-password').set(authHeader(ownerToken)).send({ newPassword: 'Reset#1234' });
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/v1/users/:id/permissions without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/users/u-cash/permissions');
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/users/:id/disable without token → 401', async () => {
    const res = await request(server.app).post('/api/v1/users/u-cash/disable');
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/users/:id/enable without token → 401', async () => {
    const res = await request(server.app).post('/api/v1/users/u-cash/enable');
    expect(res.statusCode).toBe(401);
  });
});
