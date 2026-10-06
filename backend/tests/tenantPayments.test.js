'use strict';

// tenantPayments.test.js — O2 tenant payments: webhook signature enforcement,
// service status guards, and the async contract between controller and service.
//
// The webhook can flip a transaction to paid and auto-activate add-ons, so it
// must fail closed when no secret is configured and reject unsigned or
// tampered requests with 401.

const crypto = require('crypto');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const WEBHOOK_SECRET = 'test-webhook-secret';

const tempDirs = [];

const companies = [
  { id: 'digi', name: 'DigiTronics', code: 'DIGI', active: true },
  { id: 'cairo', name: 'CairoTech', code: 'CAIRO', active: true }
];

const users = { users: [
  {
    id: 'u-digi', username: 'digiUser', password: require('bcryptjs').hashSync(PASSWORD, 10), role: 'Owner',
    fullName: 'Digi User', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: 'u-cairo', username: 'cairoUser', password: require('bcryptjs').hashSync(PASSWORD, 10), role: 'Owner',
    fullName: 'Cairo User', tenantIds: ['cairo'], tenantRoles: { cairo: 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
] };

function sign(secret, body) {
  return crypto.createHmac('sha256', secret).update(Buffer.from(body, 'utf8')).digest('hex');
}

describe('tenant payments — webhook signature middleware (unit)', () => {
  const ORIGINAL_SECRET = process.env.PAYMENTS_WEBHOOK_SECRET;

  afterAll(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.PAYMENTS_WEBHOOK_SECRET;
    else process.env.PAYMENTS_WEBHOOK_SECRET = ORIGINAL_SECRET;
  });

  function mkRes() {
    return {
      _code: null,
      _body: null,
      status(code) { this._code = code; return this; },
      json(body) { this._body = body; return this; }
    };
  }

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

  test('rejects missing and tampered signatures with 401', () => {
    jest.resetModules();
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const raw = Buffer.from(JSON.stringify({ transactionRef: 'X', status: 'paid' }));

    const res1 = mkRes();
    const next1 = jest.fn();
    verifyPaymentsWebhookSignature({ headers: {}, rawBody: raw }, res1, next1);
    expect(res1._code).toBe(401);
    expect(next1).not.toHaveBeenCalled();

    const res2 = mkRes();
    const next2 = jest.fn();
    verifyPaymentsWebhookSignature(
      { headers: { 'x-payments-signature': sign('wrong-secret', raw) }, rawBody: raw },
      res2,
      next2
    );
    expect(res2._code).toBe(401);
    expect(next2).not.toHaveBeenCalled();
  });

  test('accepts a valid HMAC-SHA256 hex signature of the raw body', () => {
    jest.resetModules();
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');
    const raw = Buffer.from(JSON.stringify({ transactionRef: 'X', status: 'paid' }));
    const next = jest.fn();
    verifyPaymentsWebhookSignature(
      { headers: { 'x-payments-signature': sign(WEBHOOK_SECRET, raw) }, rawBody: raw },
      mkRes(),
      next
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('tenant payments — service status guards', () => {
  let dataDir;
  let service;

  beforeAll(() => {
    dataDir = makeTempDataDir('tenant-payments');
    tempDirs.push(dataDir);
    jest.resetModules();
    process.env.DIGITRONICS_DATA_DIR = dataDir;
    process.env.JWT_SECRET = 'test-jwt-secret-for-jest-suites';
    service = require('../services/tenantPayments.service');
  });

  test('rejects invalid webhook statuses instead of persisting them', async () => {
    const intent = await service.createPaymentIntent({ tenantId: 'digi', addonKey: 'starter', amount: 99 });
    await expect(service.updatePaymentStatus({ transactionRef: intent.transactionRef, status: 'PENDING_FINANCE_REVIEW' }))
      .rejects.toThrow(/Invalid payment status/);
    const after = await service.getPaymentByRef(intent.transactionRef);
    expect(after.status).toBe('pending');
  });

  test('paid is terminal: a webhook can never downgrade or replay it', async () => {
    const intent = await service.createPaymentIntent({ tenantId: 'digi', addonKey: 'starter', amount: 99 });
    await service.updatePaymentStatus({ transactionRef: intent.transactionRef, status: 'paid' });
    await expect(service.updatePaymentStatus({ transactionRef: intent.transactionRef, status: 'failed' }))
      .rejects.toThrow(/already paid/);
    const after = await service.getPaymentByRef(intent.transactionRef);
    expect(after.status).toBe('paid');
  });

  test('paid webhook auto-activates the purchased add-on for the right tenant', async () => {
    const intent = await service.createPaymentIntent({ tenantId: 'digi', addonKey: 'pro', amount: 199 });
    await service.updatePaymentStatus({ transactionRef: intent.transactionRef, status: 'paid' });
    const store = readStore(dataDir, 'tenantAddons');
    expect(store).toBeTruthy();
    const mine = (store.tenantAddons || []).filter((a) => String(a.tenantId) === 'digi');
    expect(mine.some((a) => a.addonKey === 'pro' && a.status === 'active')).toBe(true);
  });

  test('listPaymentsForTenant never returns another tenant transactions', async () => {
    await service.createPaymentIntent({ tenantId: 'digi', addonKey: 'a1', amount: 10 });
    await service.createPaymentIntent({ tenantId: 'cairo', addonKey: 'a2', amount: 20 });
    const digiKeys = (await service.listPaymentsForTenant('digi')).map((p) => p.addonKey);
    expect(digiKeys).toContain('a1');
    expect(digiKeys).not.toContain('a2');
  });
});

describe('tenant payments — HTTP surface (mounted routes)', () => {
  let server;
  let dataDir;

  let ORIGINAL_FLAGS;

  beforeAll(async () => {
    ORIGINAL_FLAGS = {
      CARRY: process.env.ENABLE_TENANT_CARRY,
      MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
      ROLES: process.env.ENABLE_TENANT_ROLES
    };
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.PAYMENTS_WEBHOOK_SECRET = WEBHOOK_SECRET;
    dataDir = makeTempDataDir('tenant-payments-http');
    tempDirs.push(dataDir);
    seed(dataDir, 'companies', companies);
    seed(dataDir, 'users', users);
    server = await startServer(dataDir, {
      RATE_LIMIT_MAX: '10000',
      AUTH_REQUIRED: 'true'
    });
  });

  afterAll(() => {
    delete process.env.PAYMENTS_WEBHOOK_SECRET;
    if (ORIGINAL_FLAGS.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_FLAGS.CARRY;
    if (ORIGINAL_FLAGS.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_FLAGS.MC;
    if (ORIGINAL_FLAGS.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_FLAGS.ROLES;
  });

  test('payment intent endpoints require authentication', async () => {
    const res = await request(server.app).post('/api/v1/payments/payments/intent').send({ addonKey: 'starter', amount: 10 });
    expect([401, 403]).toContain(res.status);
  });

  test('webhook without signature is rejected (never 200)', async () => {
    const res = await request(server.app)
      .post('/api/v1/payments/payments/webhook')
      .set('Content-Type', 'application/json')
      .send({ transactionRef: 'PAY-DOES-NOT-EXIST', status: 'paid' });
    expect([401, 403]).toContain(res.status);
  });

  test('webhook with a tampered signature is rejected with 401', async () => {
    const raw = JSON.stringify({ transactionRef: 'PAY-DOES-NOT-EXIST', status: 'paid' });
    const res = await request(server.app)
      .post('/api/v1/payments/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign('attacker-secret', raw))
      .send(raw);
    expect(res.status).toBe(401);
  });

  test('webhook with a VALID signature flips a real transaction to paid over HTTP', async () => {
    const digiToken = (await login(server.app, 'digiUser', PASSWORD, 'digi')).accessToken;

    const created = await request(server.app)
      .post('/api/v1/payments/payments/intent')
      .set('Authorization', 'Bearer ' + digiToken)
      .send({ addonKey: 'starter', amount: 49 });
    expect(created.status).toBe(200);
    const ref = created.body.data.transactionRef;
    expect(created.body.data.status).toBe('pending');
    expect(created.body.data.tenantId).toBe('digi');

    const raw = JSON.stringify({ transactionRef: ref, status: 'paid' });
    const res = await request(server.app)
      .post('/api/v1/payments/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('paid');

    const store = readStore(dataDir, 'tenantPaymentTransactions');
    const tx = (store.tenantPaymentTransactions || []).find((t) => t.transaction_ref === ref);
    expect(tx.status).toBe('paid');
  });

  test('tenant cannot read another tenant payment ref (same 404 as missing)', async () => {
    const digiToken = (await login(server.app, 'digiUser', PASSWORD, 'digi')).accessToken;
    const cairoToken = (await login(server.app, 'cairoUser', PASSWORD, 'cairo')).accessToken;

    const created = await request(server.app)
      .post('/api/v1/payments/payments/intent')
      .set('Authorization', 'Bearer ' + digiToken)
      .send({ addonKey: 'secret-addon', amount: 10 });
    const ref = created.body.data.transactionRef;

    const leaked = await request(server.app)
      .get('/api/v1/payments/payments/' + ref)
      .set('Authorization', 'Bearer ' + cairoToken);
    expect(leaked.status).toBe(404);

    const mine = await request(server.app)
      .get('/api/v1/payments/payments/' + ref)
      .set('Authorization', 'Bearer ' + digiToken);
    expect(mine.status).toBe(200);
    expect(mine.body.data.addonKey).toBe('secret-addon');
  });

  test('webhook cannot forge status with invalid value even with a valid signature', async () => {
    const digiToken = (await login(server.app, 'digiUser', PASSWORD, 'digi')).accessToken;
    const created = await request(server.app)
      .post('/api/v1/payments/payments/intent')
      .set('Authorization', 'Bearer ' + digiToken)
      .send({ addonKey: 'guard-addon', amount: 5 });
    const ref = created.body.data.transactionRef;

    const raw = JSON.stringify({ transactionRef: ref, status: 'ADMIN_APPROVED' });
    const res = await request(server.app)
      .post('/api/v1/payments/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-payments-signature', sign(WEBHOOK_SECRET, raw))
      .send(raw);
    expect(res.status).toBe(400);
  });
});

registerCleanup(() => [], () => tempDirs);
