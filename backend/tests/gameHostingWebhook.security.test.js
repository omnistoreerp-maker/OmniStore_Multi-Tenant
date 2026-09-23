'use strict';

// gameHostingWebhook.security.test.js — Gaming payment-webhook HMAC gate.
// Proves the shared verifyPaymentsWebhookSignature pattern on
// POST /api/v1/game-hosting/payment-webhook:
//   - fail-closed when PAYMENTS_WEBHOOK_SECRET is unset
//   - missing / invalid signature rejected before any order mutation
//   - valid HMAC-SHA256 of the RAW body is accepted and can mark paid
//   - malformed payloads still cannot bypass verification
//   - no unauthorized payment-state mutation

const crypto = require('crypto');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

const WEBHOOK_SECRET = 'gh-test-webhook-secret';
const ORIGINAL_SECRET = process.env.PAYMENTS_WEBHOOK_SECRET;

const tempDirs = [];

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
}

function mkRes() {
  return {
    _code: null,
    _body: null,
    status(code) { this._code = code; return this; },
    json(body) { this._body = body; return this; }
  };
}

describe('game hosting webhook — shared HMAC middleware (unit)', () => {
  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.PAYMENTS_WEBHOOK_SECRET;
    else process.env.PAYMENTS_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  test('fails closed (403) when no secret is configured', () => {
    jest.resetModules();
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const res = mkRes();
    const next = jest.fn();
    verifyPaymentsWebhookSignature({ headers: {}, rawBody: Buffer.from('{}') }, res, next);
    expect(res._code).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects missing signature with 401', () => {
    jest.resetModules();
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const raw = Buffer.from(JSON.stringify({ orderId: 'x', paymentRef: 'r', status: 'paid', amount: 1 }));
    const res = mkRes();
    const next = jest.fn();
    verifyPaymentsWebhookSignature({ headers: {}, rawBody: raw }, res, next);
    expect(res._code).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('rejects invalid signature with 401 (timing-safe compare path)', () => {
    jest.resetModules();
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const raw = Buffer.from(JSON.stringify({ orderId: 'x', paymentRef: 'r', status: 'paid', amount: 1 }));
    const res = mkRes();
    const next = jest.fn();
    verifyPaymentsWebhookSignature(
      { headers: { 'x-payments-signature': sign('wrong-secret', raw) }, rawBody: raw },
      res,
      next
    );
    expect(res._code).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test('accepts a valid HMAC-SHA256 of the raw body', () => {
    jest.resetModules();
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const raw = Buffer.from(JSON.stringify({ orderId: 'x', paymentRef: 'r', status: 'paid', amount: 1 }));
    const next = jest.fn();
    verifyPaymentsWebhookSignature(
      { headers: { 'x-payments-signature': sign(WEBHOOK_SECRET, raw) }, rawBody: raw },
      mkRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('game hosting webhook — HTTP surface', () => {
  let dataDir;
  let app;
  let orderService;
  let ghService;
  let marketConfig;

  const H = { 'X-Tenant-Id': 'default', 'Content-Type': 'application/json' };

  async function seedPendingOrder(amount) {
    const planRes = await ghService.createPlan({
      data: {
        name: 'wh-plan-' + Math.random().toString(36).slice(2, 8),
        gameTitle: 'Minecraft',
        pricePerMonth: amount,
        status: 'active'
      },
      tenantContext: { tenantId: 'default' }
    });
    if (planRes.error) throw new Error(planRes.error);
    const orderRes = await orderService.createOrder({
      data: {
        planId: planRes.plan.id,
        billingPeriod: '1m',
        serverName: 'wh-srv-' + Math.random().toString(36).slice(2, 6),
        customerId: 'wh-customer'
      },
      tenantContext: { tenantId: 'default' }
    });
    if (orderRes.error) throw new Error(orderRes.error);
    return orderRes.order;
  }

  async function getOrder(id) {
    return orderService.getOrderById({ id, tenantContext: { tenantId: 'default' } });
  }

  async function seedTenantConfig(tenantId) {
    const BaseRepository = require('../repositories/BaseRepository');
    const repo = new BaseRepository('marketConfig');
    const db = await repo.readAsync();
    if (!Array.isArray(db.configs)) db.configs = [];
    if (db.configs.some((c) => String(c.tenantId) === String(tenantId))) return;
    db.configs.push({
      tenantId: String(tenantId),
      enabled: true,
      storeName: 'Tenant ' + tenantId,
      currency: 'USD',
      locale: 'en',
      shippingZones: [],
      paymentMethods: [],
      coupons: [],
      priceOverrides: {},
      productVisibility: { includeAll: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    await repo.writeAsync(db);
  }

  async function seedPendingOrderFor(tenantId, amount) {
    const planRes = await ghService.createPlan({
      data: {
        name: 'wh-plan-' + tenantId + '-' + Math.random().toString(36).slice(2, 8),
        gameTitle: 'Minecraft',
        pricePerMonth: amount,
        status: 'active'
      },
      tenantContext: { tenantId }
    });
    if (planRes.error) throw new Error(planRes.error);
    const orderRes = await orderService.createOrder({
      data: {
        planId: planRes.plan.id,
        billingPeriod: '1m',
        serverName: 'wh-srv-' + tenantId + '-' + Math.random().toString(36).slice(2, 6),
        customerId: 'wh-customer-' + tenantId
      },
      tenantContext: { tenantId }
    });
    if (orderRes.error) throw new Error(orderRes.error);
    return orderRes.order;
  }

  async function getRawOrder(id) {
    const BaseRepository = require('../repositories/BaseRepository');
    const repo = new BaseRepository('gameHostingOrders');
    const db = await repo.readAsync();
    return (db.orders || []).find((o) => o && String(o.id) === String(id)) || null;
  }

  async function forceOrderStatus(id, status) {
    const BaseRepository = require('../repositories/BaseRepository');
    const repo = new BaseRepository('gameHostingOrders');
    const db = await repo.readAsync();
    const o = (db.orders || []).find((x) => x && String(x.id) === String(id));
    if (!o) throw new Error('order not found for force status');
    o.status = status;
    if (o.paymentStatus !== 'paid') o.paymentStatus = 'pending';
    await repo.writeAsync(db);
    return o;
  }

  beforeAll(async () => {
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    dataDir = makeTempDataDir('gh-webhook-sec');
    tempDirs.push(dataDir);
    ({ app } = startServer(dataDir));
    marketConfig = require('../services/marketConfig.service');
    marketConfig.ensureSeeded();
    await seedTenantConfig('tenant-b');
    orderService = require('../services/gameHostingOrder.service');
    ghService = require('../services/gameHosting.service');
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.PAYMENTS_WEBHOOK_SECRET;
    else process.env.PAYMENTS_WEBHOOK_SECRET = ORIGINAL_SECRET;
    delete process.env.DIGITRONICS_DATA_DIR;
  });

  test('unsigned webhook is rejected (never 200) and does not mutate payment state', async () => {
    const order = await seedPendingOrder(20);
    expect(order.status).toBe('pending');
    expect(order.paymentStatus).toBe('pending');

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .send({ orderId: order.id, paymentRef: 'WH-UNSIGNED-1', status: 'paid', amount: order.amount });

    expect([401, 403]).toContain(res.status);
    expect(res.status).not.toBe(200);

    const after = await getOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('invalid signature is rejected (401) and does not mutate payment state', async () => {
    const order = await seedPendingOrder(25);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-BAD-SIG-1',
      status: 'paid',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign('attacker-secret', raw))
      .send(raw);

    expect(res.status).toBe(401);

    const after = await getOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('missing signature header is rejected (401) and does not mutate payment state', async () => {
    const order = await seedPendingOrder(30);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-NO-SIG-1',
      status: 'paid',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .send(raw);

    expect(res.status).toBe(401);

    const after = await getOrder(order.id);
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('valid signature over raw body flips a pending order to paid', async () => {
    const order = await seedPendingOrder(20);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-VALID-1',
      status: 'paid',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paid');

    const after = await getOrder(order.id);
    expect(after.status).toBe('paid');
    expect(after.paymentStatus).toBe('paid');
    expect(after.paymentRef).toBe('WH-VALID-1');
  });

  test('valid signature on malformed payload is rejected without marking paid', async () => {
    const order = await seedPendingOrder(40);
    // status is invalid for applyPaymentResult even with a valid signature
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-MALFORMED-1',
      status: 'ADMIN_APPROVED',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);

    const after = await getOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
  });

  test('valid signature with tampered amount is rejected (amount integrity)', async () => {
    const order = await seedPendingOrder(50);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-TAMPER-AMT',
      status: 'paid',
      amount: 0.01
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);

    const after = await getOrder(order.id);
    expect(after.paymentStatus).toBe('pending');
    expect(after.status).toBe('pending');
  });

  test('forged paid without signature never mutates a real order', async () => {
    const order = await seedPendingOrder(15);
    const forged = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .send({ orderId: order.id, paymentRef: 'WH-FORGE-1', status: 'paid', amount: order.amount });
    expect(forged.status).not.toBe(200);

    const after = await getOrder(order.id);
    expect(after.paymentStatus).toBe('pending');
    expect(after.status).toBe('pending');
  });

  test('tenant A valid-HMAC webhook cannot mutate tenant B order (cross-tenant isolation)', async () => {
    const orderB = await seedPendingOrderFor('tenant-b', 60);
    expect(orderB.tenantId).toBe('tenant-b');
    const before = await getRawOrder(orderB.id);
    expect(before.status).toBe('pending');
    expect(before.paymentStatus).toBe('pending');

    const raw = JSON.stringify({
      orderId: orderB.id,
      paymentRef: 'WH-X-TENANT-AB',
      status: 'paid',
      amount: orderB.amount
    });

    // Attacker controls X-Tenant-Id: default (tenant A) + body tenantId claim,
    // with a valid shared HMAC + known orderId + correct amount.
    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set('X-Tenant-Id', 'default')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);
    expect(String(res.body.message || res.body.error || '')).toMatch(/Order not found/i);

    const after = await getRawOrder(orderB.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
    expect(after.paymentRef).toBeNull();
  });

  test('body tenantId claim is never trusted over the header tenant', async () => {
    const orderB = await seedPendingOrderFor('tenant-b', 65);
    const raw = JSON.stringify({
      orderId: orderB.id,
      paymentRef: 'WH-BODY-CLAIM-1',
      status: 'paid',
      amount: orderB.amount,
      tenantId: 'tenant-b'
    });

    // Header = tenant A; body claims tenant-b. Header wins → still cross-tenant.
    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set('X-Tenant-Id', 'default')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);

    const after = await getRawOrder(orderB.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('tenant B valid-HMAC webhook may pay tenant B pending order (allowed path)', async () => {
    const orderB = await seedPendingOrderFor('tenant-b', 70);
    const raw = JSON.stringify({
      orderId: orderB.id,
      paymentRef: 'WH-TENANT-B-OK',
      status: 'paid',
      amount: orderB.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set('X-Tenant-Id', 'tenant-b')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paid');

    const after = await getRawOrder(orderB.id);
    expect(after.status).toBe('paid');
    expect(after.paymentStatus).toBe('paid');
    expect(after.tenantId).toBe('tenant-b');
    expect(after.paymentRef).toBe('WH-TENANT-B-OK');
  });

  test('missing X-Tenant-Id is rejected before any order mutation', async () => {
    const order = await seedPendingOrder(80);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-NO-TENANT-1',
      status: 'paid',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);

    const after = await getRawOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('unknown tenant is rejected (404) before any order mutation', async () => {
    const order = await seedPendingOrder(85);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-UNKNOWN-TENANT-1',
      status: 'paid',
      amount: order.amount
    });

    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set('X-Tenant-Id', 'ghost-tenant-not-seeded')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(404);

    const after = await getRawOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('applyPaymentResult fails closed when tenant context is missing/null', async () => {
    const order = await seedPendingOrder(90);
    const cases = [
      undefined,
      null,
      {},
      { tenantId: null },
      { tenantId: '' }
    ];
    for (const tenantContext of cases) {
      const r = await orderService.applyPaymentResult({
        orderId: order.id,
        tenantContext,
        paymentRef: 'WH-NULL-TENANT-1',
        amount: order.amount,
        status: 'paid'
      });
      expect(r.error).toBe('tenant context is required');
    }
    const after = await getRawOrder(order.id);
    expect(after.status).toBe('pending');
    expect(after.paymentStatus).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });

  test('terminal order status=cancelled never absorbs a paid webhook', async () => {
    const order = await seedPendingOrder(100);
    await forceOrderStatus(order.id, 'cancelled');
    const before = await getRawOrder(order.id);
    expect(before.status).toBe('cancelled');

    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-TERM-CANCELLED',
      status: 'paid',
      amount: order.amount
    });
    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);
    const after = await getRawOrder(order.id);
    expect(after.status).toBe('cancelled');
    expect(after.paymentStatus).not.toBe('paid');
    expect((after.payments || []).length).toBe(0);
  });

  test('terminal order status=terminated never absorbs a paid webhook', async () => {
    const order = await seedPendingOrder(105);
    await forceOrderStatus(order.id, 'terminated');

    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-TERM-TERMINATED',
      status: 'paid',
      amount: order.amount
    });
    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);
    const after = await getRawOrder(order.id);
    expect(after.status).toBe('terminated');
    expect(after.paymentStatus).not.toBe('paid');
    expect((after.payments || []).length).toBe(0);
  });

  test('terminal order status=expired never absorbs a paid webhook', async () => {
    const order = await seedPendingOrder(110);
    await forceOrderStatus(order.id, 'expired');

    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-TERM-EXPIRED',
      status: 'paid',
      amount: order.amount
    });
    const res = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);

    expect(res.status).toBe(400);
    const after = await getRawOrder(order.id);
    expect(after.status).toBe('expired');
    expect(after.paymentStatus).not.toBe('paid');
    expect((after.payments || []).length).toBe(0);
  });

  test('payment idempotency: same paymentRef replay does not double-apply', async () => {
    const order = await seedPendingOrder(120);
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-IDEM-1',
      status: 'paid',
      amount: order.amount
    });
    const signed = (body) =>
      request(app)
        .post('/api/v1/game-hosting/payment-webhook')
        .set(H)
        .set('x-payments-signature', sign(WEBHOOK_SECRET, body))
        .send(body);

    const first = await signed(raw);
    expect(first.status).toBe(200);
    expect(first.body.data.alreadyProcessed).toBeFalsy();

    const second = await signed(raw);
    expect(second.status).toBe(200);
    expect(second.body.data.alreadyProcessed).toBe(true);

    const after = await getRawOrder(order.id);
    expect(after.status).toBe('paid');
    expect(after.paymentStatus).toBe('paid');
    expect((after.payments || []).filter((p) => p.paymentRef === 'WH-IDEM-1').length).toBe(1);
  });
});

describe('game hosting webhook — fail-closed when secret unset', () => {
  let dataDir;
  let app;
  let orderService;
  let ghService;
  const H = { 'X-Tenant-Id': 'default', 'Content-Type': 'application/json' };

  beforeAll(() => {
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    dataDir = makeTempDataDir('gh-webhook-nosecret');
    tempDirs.push(dataDir);
    ({ app } = startServer(dataDir));
    require('../services/marketConfig.service').ensureSeeded();
    orderService = require('../services/gameHostingOrder.service');
    ghService = require('../services/gameHosting.service');
  });

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.PAYMENTS_WEBHOOK_SECRET;
    else process.env.PAYMENTS_WEBHOOK_SECRET = ORIGINAL_SECRET;
    delete process.env.DIGITRONICS_DATA_DIR;
  });

  test('no secret configured → 403 for signed and unsigned alike; no mutation', async () => {
    const planRes = await ghService.createPlan({
      data: { name: 'ns-plan', gameTitle: 'Minecraft', pricePerMonth: 20, status: 'active' },
      tenantContext: { tenantId: 'default' }
    });
    const orderRes = await orderService.createOrder({
      data: { planId: planRes.plan.id, billingPeriod: '1m', serverName: 'ns-srv', customerId: 'c' },
      tenantContext: { tenantId: 'default' }
    });
    const order = orderRes.order;
    const raw = JSON.stringify({
      orderId: order.id,
      paymentRef: 'WH-NOSECRET-1',
      status: 'paid',
      amount: order.amount
    });

    const unsigned = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .send(raw);
    expect(unsigned.status).toBe(403);

    const signed = await request(app)
      .post('/api/v1/game-hosting/payment-webhook')
      .set(H)
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);
    expect(signed.status).toBe(403);

    const after = await orderService.getOrderById({ id: order.id, tenantContext: { tenantId: 'default' } });
    expect(after.paymentStatus).toBe('pending');
    expect(after.status).toBe('pending');
    expect((after.payments || []).length).toBe(0);
  });
});

registerCleanup(() => [], () => tempDirs);
