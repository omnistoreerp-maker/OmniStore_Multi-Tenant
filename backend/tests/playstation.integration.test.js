'use strict';

// playstation.integration.test.js — HTTP-layer integration tests.
//
// Coverage:
//   - Devices CRUD via HTTP
//   - Pricing CRUD via HTTP
//   - Session lifecycle (create/start/stop/cancel/finalizePayment)
//   - Tenant isolation (cross-tenant -> 404)
//   - Tenant-scoped list endpoints (no cross-tenant leakage)
//   - Ownership / IDOR
//   - Idempotency (duplicate finalizePayment)
//   - Invalid state transitions
//   - Unauthenticated requests rejected
//
// Note on branch isolation:
//   ENABLE_BRANCH_ISOLATION is NOT wired into the market-auth flow used by
//   PlayStation routes (branchStore.middleware reads req.user, but market
//   auth sets req.customer). Branch filtering is therefore a no-op here.
//   The dedicated tests/branchIsolation.test.js covers the regular auth
//   branch-scoping separately.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TENANT_A = 'tenantA';
const TENANT_B = 'tenantB';

let server;
let dataDir;
let tokenA;
let customerIdA;
let tokenB;
let customerIdB;

registerCleanup(() => [server], () => [dataDir]);

function readStore(name) {
  const file = path.join(dataDir, name + '.json');
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function writeStore(name, payload) {
  const file = path.join(dataDir, name + '.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
}

function ensureMarketConfig(tenantId) {
  const db = readStore('marketConfig') || { configs: [] };
  if (!db.configs.find((c) => String(c.tenantId) === String(tenantId))) {
    db.configs.push({
      tenantId: String(tenantId),
      enabled: true,
      storeName: 'OmniStore Market ' + tenantId,
      currency: 'USD',
      locale: 'en',
      shippingZones: [{ id: 'standard', name: 'Standard', countries: [], fee: 10, freeAbove: 0 }],
      paymentMethods: [{ id: 'cod', name: 'COD', type: 'offline', active: true }],
      coupons: [],
      priceOverrides: {},
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeStore('marketConfig', db);
  }
}

async function registerCustomer(tenantId, email) {
  const res = await request(server.app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id };
}

beforeAll(async () => {
  dataDir = makeTempDataDir('playstation-integration');
  server = await startServer(dataDir);
  ensureMarketConfig(TENANT_A);
  ensureMarketConfig(TENANT_B);

  const regA = await registerCustomer(TENANT_A, 'psa+' + Date.now() + '@test.com');
  tokenA = regA.token;
  customerIdA = regA.customerId;

  const regB = await registerCustomer(TENANT_B, 'psb+' + Date.now() + '@test.com');
  tokenB = regB.token;
  customerIdB = regB.customerId;
});

function authA(extra = {}) {
  return Object.assign({ 'X-Tenant-Id': TENANT_A, 'Authorization': 'Bearer ' + tokenA }, extra);
}

function authB(extra = {}) {
  return Object.assign({ 'X-Tenant-Id': TENANT_B, 'Authorization': 'Bearer ' + tokenB }, extra);
}

// Tests within each describe block run sequentially and share mutable state
// (created IDs) via block-scoped variables. Do not reorder tests within a
// describe block without updating the dependent assertions.

describe('PlayStation Integration — Devices', () => {
  let deviceIdA;
  let deviceIdB;

  test('POST /api/v1/playstation/devices creates a device', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/devices')
      .set(authA())
      .send({
        platform: 'ps5',
        model: 'CFI-1015A',
        display_name: 'Integration Dev 1',
        network_address: '192.168.1.50'
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platform).toBe('ps5');
    expect(res.body.data.status).toBe('available');
    expect(typeof res.body.data.id).toBe('string');
    deviceIdA = res.body.data.id;
  });

  test('GET /api/v1/playstation/devices lists only tenant A devices', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/devices')
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.devices)).toBe(true);
    const ids = res.body.data.devices.map(d => d.id);
    expect(ids).toContain(deviceIdA);
    expect(res.body.data.devices.every(d => d.tenant_id === TENANT_A)).toBe(true);
  });

  test('Tenant B cannot read tenant A device by ID (404)', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/devices/' + deviceIdA)
      .set(authB());
    expect(res.statusCode).toBe(404);
  });

  test('Tenant A and B devices are isolated from each other', async () => {
    const resA = await request(server.app)
      .post('/api/v1/playstation/devices')
      .set(authA())
      .send({
        platform: 'ps5',
        model: 'CFI-1015B',
        display_name: 'Integration Dev A',
        network_address: '192.168.1.51'
      });
    expect(resA.statusCode).toBe(201);
    const deviceIdA2 = resA.body.data.id;

    const resB = await request(server.app)
      .post('/api/v1/playstation/devices')
      .set(authB())
      .send({
        platform: 'ps5',
        model: 'CFI-1015C',
        display_name: 'Integration Dev B',
        network_address: '192.168.1.52'
      });
    expect(resB.statusCode).toBe(201);
    deviceIdB = resB.body.data.id;

    const crossA = await request(server.app)
      .get('/api/v1/playstation/devices/' + deviceIdA2)
      .set(authB());
    expect(crossA.statusCode).toBe(404);

    const crossB = await request(server.app)
      .get('/api/v1/playstation/devices/' + deviceIdB)
      .set(authA());
    expect(crossB.statusCode).toBe(404);
  });

  test('Device transition enforces state machine', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/devices/' + deviceIdA + '/transition')
      .set(authA())
      .send({ status: 'occupied' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('occupied');

    const res2 = await request(server.app)
      .post('/api/v1/playstation/devices/' + deviceIdA + '/transition')
      .set(authA())
      .send({ status: 'available' });
    expect(res.statusCode).toBe(200);
    expect(res2.body.data.status).toBe('available');
  });

  test('Invalid device transition is rejected', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/devices/' + deviceIdA + '/transition')
      .set(authA())
      .send({ status: 'nonexistent_status' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });

  test('DELETE /api/v1/playstation/devices/:id removes device', async () => {
    const res = await request(server.app)
      .delete('/api/v1/playstation/devices/' + deviceIdA)
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PlayStation Integration — Pricing', () => {
  let pricingId;

  test('POST /api/v1/playstation/pricing creates a profile', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/pricing')
      .set(authA())
      .send({
        platform: 'ps5',
        rate_per_minute: 10,
        minimum_minutes: 1,
        rounding_minutes: 1
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.platform).toBe('ps5');
    expect(res.body.data.rate_per_minute).toBe(10);
    pricingId = res.body.data.id;
  });

  test('GET /api/v1/playstation/pricing lists only tenant A profiles', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/pricing')
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.pricing)).toBe(true);
    expect(res.body.data.pricing.every(p => p.tenant_id === TENANT_A)).toBe(true);
  });

  test('PUT /api/v1/playstation/pricing/:id updates profile', async () => {
    const res = await request(server.app)
      .put('/api/v1/playstation/pricing/' + pricingId)
      .set(authA())
      .send({ rate_per_minute: 15 });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.rate_per_minute).toBe(15);
  });

  test('Tenant B cannot read tenant A pricing by ID (404)', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/pricing/' + pricingId)
      .set(authB());
    expect(res.statusCode).toBe(404);
  });

  test('DELETE /api/v1/playstation/pricing/:id removes profile', async () => {
    const res = await request(server.app)
      .delete('/api/v1/playstation/pricing/' + pricingId)
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('PlayStation Integration — Sessions', () => {
  let deviceId;
  let pricingId;
  let sessionId;

  beforeAll(async () => {
    const devRes = await request(server.app)
      .post('/api/v1/playstation/devices')
      .set(authA())
      .send({
        platform: 'ps5',
        model: 'CFI-1015D',
        display_name: 'Session Dev',
        network_address: '192.168.1.60'
      });
    deviceId = devRes.body.data.id;

    const priceRes = await request(server.app)
      .post('/api/v1/playstation/pricing')
      .set(authA())
      .send({
        platform: 'ps5',
        rate_per_minute: 10,
        minimum_minutes: 1,
        rounding_minutes: 1
      });
    pricingId = priceRes.body.data.id;
  });

  test('POST /api/v1/playstation/sessions creates a session', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/sessions')
      .set(authA())
      .send({
        device_id: deviceId,
        duration_minutes: 60,
        pricing_profile_id: pricingId
      });
    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('pending');
    expect(res.body.data.device_id).toBe(deviceId);
    sessionId = res.body.data.id;
  });

  test('POST /api/v1/playstation/sessions/:id/start starts session', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/start')
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.status).toBe('active');
  });

  test('POST /api/v1/playstation/sessions/:id/stop stops and computes charges', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/stop')
      .set(authA());
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.session.status).toBe('completed');
    expect(typeof res.body.data.charges.charges).toBe('number');
    expect(res.body.data.charges.charges).toBeGreaterThan(0);
  });

  test('POST /api/v1/playstation/sessions/:id/payment finalizes with idempotency', async () => {
    const key = 'integ-key-' + Date.now();
    const res1 = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/payment')
      .set(authA())
      .send({ idempotencyKey: key });
    expect(res1.statusCode).toBe(200);
    expect(res1.body.success).toBe(true);
    expect(typeof res1.body.data.saleId).toBe('string');

    const res2 = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/payment')
      .set(authA())
      .send({ idempotencyKey: key });
    expect(res2.statusCode).toBe(200);
    expect(res2.body.success).toBe(true);
    expect(res2.body.data.saleId).toBe(res1.body.data.saleId);
  });

  test('Different idempotency key on finalized session returns 409', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/payment')
      .set(authA())
      .send({ idempotencyKey: 'different-key' });
    expect(res.statusCode).toBe(409);
  });

  test('Tenant B cannot access tenant A session (404)', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/sessions/' + sessionId)
      .set(authB());
    expect(res.statusCode).toBe(404);
  });

  test('Unauthenticated request returns 401', async () => {
    const res = await request(server.app)
      .get('/api/v1/playstation/devices')
      .set('X-Tenant-Id', TENANT_A);
    expect(res.statusCode).toBe(401);
  });

  test('Cancel on completed session returns 409', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/sessions/' + sessionId + '/cancel')
      .set(authA())
      .send({ reason: 'test' });
    expect(res.statusCode).toBe(409);
  });
});

describe('PlayStation Integration — Invalid Transitions', () => {
  let deviceId;

  beforeAll(async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/devices')
      .set(authA())
      .send({
        platform: 'ps5',
        model: 'CFI-1015F',
        display_name: 'Transition Dev',
        network_address: '192.168.1.80'
      });
    deviceId = res.body.data.id;
  });

  test('Invalid device transition is rejected', async () => {
    const res = await request(server.app)
      .post('/api/v1/playstation/devices/' + deviceId + '/transition')
      .set(authA())
      .send({ status: 'nonexistent_status' });
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
