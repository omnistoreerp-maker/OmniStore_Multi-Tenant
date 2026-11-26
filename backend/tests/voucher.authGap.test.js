'use strict';

// Voucher auth-gap protection: with AUTH_REQUIRED=false, routes that were
// guarded by requirePermissionIfAuth (bypasses auth when disabled) now use
// requireAuth + requirePermission. Verifies 401 without token, 403 without
// permission, 200/201 with permission.

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

function voucherRecords() {
  const t = new Date().toISOString();
  return { vouchers: [
    { id: 'VCH-1', type: 'receipt', partyName: 'Alice', partyType: 'customer', method: 'cash', amount: 500, date: '2026-07-01', tenantId: 't1', createdAt: t, updatedAt: t }
  ]};
}

let server;
let dataDir;
let ownerToken;
let cashierToken;

beforeAll(async () => {
  dataDir = makeTempDataDir('voucher-authgap');
  seed(dataDir, 'users', userRecords());
  seed(dataDir, 'vouchers', voucherRecords());
  server = await startServer(dataDir, { AUTH_REQUIRED: 'false' });
  ownerToken = (await login(server.app, 'owner1', PASSWORD, 't1')).accessToken;
  cashierToken = (await login(server.app, 'cashier1', PASSWORD, 't1')).accessToken;
  expect(ownerToken).toBeTruthy();
  expect(cashierToken).toBeTruthy();
});

registerCleanup(() => [server], () => [dataDir]);

describe('AUTH_REQUIRED=false — voucher routes require auth+permission', () => {
  test('GET /api/v1/vouchers without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/vouchers');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/vouchers with Cashier (no vouchers.view) → 403', async () => {
    const res = await request(server.app).get('/api/v1/vouchers').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/vouchers with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/vouchers').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('POST /api/v1/vouchers without token → 401', async () => {
    const res = await request(server.app).post('/api/v1/vouchers').send({ id: 'VCH-2', type: 'receipt', partyName: 'Bob', partyType: 'customer', method: 'cash', amount: 100, date: '2026-07-02' });
    expect(res.statusCode).toBe(401);
  });

  test('POST /api/v1/vouchers with Cashier (no vouchers.create) → 403', async () => {
    const res = await request(server.app).post('/api/v1/vouchers').set(authHeader(cashierToken)).send({ id: 'VCH-2', type: 'receipt', partyName: 'Bob', partyType: 'customer', method: 'cash', amount: 100, date: '2026-07-02' });
    expect(res.statusCode).toBe(403);
  });

  test('POST /api/v1/vouchers with Owner → 201', async () => {
    const res = await request(server.app).post('/api/v1/vouchers').set(authHeader(ownerToken)).send({ id: 'VCH-2', type: 'receipt', partyName: 'Bob', partyType: 'customer', method: 'cash', amount: 100, date: '2026-07-02' });
    expect(res.statusCode).toBe(201);
  });

  test('GET /api/v1/vouchers/stats without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/stats');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/vouchers/stats with Cashier → 403', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/stats').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/vouchers/stats with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/stats').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('GET /api/v1/vouchers/:id without token → 401', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/VCH-1');
    expect(res.statusCode).toBe(401);
  });

  test('GET /api/v1/vouchers/:id with Cashier → 403', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/VCH-1').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/v1/vouchers/:id with Owner → 200', async () => {
    const res = await request(server.app).get('/api/v1/vouchers/VCH-1').set(authHeader(ownerToken));
    expect(res.statusCode).toBe(200);
  });

  test('PUT /api/v1/vouchers/:id without token → 401', async () => {
    const res = await request(server.app).put('/api/v1/vouchers/VCH-1').send({ amount: 600 });
    expect(res.statusCode).toBe(401);
  });

  test('PUT /api/v1/vouchers/:id with Cashier (no vouchers.edit) → 403', async () => {
    const res = await request(server.app).put('/api/v1/vouchers/VCH-1').set(authHeader(cashierToken)).send({ amount: 600 });
    expect(res.statusCode).toBe(403);
  });

  test('DELETE /api/v1/vouchers/:id without token → 401', async () => {
    const res = await request(server.app).delete('/api/v1/vouchers/VCH-2');
    expect(res.statusCode).toBe(401);
  });

  test('DELETE /api/v1/vouchers/:id with Cashier (no vouchers.delete) → 403', async () => {
    const res = await request(server.app).delete('/api/v1/vouchers/VCH-2').set(authHeader(cashierToken));
    expect(res.statusCode).toBe(403);
  });
});
