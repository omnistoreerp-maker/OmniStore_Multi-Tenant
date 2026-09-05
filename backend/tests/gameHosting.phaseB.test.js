'use strict';

// gameHosting.phaseB.test.js — Phase B HTTP layer integration tests.
//
// Coverage:
//   - Plans CRUD via HTTP
//   - Servers CRUD via HTTP
//   - Server lifecycle (start/stop/terminate) with state machine validation
//   - Provisioning requests (provider BLOCKED)
//   - Ownership: customer A cannot read/modify customer B's servers
//   - IDOR: cross-tenant, cross-customer, forged IDs all return 404
//   - Provider status endpoint
//   - Unauthenticated requests are rejected

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const TENANT_A = 'default';
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

async function registerCustomer(tenantId) {
  const email = 'ghb' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
  const res = await request(server.app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id };
}

async function createPlan(tenantId, token, name) {
  const res = await request(server.app)
    .post('/api/v1/game-hosting/plans')
    .set('X-Tenant-Id', tenantId)
    .set('Authorization', 'Bearer ' + token)
    .send({ name, gameTitle: 'Minecraft', maxPlayers: 10, pricePerMonth: 20, status: 'active' });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

async function createServer(tenantId, token, planId, serverName) {
  const res = await request(server.app)
    .post('/api/v1/game-hosting/servers')
    .set('X-Tenant-Id', tenantId)
    .set('Authorization', 'Bearer ' + token)
    .send({ planId, serverName, region: 'eu-west' });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('gameHostingPhaseB');
  server = await startServer(dataDir);
  ensureMarketConfig(TENANT_A);
  ensureMarketConfig(TENANT_B);
  const a = await registerCustomer(TENANT_A);
  const b = await registerCustomer(TENANT_B);
  tokenA = a.token;
  customerIdA = a.customerId;
  tokenB = b.token;
  customerIdB = b.customerId;
});

describe('Phase B — Provider status', () => {
  test('GET /game-hosting/provider/status returns BLOCKED', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/provider/status')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('BLOCKED');
    expect(res.body.data.reason).toBeDefined();
  });

  test('Provider status requires authentication', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/provider/status')
      .set('X-Tenant-Id', TENANT_A);
    expect(res.statusCode).toBe(401);
  });
});

describe('Phase B — Plans CRUD', () => {
  test('POST /plans creates a plan', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ name: 'Minecraft 10 players', gameTitle: 'Minecraft', maxPlayers: 10, pricePerMonth: 20, status: 'active' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.name).toBe('Minecraft 10 players');
    expect(String(res.body.data.tenantId)).toBe(TENANT_A);
  });

  test('GET /plans lists plans for the tenant', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.plans)).toBe(true);
    expect(res.body.data.plans.length).toBeGreaterThan(0);
  });

  test('Tenant A cannot see Tenant B plans', async () => {
    await createPlan(TENANT_B, tokenB, 'B-Plan-' + Date.now());
    const resA = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    const resB = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    const aNames = resA.body.data.plans.map((p) => p.name);
    const bNames = resB.body.data.plans.map((p) => p.name);
    const bPlanNames = bNames.filter((n) => n.startsWith('B-Plan'));
    expect(aNames.some((n) => n.startsWith('B-Plan'))).toBe(false);
    expect(bPlanNames.length).toBeGreaterThan(0);
  });

  test('Forged tenantId in body is rejected or stamped with header tenant', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ name: 'Forged-Plan', gameTitle: 'X', tenantId: TENANT_B });
    if (res.statusCode === 201) {
      expect(String(res.body.data.tenantId)).toBe(TENANT_A);
    } else {
      expect(res.statusCode).toBe(400);
    }
  });

  test('Plan validation: name is required', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ gameTitle: 'X' });
    expect(res.statusCode).toBe(400);
  });
});

describe('Phase B — Servers CRUD with ownership', () => {
  test('POST /servers creates a server stamped with the authenticated customer', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'A-Plan-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, serverName: 'My MC Server', region: 'eu-west' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.serverName).toBe('My MC Server');
    expect(String(res.body.data.customerId)).toBe(customerIdA);
    expect(String(res.body.data.tenantId)).toBe(TENANT_A);
  });

  test('IDOR: Customer B cannot read Customer A server (404, not 403)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'IDOR-Plan-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'A-Server-' + Date.now());
    const res = await request(server.app)
      .get('/api/v1/game-hosting/servers/' + gameServer.id)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    expect(res.statusCode).toBe(404);
  });

  test('IDOR: Customer B cannot update Customer A server (404)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'IDOR-Plan2-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'A-Server2-' + Date.now());
    const res = await request(server.app)
      .put('/api/v1/game-hosting/servers/' + gameServer.id)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB)
      .send({ serverName: 'Hacked' });
    expect(res.statusCode).toBe(404);
  });

  test('IDOR: Customer B cannot delete Customer A server (404)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'IDOR-Plan3-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'A-Server3-' + Date.now());
    const res = await request(server.app)
      .delete('/api/v1/game-hosting/servers/' + gameServer.id)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    expect(res.statusCode).toBe(404);
  });

  test('Forged customerId in body is ignored (server stamped with JWT customer)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'Forged-Owner-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, serverName: 'Forged Owner', customerId: 'forged-customer-id' });
    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.customerId)).toBe(customerIdA);
  });
});

describe('Phase B — Server lifecycle (state machine)', () => {
  test('POST /servers/:id/start transitions pending → provisioning (provider BLOCKED)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'LC-Plan-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'LC-Server-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/start')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.data.provider.status).toBe('BLOCKED');
    expect(res.body.data.server.status).toBe('provisioning');
  });

  test('POST /servers/:id/start again is invalid from provisioning (409)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'LC-Plan2-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'LC-Server2-' + Date.now());
    const res1 = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/start')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(res1.statusCode).toBe(200);
    const res2 = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/start')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(res2.statusCode).toBe(409);
  });

  test('POST /servers/:id/terminate from provisioning is valid (transitions to terminated)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'LC-Plan3-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'LC-Server3-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/terminate')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(res.statusCode).toBe(200);
    expect(res.body.data.server.status).toBe('terminated');
  });

  test('Cannot start a terminated server (409 invalid transition)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'LC-Plan4-' + Date.now());
    const gameServer = await createServer(TENANT_A, tokenA, plan.id, 'LC-Server4-' + Date.now());
    const startRes = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/start')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(startRes.statusCode).toBe(200);
    const termRes = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/terminate')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(termRes.statusCode).toBe(200);
    const retryRes = await request(server.app)
      .post('/api/v1/game-hosting/servers/' + gameServer.id + '/start')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({});
    expect(retryRes.statusCode).toBe(409);
  });
});

describe('Phase B — Provisioning requests (provider BLOCKED)', () => {
  test('POST /provisioning-requests records a request (provider BLOCKED)', async () => {
    const plan = await createPlan(TENANT_A, tokenA, 'Prov-Plan-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.request.status).toBe('pending');
    expect(res.body.data.provider.status).toBe('BLOCKED');
  });

  test('Provisioning request rejects non-existent plan', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: 'non-existent-plan' });
    expect(res.statusCode).toBe(400);
  });

  test('Provisioning request rejects cross-tenant plan', async () => {
    const planB = await createPlan(TENANT_B, tokenB, 'B-Prov-Plan-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: planB.id });
    expect(res.statusCode).toBe(400);
  });

  test('GET /provisioning-requests lists tenant-scoped requests', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.requests)).toBe(true);
    expect(res.body.data.provider.status).toBe('BLOCKED');
  });
});

describe('Phase B — Authentication enforcement', () => {
  test('Unauthenticated plan list returns 401', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A);
    expect(res.statusCode).toBe(401);
  });

  test('Unauthenticated server list returns 401', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A);
    expect(res.statusCode).toBe(401);
  });

  test('Missing tenant returns 400', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(400);
  });
});
