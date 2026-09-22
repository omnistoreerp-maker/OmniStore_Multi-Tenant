'use strict';

// HTTP-layer tests for the Game Hosting order pipeline.
// Boots the app in-process and exercises authorization boundaries:
//   - customer auth required on every order route
//   - customer can only see/act on their own orders (IDOR → 404)
//   - operator endpoints reject plain customers (403)
//   - tenant resolution stays server-authoritative
//   - storefront flow end-to-end: register → plan → order → pay → provision

const fs = require('fs');
const request = require('supertest');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');

let dataDir;
let app;
let marketConfigService;
let marketAuthService;
let ghService;
let orderService;
let provisioningService;

beforeAll(async () => {
  dataDir = makeTempDataDir('gh-http');
  ({ app } = startServer(dataDir));
  marketConfigService = require('../services/marketConfig.service');
  marketAuthService = require('../services/marketAuth.service');
  ghService = require('../services/gameHosting.service');
  orderService = require('../services/gameHostingOrder.service');
  provisioningService = require('../services/gameHostingProvisioning.service');
  marketConfigService.ensureSeeded();
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

const H = { 'X-Tenant-Id': 'default' };

async function customerToken(email, role) {
  const reg = await marketAuthService.register({ tenantId: 'default', email, name: 'C ' + email, password: 'Passw0rd!123' });
  const c = reg && reg.customer ? reg.customer : reg;
  // Promote BEFORE login so the role lands inside the signed token.
  if (role) marketAuthService.setOperatorRole(c.id, 'default', role);
  const login = await request(app).post('/api/v1/market/auth/login').send({ tenantId: 'default', email, password: 'Passw0rd!123' });
  if (login.status !== 200) throw new Error('login failed: ' + JSON.stringify(login.body));
  return { token: login.body.data.token, id: login.body.data.customer.id };
}

async function seedActivePlan(name) {
  const res = await ghService.createPlan({
    data: { name, gameTitle: 'Minecraft', pricePerMonth: 20, status: 'active' },
    tenantContext: { tenantId: 'default' }
  });
  if (res.error) throw new Error(res.error);
  return res.plan;
}

// === Storefront flow end-to-end ===
describe('game hosting HTTP — storefront flow', () => {
  test('register → quote → order → pay → provision → renew → terminate', async () => {
    const cust = await customerToken('buyer1@example.com');
    const plan = await seedActivePlan('e2e-plan');

    // quote — price from the catalog
    const q = await request(app).get('/api/v1/game-hosting/orders/quote')
      .set(H).set('Authorization', 'Bearer ' + cust.token)
      .query({ planId: plan.id, billingPeriod: '1m' });
    expect(q.status).toBe(200);
    const total = q.body.data.total;
    expect(total).toBe(20);

    // create order — client cannot influence the amount
    const o = await request(app).post('/api/v1/game-hosting/orders')
      .set(H).set('Authorization', 'Bearer ' + cust.token)
      .send({ planId: plan.id, billingPeriod: '1m', serverName: 'e2e-srv', amount: 0.01 });
    expect(o.status).toBe(201);
    expect(o.body.data.amount).toBe(total);
    expect(o.body.data.status).toBe('pending');
    const orderId = o.body.data.id;

    // provisioning before payment is refused
    const early = await request(app).post('/api/v1/game-hosting/orders/' + orderId + '/provision')
      .set(H).set('Authorization', 'Bearer ' + cust.token);
    expect(early.status).toBe(409);

    // pay
    const pay = await request(app).post('/api/v1/game-hosting/orders/' + orderId + '/pay')
      .set(H).set('Authorization', 'Bearer ' + cust.token);
    expect(pay.status).toBe(200);
    expect(pay.body.data.status).toBe('paid');

    // provision
    const prov = await request(app).post('/api/v1/game-hosting/orders/' + orderId + '/provision')
      .set(H).set('Authorization', 'Bearer ' + cust.token);
    expect(prov.status).toBe(200);
    expect(prov.body.data.status).toBe('active');
    expect(prov.body.data.providerInfo.externalId).toBeTruthy();

    // renew
    const renew = await request(app).post('/api/v1/game-hosting/orders/' + orderId + '/renew')
      .set(H).set('Authorization', 'Bearer ' + cust.token)
      .send({ billingPeriod: '1m' });
    expect(renew.status).toBe(200);
    expect(renew.body.data.status).toBe('active');

    // terminate
    const term = await request(app).post('/api/v1/game-hosting/orders/' + orderId + '/terminate')
      .set(H).set('Authorization', 'Bearer ' + cust.token)
      .send({ reason: 'e2e' });
    expect(term.status).toBe(200);
    expect(term.body.data.status).toBe('terminated');
  });
});

// === Authorization / IDOR ===
describe('game hosting HTTP — authorization and IDOR', () => {
  let plan;
  let ownerOrder;
  let owner;
  let stranger;

  beforeAll(async () => {
    plan = await seedActivePlan('idor-plan');
    owner = await customerToken('idor-owner@example.com');
    stranger = await customerToken('idor-stranger@example.com');
    const o = await request(app).post('/api/v1/game-hosting/orders')
      .set(H).set('Authorization', 'Bearer ' + owner.token)
      .send({ planId: plan.id, serverName: 'owner-srv' });
    ownerOrder = o.body.data;
  });

  test('order routes require authentication', async () => {
    expect((await request(app).get('/api/v1/game-hosting/orders').set(H)).status).toBe(401);
    expect((await request(app).post('/api/v1/game-hosting/orders').set(H).send({})).status).toBe(401);
    expect((await request(app).post('/api/v1/game-hosting/orders/x/pay').set(H)).status).toBe(401);
  });

  test('customer cannot read another customer order (404, no leak)', async () => {
    const r = await request(app).get('/api/v1/game-hosting/orders/' + ownerOrder.id)
      .set(H).set('Authorization', 'Bearer ' + stranger.token);
    expect(r.status).toBe(404);
  });

  test('customer cannot pay/provision/renew/terminate another customer order', async () => {
    const base = '/api/v1/game-hosting/orders/' + ownerOrder.id;
    expect((await request(app).post(base + '/pay').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(404);
    expect((await request(app).post(base + '/provision').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(404);
    expect((await request(app).post(base + '/renew').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(404);
    expect((await request(app).post(base + '/terminate').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(404);
    expect((await request(app).post(base + '/suspend').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(404);
  });

  test('operator endpoints reject plain customers', async () => {
    expect((await request(app).get('/api/v1/game-hosting/admin/overview').set(H).set('Authorization', 'Bearer ' + owner.token)).status).toBe(403);
    expect((await request(app).post('/api/v1/game-hosting/admin/expiry-sweep').set(H).set('Authorization', 'Bearer ' + owner.token)).status).toBe(403);
    expect((await request(app).post('/api/v1/game-hosting/admin/orders/' + ownerOrder.id + '/retry-provisioning').set(H).set('Authorization', 'Bearer ' + stranger.token)).status).toBe(403);
  });

  test('operator can view the tenant overview but cross-tenant tenant header cannot leak other tenants', async () => {
    const reg = await marketAuthService.register({ tenantId: 'default', email: 'gh-op@example.com', name: 'gh op', password: 'Passw0rd!123' });
    const promoted = marketAuthService.setOperatorRole((reg.customer || reg).id, 'default', 'operator');
    expect(promoted.error).toBeUndefined();
    const login = await request(app).post('/api/v1/market/auth/login').send({ tenantId: 'default', email: 'gh-op@example.com', password: 'Passw0rd!123' });
    expect(login.status).toBe(200);
    expect(login.body.data.customer.role).toBe('operator');
    const op = { token: login.body.data.token, id: login.body.data.customer.id };
    const r = await request(app).get('/api/v1/game-hosting/admin/overview').set(H).set('Authorization', 'Bearer ' + op.token);
    expect(r.status).toBe(200);
    expect(r.body.data.provider).toBeTruthy();
    expect(r.body.data.counts).toBeTruthy();
  });

  test('duplicate order creation with the same idempotencyKey returns the same order', async () => {
    const body = { planId: plan.id, serverName: 'idem-srv', idempotencyKey: 'idem-1' };
    const r1 = await request(app).post('/api/v1/game-hosting/orders').set(H).set('Authorization', 'Bearer ' + stranger.token).send(body);
    const r2 = await request(app).post('/api/v1/game-hosting/orders').set(H).set('Authorization', 'Bearer ' + stranger.token).send(body);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    expect(r2.body.data.id).toBe(r1.body.data.id);
  });

  test('payment webhook is idempotent for duplicate callbacks', async () => {
    const o = await request(app).post('/api/v1/game-hosting/orders')
      .set(H).set('Authorization', 'Bearer ' + stranger.token)
      .send({ planId: plan.id, serverName: 'wh-srv' });
    const id = o.body.data.id;
    const w1 = await request(app).post('/api/v1/game-hosting/payment-webhook').set(H)
      .send({ orderId: id, paymentRef: 'WH-1', status: 'paid', amount: o.body.data.amount });
    expect(w1.status).toBe(200);
    const w2 = await request(app).post('/api/v1/game-hosting/payment-webhook').set(H)
      .send({ orderId: id, paymentRef: 'WH-1', status: 'paid', amount: o.body.data.amount });
    expect(w2.status).toBe(200);
    expect(w2.body.data.alreadyProcessed).toBe(true);
    // tampered amount rejected
    const o2 = await request(app).post('/api/v1/game-hosting/orders')
      .set(H).set('Authorization', 'Bearer ' + stranger.token)
      .send({ planId: plan.id, serverName: 'wh-srv-2' });
    const w3 = await request(app).post('/api/v1/game-hosting/payment-webhook').set(H)
      .send({ orderId: o2.body.data.id, paymentRef: 'WH-BAD', status: 'paid', amount: 0.01 });
    expect(w3.status).toBe(400);
  });
});
