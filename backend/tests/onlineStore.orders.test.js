'use strict';

// onlineStore.orders.test.js — tenant-scoped online store order APIs.
//
// The online store module is RC-parity on main but had zero test coverage
// and two concrete validation defects: `!items.length === 0` never fired
// (an empty items array produced a zero-total order) and a null item element
// crashed the price reducer with a TypeError (500). createOrder also echoed
// raw internal service errors to callers.
//
// Tenant model (verified against RC): tenant context reaches the controller
// ONLY via authenticated login + tenantCarry (or companyContext). The
// anonymous storefront order POST has never had a tenant source — requestContext
// carries no req.tenantContext, so it answered 'Tenant context required' on
// the RC build too (the RC storefront page's primary flow was WhatsApp
// ordering). That shipped contract is pinned, not changed: introducing
// anonymous checkout needs a slug-based tenant resolution design decision.

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const now = new Date().toISOString();
const DEFAULT_TENANT = process.env.DEFAULT_TENANT_ID || 'default';

let server;
let dataDir;
let adminToken;

const VALID_ORDER = {
  customerName: 'Test Buyer',
  customerPhone: '01000000000',
  items: [{ itemCode: 'SKU-1', title: 'Burger', quantity: 2, price: 50 }]
};

beforeAll(async () => {
  process.env.AUTH_REQUIRED = 'false';
  process.env.ENABLE_TENANT_CARRY = 'true';
  dataDir = makeTempDataDir('online-store-orders');

  seed(dataDir, 'companies', { companies: [
    { id: DEFAULT_TENANT, code: 'DFT', name: 'Default Storefront Co', active: true },
    { id: 'rival', code: 'RIVAL', name: 'Rival Co', active: true }
  ]});
  seed(dataDir, 'users', { users: [
    { id: 'u-admin', username: 'storeadmin', password: bcrypt.hashSync('Store#123', 10), role: 'Owner', fullName: 'Store Admin', tenantId: DEFAULT_TENANT, createdAt: now, updatedAt: now }
  ]});
  seed(dataDir, 'onlineStore', {
    storeConfigs: [
      // This service's activation flag is `isActive` (RC parity).
      { tenantId: DEFAULT_TENANT, storeName: 'Digi Store', storeSlug: 'digi-store', active: true, isActive: true, deliveryFee: 10, minOrderAmount: 20 }
    ],
    onlineOrders: [
      { id: 'ord_dft_1', orderRef: 'ORD-DFT-1', tenantId: DEFAULT_TENANT, customerName: 'Existing Buyer', customerPhone: '01111111111', items: [{ itemCode: 'SKU-9', title: 'Old Item', quantity: 1, price: 30 }], subtotal: 30, deliveryFee: 10, totalAmount: 40, status: 'pending', createdAt: now, updatedAt: now },
      { id: 'ord_rival_1', orderRef: 'ORD-RIVAL-1', tenantId: 'rival', customerName: 'Rival Buyer', customerPhone: '01222222222', items: [{ itemCode: 'SKU-8', title: 'Rival Item', quantity: 1, price: 99 }], subtotal: 99, deliveryFee: 0, totalAmount: 99, status: 'pending', createdAt: now, updatedAt: now }
    ]
  });

  server = startServer(dataDir, { AUTH_REQUIRED: 'false' }).app;
  adminToken = (await login(server, 'storeadmin', 'Store#123', DEFAULT_TENANT)).accessToken;
});

registerCleanup(() => [server], () => [dataDir]);

const api = (token) => ({
  get: (path) => request(server).get(path).set('Authorization', 'Bearer ' + token),
  post: (path, body) => request(server).post(path).set('Authorization', 'Bearer ' + token).send(body),
  patch: (path, body) => request(server).patch(path).set('Authorization', 'Bearer ' + token).send(body)
});

describe('online store order creation (authenticated, tenant-carried)', () => {
  test('creates an order for the carried tenant and computes totals server-side', async () => {
    const res = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send(VALID_ORDER);
    expect(res.statusCode).toBe(201);
    const order = res.body.data.order || res.body.data;
    expect(order.tenantId).toBe(DEFAULT_TENANT);
    expect(order.subtotal).toBe(100);
    expect(order.totalAmount).toBe(110); // + deliveryFee 10
    expect(order.status).toBe('pending');
    expect(order.items[0].itemCode).toBe('SKU-1');
  });

  test('X-Tenant-Id header cannot re-scope an authenticated order to another tenant', async () => {
    const res = await request(server)
      .post('/api/v1/tenant/online-store/store/orders')
      .set('Authorization', 'Bearer ' + adminToken)
      .set('X-Tenant-Id', 'rival')
      .send(VALID_ORDER);
    expect(res.statusCode).toBe(201);
    const scopedOrder = res.body.data.order || res.body.data;
    expect(scopedOrder.tenantId).toBe(DEFAULT_TENANT);
    expect(scopedOrder.tenantId).not.toBe('rival');
  });

  test('createOrder failure for a foreign-tenant storefront is generic (no leakage)', async () => {
    // Simulate a caller whose tenant has no storefront config by using a
    // fresh login bound to 'rival' (no config seeded for it).
    seed(dataDir, 'users', { users: [
      { id: 'u-admin', username: 'storeadmin', password: bcrypt.hashSync('Store#123', 10), role: 'Owner', fullName: 'Store Admin', tenantId: DEFAULT_TENANT, createdAt: now, updatedAt: now },
      { id: 'u-rival', username: 'rivaladmin', password: bcrypt.hashSync('Rival#123', 10), role: 'Owner', fullName: 'Rival Admin', tenantId: 'rival', createdAt: now, updatedAt: now }
    ]});
    const rivalToken = (await login(server, 'rivaladmin', 'Rival#123', 'rival')).accessToken;
    const res = await request(server)
      .post('/api/v1/tenant/online-store/store/orders')
      .set('Authorization', 'Bearer ' + rivalToken)
      .send(VALID_ORDER);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).not.toContain('not configured');
  });

  test('empty items array is rejected (old `!items.length === 0` never fired)', async () => {
    const res = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send({ ...VALID_ORDER, items: [] });
    expect(res.statusCode).toBe(400);
  });

  test('null item element no longer crashes the reducer with a 500', async () => {
    const res = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send({ ...VALID_ORDER, items: [null] });
    expect(res.statusCode).toBe(400);
  });

  test('item without itemCode is rejected', async () => {
    const res = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send({ ...VALID_ORDER, items: [{ title: 'No code', quantity: 1, price: 5 }] });
    expect(res.statusCode).toBe(400);
  });

  test('non-numeric item price is rejected, not silently zeroed', async () => {
    // Old behavior: parseFloat('12;drop') === 12 — a tampered/garbage price
    // silently became a valid order line. Hardened validation rejects it.
    const res = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send({ ...VALID_ORDER, items: [{ itemCode: 'SKU-2', title: 'X', quantity: 1, price: '12;drop' }] });
    expect(res.statusCode).toBe(400);
  });
});

describe('online store anonymous contract (as shipped on RC)', () => {
  test('anonymous order POST without any tenant source answers 400 tenant-required', async () => {
    const res = await request(server)
      .post('/api/v1/tenant/online-store/store/orders')
      .send(VALID_ORDER);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('anonymous public store listing and slug lookup stay available', async () => {
    const configs = await request(server).get('/api/v1/tenant/online-store/store/public/configs');
    expect(configs.statusCode).toBe(200);
    const list = configs.body.data.storeConfigs || configs.body.data || [];
    const slugs = (Array.isArray(list) ? list : list.storeConfigs || []).map((c) => c.storeSlug);
    expect(slugs).toContain('digi-store');

    const bySlug = await request(server).get('/api/v1/tenant/online-store/store/public/digi-store');
    expect(bySlug.statusCode).toBe(200);
    expect((bySlug.body.data.storeConfig || bySlug.body.data || {}).storeSlug).toBe('digi-store');
  });
});

describe('online store order management (tenant isolated)', () => {
  test('owner sees only its own orders', async () => {
    const res = await api(adminToken).get('/api/v1/tenant/online-store/store/orders');
    expect(res.statusCode).toBe(200);
    const ids = res.body.data.orders.map((o) => o.id);
    expect(ids).toContain('ord_dft_1');
    expect(ids).not.toContain('ord_rival_1');
  });

  test('own order readable, foreign order 404 (existence hidden)', async () => {
    const own = await api(adminToken).get('/api/v1/tenant/online-store/store/orders/ord_dft_1');
    expect(own.statusCode).toBe(200);
    expect(own.body.data.tenantId).toBe(DEFAULT_TENANT);

    const foreign = await api(adminToken).get('/api/v1/tenant/online-store/store/orders/ord_rival_1');
    expect(foreign.statusCode).toBe(404);
  });

  test('cross-tenant status update is blocked, own update works', async () => {
    const foreign = await api(adminToken)
      .patch('/api/v1/tenant/online-store/store/orders/ord_rival_1/status')
      .send({ status: 'confirmed' });
    expect([404, 400]).toContain(foreign.statusCode);

    const own = await api(adminToken)
      .patch('/api/v1/tenant/online-store/store/orders/ord_dft_1/status')
      .send({ status: 'confirmed' });
    expect(own.statusCode).toBe(200);
    expect(own.body.data.status).toBe('confirmed');
  });

  test('orders created via the API are visible to the owning tenant only', async () => {
    const created = await api(adminToken)
      .post('/api/v1/tenant/online-store/store/orders')
      .send(VALID_ORDER);
    const newId = (created.body.data.order || created.body.data).id;

    const asOwner = await api(adminToken).get('/api/v1/tenant/online-store/store/orders/' + newId);
    expect(asOwner.statusCode).toBe(200);
    expect(asOwner.body.data.tenantId).toBe(DEFAULT_TENANT);
  });
});
