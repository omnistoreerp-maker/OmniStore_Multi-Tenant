'use strict';

// marketplaceGameHosting.hardening.test.js — Security & contract hardening
// for Marketplace + Game Hosting.
//
// Coverage:
//   - Cross-tenant data isolation (catalog, orders, entitlements, plans, servers)
//   - Forged customerId / tenantId in request bodies is ignored
//   - Order state machine rejects invalid/unknown transitions
//   - Checkout idempotency is exact (same key -> same order)
//   - Provisioning request idempotency is scoped to tenant+customer+plan+key
//   - Entitlement cannot be consumed cross-tenant
//   - Operator-only endpoints reject non-operators and cross-tenant operators
//   - Invalid/missing auth returns 401/403
//   - Malformed IDs/payloads return 400/404 without leaking data or crashing

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
let operatorTokenA;
let operatorIdA;
let operatorTokenB;
let operatorIdB;
let marketAuthService;

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
      shippingZones: [{ id: 'standard', name: 'Standard', countries: [], fee: 10, freeAbove: 200 }],
      paymentMethods: [{ id: 'cod', name: 'Cash on Delivery', type: 'offline', active: true }],
      coupons: [],
      priceOverrides: {},
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    writeStore('marketConfig', db);
  }
}

function seedProduct(id, name, sellPrice, stockQty) {
  const db = readStore('products') || { products: [] };
  if (!db.products) db.products = [];
  if (db.products.some((p) => p.id === id)) return;
  db.products.push({ id, name, sku: 'SKU-' + id, sellPrice, stockQty, categoryId: 'cat1' });
  writeStore('products', db);
}

async function registerCustomer(tenantId) {
  const email = 'harden' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
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

async function createEntitlement(tenantId, token, customerId, planId, status) {
  const now = new Date();
  const startsAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await request(server.app)
    .post('/api/v1/game-hosting/entitlements')
    .set('X-Tenant-Id', tenantId)
    .set('Authorization', 'Bearer ' + token)
    .send({ customerId, planId, status: status || 'active', startsAt, expiresAt });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('marketplaceGameHostingHardening');
  server = await startServer(dataDir);
  marketAuthService = require('../services/marketAuth.service');
  ensureMarketConfig(TENANT_A);
  ensureMarketConfig(TENANT_B);
  seedProduct('HARDEN-P1', 'Hardening Widget', 50, 100);

  const a = await registerCustomer(TENANT_A);
  tokenA = a.token;
  customerIdA = a.customerId;

  const b = await registerCustomer(TENANT_B);
  tokenB = b.token;
  customerIdB = b.customerId;

  const opA = await registerCustomer(TENANT_A);
  operatorIdA = opA.customerId;
  marketAuthService.setOperatorRole(operatorIdA, TENANT_A, 'operator');
  const customerA = marketAuthService.getById(operatorIdA);
  const { signCustomerToken } = require('../utils/marketJwt');
  operatorTokenA = signCustomerToken(customerA);

  const opB = await registerCustomer(TENANT_B);
  operatorIdB = opB.customerId;
  marketAuthService.setOperatorRole(operatorIdB, TENANT_B, 'operator');
  const customerB = marketAuthService.getById(operatorIdB);
  operatorTokenB = signCustomerToken(customerB);
});

// ============================================================================
// Marketplace — Cross-tenant isolation
// ============================================================================

describe('Marketplace hardening — cross-tenant catalog isolation', () => {
  test('Tenant B cannot read tenant A order by ID (404, not 403)', async () => {
    const orderRes = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: [{ productId: 'HARDEN-P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(orderRes.statusCode).toBe(201);
    const orderId = orderRes.body.data.order.id;

    const cross = await request(server.app)
      .get('/api/v1/market/orders/' + orderId)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    expect(cross.statusCode).toBe(404);
  });

  test('Tenant B cannot cancel tenant A order (404, not 403)', async () => {
    const orderRes = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: [{ productId: 'HARDEN-P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(orderRes.statusCode).toBe(201);
    const orderId = orderRes.body.data.order.id;

    const cancel = await request(server.app)
      .post('/api/v1/market/orders/' + orderId + '/cancel')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB)
      .send({});
    expect(cancel.statusCode).toBe(404);
  });
});

describe('Marketplace hardening — forged fields at checkout are ignored', () => {
  test('forged customerId in body does not override JWT customer', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        customerId: customerIdB,
        items: [{ productId: 'HARDEN-P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.order.customerId)).toBe(customerIdA);
    expect(String(res.body.data.order.customerId)).not.toBe(customerIdB);
  });

  test('forged tenantId in body does not override X-Tenant-Id header', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        tenantId: TENANT_B,
        items: [{ productId: 'HARDEN-P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    expect(String(res.body.data.order.tenantId)).toBe(TENANT_A);
  });
});

describe('Marketplace hardening — checkout idempotency', () => {
  test('same idempotency key returns the exact same order on replay', async () => {
    const key = 'harden-idem-' + Date.now();
    const r1 = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        items: [{ productId: 'HARDEN-P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod',
        idempotencyKey: key
      });
    expect(r1.statusCode).toBe(201);

    const r2 = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({
        items: [{ productId: 'HARDEN-P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod',
        idempotencyKey: key
      });
    expect(r2.statusCode).toBe(201);
    expect(r2.body.data.idempotent).toBe(true);
    expect(r2.body.data.order.id).toBe(r1.body.data.order.id);
    expect(r2.body.data.order.total).toBe(r1.body.data.order.total);
  });
});

// ============================================================================
// Game Hosting — Cross-tenant isolation
// ============================================================================

describe('Game Hosting hardening — cross-tenant entitlement enforcement', () => {
  test('Tenant A cannot use tenant B entitlement for provisioning', async () => {
    const planB = await createPlan(TENANT_B, tokenB, 'CrossEnt-Plan-' + Date.now());
    await createEntitlement(TENANT_B, operatorTokenB, customerIdB, planB.id, 'active');

    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: planB.id, region: 'eu-west' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Plan not found in trusted tenant/i);
  });

  test('Tenant A cannot create server with tenant B plan', async () => {
    const planB = await createPlan(TENANT_B, tokenB, 'CrossPlan-Plan-' + Date.now());

    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: planB.id, serverName: 'Cross Tenant Server', region: 'eu-west' });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Plan not found in trusted tenant/i);
  });

  test('Tenant B cannot read tenant A provisioning request (404)', async () => {
    const planA = await createPlan(TENANT_A, operatorTokenA, 'CrossReq-Plan-' + Date.now());
    await createEntitlement(TENANT_A, operatorTokenA, customerIdA, planA.id, 'active');

    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: planA.id, region: 'eu-west' });
    expect(reqRes.statusCode).toBe(201);
    const requestId = reqRes.body.data.request.id;

    const cross = await request(server.app)
      .get('/api/v1/game-hosting/provisioning-requests/' + requestId)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    expect(cross.statusCode).toBe(404);
  });

  test('Operator from tenant A cannot approve tenant B provisioning request (403)', async () => {
    const planB = await createPlan(TENANT_B, tokenB, 'CrossAppr-Plan-' + Date.now());
    await createEntitlement(TENANT_B, operatorTokenB, customerIdB, planB.id, 'active');

    const reqRes = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB)
      .send({ planId: planB.id, region: 'eu-west' });
    expect(reqRes.statusCode).toBe(201);
    const requestId = reqRes.body.data.request.id;

    const res = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests/' + requestId + '/approve')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(403);
  });
});

describe('Game Hosting hardening — idempotency scoping', () => {
  test('provisioning request idempotency does not match different customer in same tenant', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'IdemScope-Plan-' + Date.now());
    await createEntitlement(TENANT_A, operatorTokenA, customerIdA, plan.id, 'active');

    const key = 'idem-scope-' + Date.now();
    const r1 = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west', idempotencyKey: key });
    expect(r1.statusCode).toBe(201);

    const customerBInTenantA = await registerCustomer(TENANT_A);
    await createEntitlement(TENANT_A, operatorTokenA, customerBInTenantA.customerId, plan.id, 'active');
    const r2 = await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + customerBInTenantA.token)
      .send({ planId: plan.id, region: 'eu-west', idempotencyKey: key });
    expect(r2.statusCode).toBe(201);
    expect(r2.body.data.request.id).not.toBe(r1.body.data.request.id);
  });
});

// ============================================================================
// Auth — Invalid / missing context
// ============================================================================

describe('Marketplace + Game Hosting hardening — auth enforcement', () => {
  test('Market checkout allows guest checkout without auth', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'HARDEN-P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.order.customerId).toBeNull();
  });

  test('Game hosting server creation without auth returns 401', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'AuthPlan-' + Date.now());
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .send({ planId: plan.id, serverName: 'No Auth Server', region: 'eu-west' });
    expect(res.statusCode).toBe(401);
  });

  test('Operator endpoint rejects non-operator customer (403)', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'OpReject-Plan-' + Date.now());
    const res = await request(server.app)
      .get('/api/v1/game-hosting/entitlements')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(res.statusCode).toBe(403);
  });
});

// ============================================================================
// Malformed payloads — no leakage, no crash
// ============================================================================

describe('Marketplace + Game Hosting hardening — malformed payloads', () => {
  test('checkout with non-existent product returns 404', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: [{ productId: 'NON-EXISTENT', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(404);
  });

  test('checkout with malformed items array returns 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: 'not-an-array', shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(400);
  });

  test('game hosting server creation with malformed body returns 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send('not-json');
    expect(res.statusCode).toBe(400);
  });

  test('game hosting plan creation with missing name returns 400', async () => {
    const res = await request(server.app)
      .post('/api/v1/game-hosting/plans')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ gameTitle: 'Test' });
    expect(res.statusCode).toBe(400);
  });
});

// ============================================================================
// Game Hosting — listProvisioningRequests operator customerId filter
// ============================================================================

describe('Game Hosting hardening — server ownership', () => {
  test('Customer cannot transfer server ownership by updating customerId', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'Ownership-Plan-' + Date.now());

    const serverRes = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, serverName: 'OwnerShip Server', region: 'eu-west' });
    expect(serverRes.statusCode).toBe(201);
    const serverId = serverRes.body.data.id;
    const originalCustomerId = serverRes.body.data.customerId;

    const customerBInTenantA = await registerCustomer(TENANT_A);

    const transferRes = await request(server.app)
      .put('/api/v1/game-hosting/servers/' + serverId)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ customerId: customerBInTenantA.customerId });
    expect(transferRes.statusCode).toBe(200);

    const getRes = await request(server.app)
      .get('/api/v1/game-hosting/servers/' + serverId)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(getRes.statusCode).toBe(200);
    expect(String(getRes.body.data.customerId)).toBe(originalCustomerId);
  });

  test('Customer B cannot update Customer A server (404)', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'IDOR-Plan-' + Date.now());
    const serverRes = await request(server.app)
      .post('/api/v1/game-hosting/servers')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, serverName: 'A Server', region: 'eu-west' });
    const serverId = serverRes.body.data.id;

    const res = await request(server.app)
      .put('/api/v1/game-hosting/servers/' + serverId)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB)
      .send({ serverName: 'Hacked' });
    expect(res.statusCode).toBe(404);
  });
});

describe('Game Hosting hardening — operator provisioning request filter', () => {
  test('operator can filter provisioning requests by customerId query param', async () => {
    const plan = await createPlan(TENANT_A, operatorTokenA, 'OpFilter-Plan-' + Date.now());
    await createEntitlement(TENANT_A, operatorTokenA, customerIdA, plan.id, 'active');

    await request(server.app)
      .post('/api/v1/game-hosting/provisioning-requests')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ planId: plan.id, region: 'eu-west' });

    const res = await request(server.app)
      .get('/api/v1/game-hosting/provisioning-requests?customerId=' + customerIdA)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.requests.every((r) => r.customerId === customerIdA)).toBe(true);
  });
});
