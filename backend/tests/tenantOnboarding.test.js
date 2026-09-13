'use strict';

const request = require('supertest');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');
const { login } = require('./helpers/authHelper');

const PASSWORD = 'Pass#123';
const tempDirs = [];

function seedOnboarding(dir) {
  seed(dir, 'companies', {
    companies: [
      { id: 'digi', code: 'DIGI', name: 'DigiTronics', active: true, status: 'ACTIVE', branches: [] }
    ]
  });
  seed(dir, 'users', {
    users: [
      { id: 'u-owner', username: 'owner', password: require('bcryptjs').hashSync(PASSWORD, 10), fullName: 'Store Owner', role: 'Owner', tenantIds: ['digi'], tenantRoles: { digi: 'Owner' }, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), tokenVersion: 0 }
    ]
  });
}

describe('POST /api/v1/tenant/onboarding', () => {
  let server;
  let dir;
  let ownerToken;

  beforeAll(async () => {
    jest.resetModules();
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_ENTITY_ISOLATION = 'true';
    dir = makeTempDataDir('tenantOnboarding');
    tempDirs.push(dir);
    seedOnboarding(dir);
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    server = s.app;
    ownerToken = (await login(server, 'owner', PASSWORD, 'digi')).accessToken;
  });

  afterAll(() => {
    tempDirs.forEach(d => {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {}
    });
  });

  function auth() {
    return {
      get: (path) => request(server).get(path).set('Authorization', 'Bearer ' + ownerToken),
      post: (path, body) => request(server).post(path).set('Authorization', 'Bearer ' + ownerToken).send(body || {})
    };
  }

  test('1: anonymous cannot access onboarding endpoints', async () => {
    const res = await request(server).get('/api/v1/tenant/onboarding/status');
    expect(res.status).toBe(401);
  });

  test('2: complete onboarding returns success', async () => {
    const res = await auth()
      .post('/api/v1/tenant/onboarding/complete')
      .send({ storeName: 'Demo Store', currency: 'EGP', timezone: 'Africa/Cairo', businessType: 'Retail' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.storeName).toBe('Demo Store');
    expect(res.body.data.businessType).toBe('Retail');
  });

  test('3: status returns completed after onboarding', async () => {
    const res = await auth().get('/api/v1/tenant/onboarding/status');
    expect(res.status).toBe(200);
    expect(res.body.data.completed).toBe(true);
    expect(res.body.data.storeName).toBe('Demo Store');
  });

  test('4: seed-demo returns created counts', async () => {
    const res = await auth()
      .post('/api/v1/tenant/onboarding/seed-demo')
      .send({ businessType: 'Retail' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.products.length).toBeGreaterThanOrEqual(3);
    expect(res.body.data.customers.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.sales.length).toBeGreaterThanOrEqual(2);
    expect(res.body.data.purchases.length).toBeGreaterThanOrEqual(1);
  });
});
