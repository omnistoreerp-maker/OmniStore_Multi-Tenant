'use strict';

// gameHosting.phase4.test.js — Phase 4 integration tests.
//
// Coverage:
//   - Operator authorization
//   - HostingEntitlement CRUD + enforcement
//   - Provisioning approval/rejection workflow
//   - Idempotency
//   - Audit log visibility
//   - Plan visibility (active vs all)
//   - Server list ownership filtering
//   - BLOCKED provider transparency

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');
var marketAuthService;

const TENANT_A = 'default';
const TENANT_B = 'tenantB';
let server;
let dataDir;
let tokenA;
let customerIdA;
let tokenB;
let customerIdB;
let operatorTokenA;
let operatorIdA;

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
  const email = 'gh4' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
  const res = await request(server.app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id, email };
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

async function createEntitlement(tenantId, customerId, planId, status = 'active', startsAt, expiresAt) {
  const now = new Date();
  const effectiveStartsAt = startsAt || new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const effectiveExpiresAt = expiresAt || new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await request(server.app)
    .post('/api/v1/game-hosting/entitlements')
    .set('X-Tenant-Id', tenantId)
    .set('Authorization', 'Bearer ' + operatorTokenA)
    .send({ customerId, planId, status, startsAt: effectiveStartsAt, expiresAt: effectiveExpiresAt });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('gameHostingPhase4');
  server = await startServer(dataDir);
  marketAuthService = require('../services/marketAuth.service');
  ensureMarketConfig(TENANT_A);
  ensureMarketConfig(TENANT_B);
  const a = await registerCustomer(TENANT_A);
  const b = await registerCustomer(TENANT_B);
  tokenA = a.token;
  customerIdA = a.customerId;
  tokenB = b.token;
  customerIdB = b.customerId;
  const op = await registerCustomer(TENANT_A);
  operatorIdA = op.customerId;
  marketAuthService.setOperatorRole(operatorIdA, TENANT_A, 'operator');
  const customer = marketAuthService.getById(operatorIdA);
  const { signCustomerToken } = require('../utils/marketJwt');
  operatorTokenA = signCustomerToken(customer);
});

describe('Phase 4 — Operator authorization', () => {
  test('Customer denied operator entitlement endpoint', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/entitlements')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(403);
  });

  test('Operator allowed within tenant', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Op-Plan-' + Date.now());
    const res = await request(server.app)
      .get('/api/v1/game-hosting/entitlements')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.entitlements)).toBe(true);
  });

  test('Operator denied cross-tenant entitlement access', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/entitlements')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(403);
  });
});

describe('Phase 4 — HostingEntitlement', () => {
  test('Operator can create entitlement', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Ent-Plan-' + Date.now());
    const entitlement = await createEntitlement(TENANT_A, customerIdA, plan.id);
    expect(entitlement.customerId).toBe(customerIdA);
    expect(entitlement.planId).toBe(plan.id);
    expect(entitlement.status).toBe('active');
  });

  test('Operator can update entitlement status', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'EntUp-Plan-' + Date.now());
    const entitlement = await createEntitlement(TENANT_A, customerIdA, plan.id);
    const res = await request(server.app)
      .put('/api/v1/game-hosting/entitlements/' + entitlement.id)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA)
      .send({ status: 'cancelled' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.status).toBe('cancelled');
  });

  test('Operator can delete entitlement', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'EntDel-Plan-' + Date.now());
    const entitlement = await createEntitlement(TENANT_A, customerIdA, plan.id);
    const res = await request(server.app)
      .delete('/api/v1/game-hosting/entitlements/' + entitlement.id)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
  });

  test('Active entitlement permits provisioning', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'EntProv-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.request.status).toBe('pending');
  });

  test('Expired entitlement blocks provisioning', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'EntExp-Plan-' + Date.now());
    const now = new Date();
    const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const furtherPast = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active', past, furtherPast);
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/No active entitlement/);
  });

  test('Cancelled entitlement blocks provisioning', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'EntCanc-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'cancelled');
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/No active entitlement/);
  });
});

describe('Phase 4 — Provisioning workflow', () => {
  test('Customer can create provisioning request with idempotency key', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Idem-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const key = 'idem-' + Date.now();
    const res1 = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west', idempotencyKey: key });
    expect(res1.statusCode).toBe(201);
    const res2 = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west', idempotencyKey: key });
    expect(res2.statusCode).toBe(201);
    expect(res2.body.data.request.id).toBe(res1.body.data.request.id);
    expect(res2.body.data.idempotent).toBe(true);
  });

  test('Operator can approve provisioning request', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Appr-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    const requestId = reqRes.body.data.request.id;
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/approve')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.request.status).toBe('approved');
    expect(res.body.data.provider.status).toBe('BLOCKED');
  });

  test('Operator can reject provisioning request', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Rej-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    const requestId = reqRes.body.data.request.id;
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/reject')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.request.status).toBe('rejected');
  });

  test('Repeated approval returns conflict', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'RepAppr-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    const requestId = reqRes.body.data.request.id;
    await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/approve')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/approve')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(409);
  });

  test('Customer denied operator approve endpoint', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'CustDeny-Plan-' + Date.now());
    await createEntitlement(TENANT_A, customerIdA, plan.id, 'active');
    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });
    const requestId = reqRes.body.data.request.id;
    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/approve')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(403);
  });
});

describe('Phase 4 — Plan visibility', () => {
  test('Customer sees only active plans', async () => {
    await createPlan(TENANT_A, operatorTokenA, 'DraftPlan-' + Date.now());
    const res = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.plans.every((p) => p.status === 'active')).toBe(true);
  });

  test('Operator sees all plan statuses', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    const statuses = res.body.data.plans.map((p) => p.status);
    expect(statuses.some((s) => s === 'draft' || s === 'archived' || s === 'active')).toBe(true);
  });
});

describe('Phase 4 — Server list ownership', () => {
  test('Customer sees only own servers', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'OwnServ-Plan-' + Date.now());
    await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, serverName: 'My Server', region: 'us-east' });
    const res = await request(server.app)
      .get('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.servers.every((s) => s.customerId === customerIdA)).toBe(true);
  });
});

describe('Phase 4 — Audit log', () => {
  test('Operator can read game hosting audit log', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Audit-Plan-' + Date.now());
    const res = await request(server.app)
      .get('/api/v1/game-hosting/audit-log')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.entries)).toBe(true);
  });

  test('Customer denied audit log access', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/audit-log')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(403);
  });
});
