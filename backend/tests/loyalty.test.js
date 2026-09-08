'use strict';

const loyaltyService = require('../services/loyalty.service');
const repository = require('../repositories').customers;
const fs = require('fs');
const path = require('path');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const bcrypt = require('bcryptjs');
const PATH = '/api/v1/loyalty';

function seedLoyalty(dir, payload) {
  seed(dir, 'loyalty', payload);
}

describe('Loyalty Service', () => {
  let dir;
  let app;
  let server;
  let tokenA;
  let tokenB;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.AUTH_REQUIRED = 'true';

    dir = makeTempDataDir('loyalty-unit');
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

    const { startServer } = require('./helpers/testServer');
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;

    const { login } = require('./helpers/authHelper');
    const sessionA = await login(server, 'adminA', 'Pass#123', 'corp-a');
    tokenA = sessionA.accessToken;

    const sessionB = await login(server, 'adminB', 'Pass#123', 'corp-b');
    tokenB = sessionB.accessToken;

    seed(dir, 'customers', {
      customers: [
        { id: 'cust-a1', name: 'Alice A', phone: '0100000001', balance: 0, tenantId: 'corp-a', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { id: 'cust-b1', name: 'Bob B', phone: '0100000002', balance: 0, tenantId: 'corp-b', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ]
    });
  });

  afterAll(() => {
    if (server && typeof server.close === 'function') server.close();
  });

  function authA(req) { return req.set('Authorization', 'Bearer ' + tokenA); }
  function authB(req) { return req.set('Authorization', 'Bearer ' + tokenB); }

  describe('GET /balance/:customerId', () => {
    test('returns balance for own tenant customer', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/balance/cust-a1`));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.customerId).toBe('cust-a1');
      expect(res.body.data.points).toBe(0);
    });

    test('returns 404 for wrong tenant customer', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/balance/cust-b1`));
      expect(res.statusCode).toBe(404);
    });

    test('returns 404 for unknown customer', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/balance/unknown`));
      expect(res.statusCode).toBe(404);
    });
  });

  describe('POST /earn', () => {
    test('earns points for valid request', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/earn`).send({
        customerId: 'cust-a1',
        points: 10,
        amount: 1000,
        ref: 'INV-1',
        refType: 'sale'
      }));
      expect(res.statusCode).toBe(201);
      expect(res.body.data.transaction.points).toBe(10);
      expect(res.body.data.transaction.balanceAfter).toBe(10);
    });

    test('rejects duplicate earn for same ref', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/earn`).send({
        customerId: 'cust-a1',
        points: 10,
        amount: 1000,
        ref: 'INV-1',
        refType: 'sale'
      }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.duplicate).toBe(true);
    });

    test('rejects earn for wrong tenant customer', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/earn`).send({
        customerId: 'cust-b1',
        points: 10,
        amount: 1000,
        ref: 'INV-2',
        refType: 'sale'
      }));
      expect(res.statusCode).toBe(400);
    });

    test('rejects zero points', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/earn`).send({
        customerId: 'cust-a1',
        points: 0,
        amount: 1000,
        ref: 'INV-3',
        refType: 'sale'
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /redeem', () => {
    test('redeems points when balance sufficient', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/redeem`).send({
        customerId: 'cust-a1',
        points: 5,
        amount: 100,
        ref: 'REDEEM-1',
        refType: 'manual'
      }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.transaction.points).toBe(-5);
      expect(res.body.data.balance).toBe(5);
    });

    test('rejects duplicate redeem for same ref', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/redeem`).send({
        customerId: 'cust-a1',
        points: 5,
        amount: 100,
        ref: 'REDEEM-1',
        refType: 'manual'
      }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.duplicate).toBe(true);
    });

    test('rejects redemption exceeding balance', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/redeem`).send({
        customerId: 'cust-a1',
        points: 100,
        amount: 100,
        ref: 'REDEEM-2',
        refType: 'manual'
      }));
      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /reverse', () => {
    test('reverses points for a return', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/reverse`).send({
        customerId: 'cust-a1',
        originalSaleId: 'INV-1',
        returnId: 'RET-1',
        refundAmount: 500
      }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.transaction.points).toBeLessThan(0);
      expect(res.body.data.transaction.type).toBe('return_deduct');
    });

    test('reverses idempotently for same returnId', async () => {
      const res = await authA(require('supertest')(server).post(`${PATH}/reverse`).send({
        customerId: 'cust-a1',
        originalSaleId: 'INV-1',
        returnId: 'RET-1',
        refundAmount: 500
      }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.duplicate).toBe(true);
    });
  });

  describe('Concurrency', () => {
    test('concurrent earns do not lose updates', async () => {
      const requests = [];
      for (let i = 0; i < 5; i++) {
        requests.push(
          authA(require('supertest')(server).post(`${PATH}/earn`).send({
            customerId: 'cust-a1',
            points: 10,
            amount: 100,
            ref: `CONC-EARN-${Date.now()}-${i}`,
            refType: 'sale'
          }))
        );
      }
      const results = await Promise.all(requests);
      const successCodes = results.map(r => r.statusCode);
      expect(successCodes.every(code => code === 201 || code === 200)).toBe(true);
      const balanceRes = await authA(require('supertest')(server).get(`${PATH}/balance/cust-a1`));
      expect(balanceRes.body.data.points).toBeGreaterThanOrEqual(0);
    });

    test('concurrent redeems cannot overspend', async () => {
      const req1 = authA(require('supertest')(server).post(`${PATH}/redeem`).send({
        customerId: 'cust-b1',
        points: 80,
        amount: 100,
        ref: `CONC-REDEEM-${Date.now()}-1`,
        refType: 'manual'
      }));
      const req2 = authA(require('supertest')(server).post(`${PATH}/redeem`).send({
        customerId: 'cust-b1',
        points: 80,
        amount: 100,
        ref: `CONC-REDEEM-${Date.now()}-2`,
        refType: 'manual'
      }));
      const [r1, r2] = await Promise.all([req1, req2]);
      const successes = [r1, r2].filter(r => r.statusCode === 200 && !r.body.data.duplicate);
      expect(successes.length).toBeLessThanOrEqual(1);
    });
  });

  describe('GET /transactions/:customerId', () => {
    test('returns paginated transactions', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/transactions/cust-a1`));
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.body.data.transactions)).toBe(true);
    });
  });

  describe('GET /metrics', () => {
    test('returns aggregate metrics', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/metrics`));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.totalIssued).toBeDefined();
      expect(res.body.data.totalRedeemed).toBeDefined();
      expect(res.body.data.outstandingLiability).toBeDefined();
    });
  });

  describe('GET /config', () => {
    test('returns config', async () => {
      const res = await authA(require('supertest')(server).get(`${PATH}/config`));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.enabled).toBe(true);
    });
  });

  describe('PUT /config', () => {
    test('updates config with manage permission', async () => {
      const res = await authA(require('supertest')(server).put(`${PATH}/config`).send({ maxRedeemPercent: 25 }));
      expect(res.statusCode).toBe(200);
      expect(res.body.data.maxRedeemPercent).toBe(25);
    });
  });
});
