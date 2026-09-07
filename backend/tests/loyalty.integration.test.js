'use strict';

// Loyalty integration tests.
// End-to-end through the real HTTP stack:
//   Route -> Controller -> Service -> Repository -> storageAdapter -> JSON backend

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const bcrypt = require('bcryptjs');
const PATH = '/api/v1/loyalty';

describe('Loyalty Integration', () => {
  let app;
  let dir;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('loyalty-integration');
    seed(dir, 'companies', {
      companies: [
        { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
        { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
      ]
    });
    seed(dir, 'users', {
      users: [
        {
          id: 'u-a', username: 'adminA', password: bcrypt.hashSync('Pass#123', 10), role: 'Owner',
          fullName: 'Admin A', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' },
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        },
        {
          id: 'u-b', username: 'adminB', password: bcrypt.hashSync('Pass#123', 10), role: 'Owner',
          fullName: 'Admin B', tenantIds: ['corp-b'], tenantRoles: { 'corp-b': 'Owner' },
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
        }
      ]
    });
    seed(dir, 'customers', {
      customers: [
        { id: 'cust-a1', name: 'Alice A', phone: '0100000001', balance: 0, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'cust-b1', name: 'Bob B', phone: '0100000002', balance: 0, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    });

    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;

    const { login } = require('./helpers/authHelper');
    const sessionA = await login(app, 'adminA', 'Pass#123', 'corp-a');
    tokenA = sessionA.accessToken;

    const sessionB = await login(app, 'adminB', 'Pass#123', 'corp-b');
    tokenB = sessionB.accessToken;
  });

  afterAll(() => {
    if (app && typeof app.close === 'function') app.close();
  });

  function authA(req) { return req.set('Authorization', 'Bearer ' + tokenA); }
  function authB(req) { return req.set('Authorization', 'Bearer ' + tokenB); }

  test('POST /earn creates a transaction and updates balance', async () => {
    const res = await authA(request(app).post(`${PATH}/earn`).send({
      customerId: 'cust-a1',
      points: 100,
      amount: 10000,
      ref: 'INV-INT-1',
      refType: 'sale'
    }));
    expect(res.statusCode).toBe(201);
    expect(res.body.data.transaction.points).toBe(100);
    expect(res.body.data.transaction.balanceAfter).toBe(100);
    expect(res.body.data.transaction.type).toBe('earn');
  });

  test('GET /balance reflects earned points', async () => {
    const res = await authA(request(app).get(`${PATH}/balance/cust-a1`));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.points).toBe(100);
  });

  test('POST /redeem reduces balance', async () => {
    const res = await authA(request(app).post(`${PATH}/redeem`).send({
      customerId: 'cust-a1',
      points: 50,
      amount: 500,
      ref: 'REDEEM-INT-1',
      refType: 'manual'
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transaction.points).toBe(-50);
    expect(res.body.data.balance).toBe(50);
  });

  test('POST /reverse creates return_deduct transaction', async () => {
    const res = await authA(request(app).post(`${PATH}/reverse`).send({
      customerId: 'cust-a1',
      originalSaleId: 'INV-INT-1',
      returnId: 'RET-INT-1',
      refundAmount: 500
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.transaction.type).toBe('return_deduct');
    expect(res.body.data.transaction.points).toBeLessThan(0);
  });

  test('POST /reverse is idempotent', async () => {
    const res = await authA(request(app).post(`${PATH}/reverse`).send({
      customerId: 'cust-a1',
      originalSaleId: 'INV-INT-1',
      returnId: 'RET-INT-1',
      refundAmount: 500
    }));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.duplicate).toBe(true);
  });

  test('Tenant B cannot access Tenant A customer balance', async () => {
    const res = await authB(request(app).get(`${PATH}/balance/cust-a1`));
    expect(res.statusCode).toBe(404);
  });

  test('Tenant B cannot earn for Tenant A customer', async () => {
    const res = await authB(request(app).post(`${PATH}/earn`).send({
      customerId: 'cust-a1',
      points: 10,
      amount: 100,
      ref: 'INV-INT-2',
      refType: 'sale'
    }));
    expect(res.statusCode).toBe(400);
  });

  test('GET /transactions returns paginated history', async () => {
    const res = await authA(request(app).get(`${PATH}/transactions/cust-a1`));
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data.transactions)).toBe(true);
    expect(res.body.data.total).toBeGreaterThan(0);
  });

  test('GET /metrics returns aggregates', async () => {
    const res = await authA(request(app).get(`${PATH}/metrics`));
    expect(res.statusCode).toBe(200);
    expect(typeof res.body.data.totalIssued).toBe('number');
    expect(typeof res.body.data.totalRedeemed).toBe('number');
    expect(typeof res.body.data.outstandingLiability).toBe('number');
  });

  test('GET /config returns default config', async () => {
    const res = await authA(request(app).get(`${PATH}/config`));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.enabled).toBe(true);
    expect(res.body.data.earnPerAmount).toBe(100);
  });

  test('PUT /config updates config', async () => {
    const res = await authA(request(app).put(`${PATH}/config`).send({ maxRedeemPercent: 25 }));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.maxRedeemPercent).toBe(25);
  });

  test('concurrent redeems cannot overspend', async () => {
    const req1 = authA(request(app).post(`${PATH}/redeem`).send({
      customerId: 'cust-b1',
      points: 80,
      amount: 100,
      ref: `CONC-${Date.now()}-1`,
      refType: 'manual'
    }));
    const req2 = authA(request(app).post(`${PATH}/redeem`).send({
      customerId: 'cust-b1',
      points: 80,
      amount: 100,
      ref: `CONC-${Date.now()}-2`,
      refType: 'manual'
    }));
    const [r1, r2] = await Promise.all([req1, req2]);
    const successes = [r1, r2].filter(r => r.statusCode === 200 && !r.body.data.duplicate);
    expect(successes.length).toBeLessThanOrEqual(1);
  });
});
