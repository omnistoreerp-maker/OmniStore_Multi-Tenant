'use strict';

// marketM4.test.js — Phase M4: Cross-tenant + forged-field security regression.
//
// This suite covers the SECURITY acceptance criteria from the Drive 1
// protocol (§5, §8). Every test must pass; every unauthorized attempt
// must fail safely. The tests are independent of M1/M2/M3 unit tests
// and exercise the full HTTP stack via supertest.
//
// Coverage:
//   §8 — Tenant A → Tenant B product (catalog + checkout)
//   §8 — Tenant A → Tenant B order
//   §8 — Tenant A → forged tenant header
//   §8 — Tenant A → forged tenant query
//   §8 — Tenant A → forged tenant body
//   §8 — Tenant A → forged customer ID
//   §8 — Tenant A → manipulated price
//   §8 — Tenant A → manipulated total
//   §8 — Tenant A → manipulated quantity
//   §8 — Tenant A → oversell

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

function seedProduct(id, name, sellPrice, stockQty) {
  const db = readStore('products') || { products: [] };
  if (!db.products) db.products = [];
  if (db.products.some((p) => p.id === id)) return;
  db.products.push({ id, name, sku: 'SKU-' + id, sellPrice, stockQty, categoryId: 'cat1' });
  writeStore('products', db);
}

function setMarketConfig(tenantId, patch) {
  const db = readStore('marketConfig') || { configs: [] };
  let cfg = db.configs.find((c) => String(c.tenantId) === String(tenantId));
  if (!cfg) {
    cfg = {
      tenantId: String(tenantId),
      enabled: true,
      storeName: 'OmniStore Market ' + tenantId,
      currency: 'USD',
      locale: 'en',
      shippingZones: [{ id: 'standard', name: 'Standard', countries: [], fee: 10, freeAbove: 200 }],
      paymentMethods: [{ id: 'cod', name: 'COD', type: 'offline', active: true }],
      coupons: [],
      priceOverrides: {},
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    db.configs.push(cfg);
  }
  Object.assign(cfg, patch);
  writeStore('marketConfig', db);
}

beforeAll(async () => {
  dataDir = makeTempDataDir('marketM4');
  server = await startServer(dataDir);
  seedProduct('P1', 'Widget A', 50, 100);
  seedProduct('P2', 'Widget B', 100, 50);
  // Ensure tenant B exists in marketConfig
  setMarketConfig(TENANT_B, { enabled: true });
});

describe('M4 — Cross-tenant product isolation at catalog', () => {
  test('Tenant B with includeAll:false and included=[] sees no products', async () => {
    setMarketConfig(TENANT_B, {
      productVisibility: { includeAll: false, included: [] }
    });
    const res = await request(server.app)
      .get('/api/v1/market/products')
      .query({ tenant: TENANT_B });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.products).toEqual([]);
  });

  test('Tenant B with includeAll:false and included=[P2] sees only P2', async () => {
    setMarketConfig(TENANT_B, {
      productVisibility: { includeAll: false, included: ['P2'] }
    });
    const res = await request(server.app)
      .get('/api/v1/market/products')
      .query({ tenant: TENANT_B });
    expect(res.statusCode).toBe(200);
    const ids = res.body.data.products.map((p) => p.id);
    expect(ids).toEqual(['P2']);
  });

  test('Tenant B cannot retrieve a product not in its allowlist (returns null/404)', async () => {
    setMarketConfig(TENANT_B, {
      productVisibility: { includeAll: false, included: ['P2'] }
    });
    const res = await request(server.app)
      .get('/api/v1/market/products/P1')
      .query({ tenant: TENANT_B });
    // getProduct returns null when the product is not visible; the
    // controller returns 404.
    expect(res.statusCode).toBe(404);
  });

  test('Tenant B cannot check availability for a product not in its allowlist (hidden=true)', async () => {
    setMarketConfig(TENANT_B, {
      productVisibility: { includeAll: false, included: ['P2'] }
    });
    const res = await request(server.app)
      .get('/api/v1/market/availability')
      .query({ tenant: TENANT_B, ids: 'P1,P2' });
    expect(res.statusCode).toBe(200);
    const p1 = res.body.data.availability.find((a) => a.id === 'P1');
    expect(p1.hidden).toBe(true);
    expect(p1.available).toBe(false);
  });

  // Reset tenant B for the remaining tests
  afterAll(() => {
    setMarketConfig(TENANT_B, { productVisibility: { includeAll: true } });
  });
});

describe('M4 — Cross-tenant checkout rejection', () => {
  test('Tenant B cannot purchase a product not in its allowlist', async () => {
    setMarketConfig(TENANT_B, {
      productVisibility: { includeAll: false, included: ['P2'] }
    });
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_B)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toMatch(/not available/i);
    // Reset
    setMarketConfig(TENANT_B, { productVisibility: { includeAll: true } });
  });
});

describe('M4 — Forged tenant body at checkout is ignored', () => {
  test('body.tenantId does NOT override X-Tenant-Id header', async () => {
    const stockBefore = readStore('products').products.find((p) => p.id === 'P1').stockQty;
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({
        tenantId: TENANT_B,
        items: [{ productId: 'P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    const order = res.body.data.order;
    // The order must be stamped with the header tenant (A), not the body tenant (B).
    expect(String(order.tenantId)).toBe(TENANT_A);
    // Stock must have been decremented from tenant A's products (global store).
    const stockAfter = readStore('products').products.find((p) => p.id === 'P1').stockQty;
    expect(stockAfter).toBe(stockBefore - 1);
  });
});

describe('M4 — Forged customerId at checkout is ignored', () => {
  test('body.customerId does NOT override authenticated customer from JWT', async () => {
    const reg = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_A)
      .send({ email: 'm4forged+' + Date.now() + '@test.com', password: 'Secret123' });
    expect(reg.statusCode).toBe(201);
    const token = reg.body.data.token;
    const realCustomerId = reg.body.data.customer.id;
    // Forge a different customerId in the body
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + token)
      .send({
        customerId: 'forged-customer-id-12345',
        items: [{ productId: 'P1', qty: 1 }],
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    const order = res.body.data.order;
    // The order must be stamped with the JWT customer, not the body.
    expect(String(order.customerId)).toBe(realCustomerId);
    expect(String(order.customerId)).not.toBe('forged-customer-id-12345');
  });
});

describe('M4 — Manipulated price at checkout is ignored', () => {
  test('body.unitPrice and body.total do NOT override server-computed values', async () => {
    const reg = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_A)
      .send({ email: 'm4price+' + Date.now() + '@test.com', password: 'Secret123' });
    const token = reg.body.data.token;
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + token)
      .send({
        items: [{ productId: 'P1', qty: 1, unitPrice: 0.01, price: 0.01 }],
        total: 0.01,
        subtotal: 0.01,
        shippingZoneId: 'standard',
        paymentMethodId: 'cod'
      });
    expect(res.statusCode).toBe(201);
    const order = res.body.data.order;
    // Server uses the product's sellPrice (50), not the body.
    expect(order.subtotal).toBe(50);
    expect(order.total).toBe(60);
  });
});

describe('M4 — Manipulated quantity at checkout is rejected', () => {
  test('qty=0 is rejected', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'P1', qty: 0 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(400);
  });

  test('qty=-1 is rejected', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'P1', qty: -1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(400);
  });

  test('qty as string is rejected', async () => {
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'P1', qty: 'abc' }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(400);
  });
});

describe('M4 — Oversell prevention', () => {
  test('checkout rejects when qty exceeds stock', async () => {
    seedProduct('P3', 'Widget C', 10, 2);
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'P3', qty: 5 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(409);
    expect(res.body.message).toMatch(/insufficient stock/i);
  });

  test('checkout succeeds when qty equals stock', async () => {
    seedProduct('P4', 'Widget D', 10, 1);
    const res = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .send({ items: [{ productId: 'P4', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    expect(res.statusCode).toBe(201);
  });
});

describe('M4 — Cross-tenant order access', () => {
  test('Tenant A cannot read Tenant B order (404, not 403)', async () => {
    // Place order as tenant A
    const regA = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_A)
      .send({ email: 'm4crossa+' + Date.now() + '@test.com', password: 'Secret123' });
    const tokenA = regA.body.data.token;
    const co = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    const orderA = co.body.data.order;
    // Register customer B in tenant B
    const regB = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_B)
      .send({ email: 'm4crossb+' + Date.now() + '@test.com', password: 'Secret123' });
    const tokenB = regB.body.data.token;
    // Customer B tries to read customer A's order
    const read = await request(server.app)
      .get('/api/v1/market/orders/' + orderA.id)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB);
    expect(read.statusCode).toBe(404);
  });

  test('Customer B cannot cancel Customer A order (404, not 403)', async () => {
    const regA = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_A)
      .send({ email: 'm4cancelA+' + Date.now() + '@test.com', password: 'Secret123' });
    const tokenA = regA.body.data.token;
    const co = await request(server.app)
      .post('/api/v1/market/checkout')
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA)
      .send({ items: [{ productId: 'P1', qty: 1 }], shippingZoneId: 'standard', paymentMethodId: 'cod' });
    const orderA = co.body.data.order;
    const regB = await request(server.app)
      .post('/api/v1/market/auth/register')
      .set('X-Tenant-Id', TENANT_B)
      .send({ email: 'm4cancelB+' + Date.now() + '@test.com', password: 'Secret123' });
    const tokenB = regB.body.data.token;
    const cancel = await request(server.app)
      .post('/api/v1/market/orders/' + orderA.id + '/cancel')
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenB)
      .send({});
    expect(cancel.statusCode).toBe(404);
    // Verify the order is unchanged
    const readBack = await request(server.app)
      .get('/api/v1/market/orders/' + orderA.id)
      .set('X-Tenant-Id', TENANT_A)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(readBack.body.data.status).toBe('received');
  });
});

describe('M4 — Unknown tenant rejection', () => {
  test('Unknown tenant in header returns 404', async () => {
    const res = await request(server.app)
      .get('/api/v1/market/products')
      .set('X-Tenant-Id', 'ghost-tenant-xyz');
    expect(res.statusCode).toBe(404);
  });

  test('Unknown tenant in query returns 404', async () => {
    const res = await request(server.app)
      .get('/api/v1/market/products')
      .query({ tenant: 'ghost-tenant-xyz' });
    expect(res.statusCode).toBe(404);
  });
});
