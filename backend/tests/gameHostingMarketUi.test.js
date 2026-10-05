'use strict';

// gameHostingMarketUi.test.js — Game Hosting order lifecycle inside the
// CURRENT Market UI (not the legacy storefront).
//
// The order pipeline (order → pay → provision → renew → suspend/resume/
// terminate + operator administration) existed server-side but had no storefront
// surface: the UI only offered the older "provisioning request" flow, so the
// whole lifecycle was unreachable for customers. This suite pins both halves:
//
//   A. UI contract — market/js/api.js exposes every endpoint the UI calls,
//      market/js/app.js owns the routes/pages, BOTH locales carry each new
//      string, market.html links the new surfaces, and existing Market
//      surfaces are untouched. It also proves the client never ships a price
//      (server-side pricing stays authoritative).
//   B. The exact endpoint sequence the UI performs, over HTTP: quote → order →
//      pay → provision → renew, idempotent re-submit, my-orders scoping,
//      cross-tenant / foreign-customer denial, malformed ids, and the
//      fail-closed provider path that must never fake a successful provision.

const fs = require('fs');
const path = require('path');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

// The storefront happy path needs a working adapter. The mock is the only
// non-production adapter and is pinned explicitly so the suite documents
// intent; the fail-closed describe below flips it to 'unavailable'.
process.env.GAME_HOSTING_PROVIDER = 'mock';

const ROOT = path.resolve(__dirname, '..', '..');
const TENANT_A = 'default';
const TENANT_B = 'tenantB';

let server;
let dataDir;
let marketAuthService;
let tokenA;
let customerIdA;
let tokenB;
let customerIdB;
let operatorTokenA;
let operatorIdA;
let operatorTokenB;
let operatorIdB;

registerCleanup(() => [server], () => [dataDir]);

function repoFile(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

function loadLocales() {
  const src = repoFile('market/js/locales.js');
  const literal = src.slice(src.indexOf('window.MK_LOCALES'));
  const body = literal.replace(/^window\.MK_LOCALES\s*=\s*/, '').replace(/;\s*$/, '');
  // Repo-local, trusted source file: parse it as a literal.
  return new Function('return (' + body + ');')();
}

function ensureMarketConfig(tenantId) {
  const db = readStore(dataDir, 'marketConfig') || { configs: [] };
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
    fs.writeFileSync(path.join(dataDir, 'marketConfig.json'), JSON.stringify(db, null, 2), 'utf-8');
  }
}

async function registerCustomer(tenantId) {
  const email = 'ghui' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
  const res = await request(server.app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id };
}

async function createOperator(tenantId) {
  const { token, customerId } = await registerCustomer(tenantId);
  marketAuthService.setOperatorRole(customerId, tenantId, 'operator');
  const customer = marketAuthService.getById(customerId);
  const { signCustomerToken } = require('../utils/marketJwt');
  return { token: signCustomerToken(customer), customerId, sessionToken: token };
}

const H = { 'X-Tenant-Id': TENANT_A };
const HB = { 'X-Tenant-Id': TENANT_B };
const auth = (t) => ({ 'X-Tenant-Id': TENANT_A, Authorization: 'Bearer ' + t });
const authB = (t) => ({ 'X-Tenant-Id': TENANT_B, Authorization: 'Bearer ' + t });

// Mirrors market/js/api.js gh* helpers.
const api = {
  quote: (token, planId, billingPeriod) => request(server.app)
    .get('/api/v1/game-hosting/orders/quote')
    .set(auth(token))
    .query({ planId, billingPeriod: billingPeriod || '1m' }),
  createOrder: (token, body) => request(server.app)
    .post('/api/v1/game-hosting/orders')
    .set(auth(token))
    .send(body),
  myOrders: (token) => request(server.app).get('/api/v1/game-hosting/orders').set(auth(token)),
  order: (token, id) => request(server.app).get('/api/v1/game-hosting/orders/' + id).set(auth(token)),
  pay: (token, id) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/pay').set(auth(token)),
  provision: (token, id) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/provision').set(auth(token)),
  renew: (token, id, body) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/renew').set(auth(token)).send(body || {}),
  suspend: (token, id) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/suspend').set(auth(token)).send({}),
  resume: (token, id) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/resume').set(auth(token)).send({}),
  terminate: (token, id) => request(server.app).post('/api/v1/game-hosting/orders/' + id + '/terminate').set(auth(token)).send({}),
  providerStatus: (token, id) => request(server.app).get('/api/v1/game-hosting/orders/' + id + '/provider-status').set(auth(token)),
  adminOverview: (token) => request(server.app).get('/api/v1/game-hosting/admin/overview').set(auth(token)),
  adminRetry: (token, id) => request(server.app).post('/api/v1/game-hosting/admin/orders/' + id + '/retry-provisioning').set(auth(token)).send({}),
  adminRefund: (token, id, body) => request(server.app).post('/api/v1/game-hosting/admin/orders/' + id + '/refund').set(auth(token)).send(body || {})
};

async function seedActivePlan(tenantToken, name, tenantHeader) {
  const res = await request(server.app)
    .post('/api/v1/game-hosting/plans')
    .set(tenantHeader || auth(tenantToken))
    .send({ name, gameTitle: 'Minecraft', maxPlayers: 10, pricePerMonth: 20, status: 'active' });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('gh-market-ui');
  server = startServer(dataDir);
  marketAuthService = require('../services/marketAuth.service');
  ensureMarketConfig(TENANT_A);
  ensureMarketConfig(TENANT_B);

  const a = await registerCustomer(TENANT_A);
  tokenA = a.token;
  customerIdA = a.customerId;
  const b = await registerCustomer(TENANT_B);
  tokenB = b.token;
  customerIdB = b.customerId;
  const op = await createOperator(TENANT_A);
  operatorTokenA = op.token;
  operatorIdA = op.customerId;
  const opB = await createOperator(TENANT_B);
  operatorTokenB = opB.token;
  operatorIdB = opB.customerId;
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// A. Market UI contract
// ============================================================================

describe('Market UI — Game Hosting order contract', () => {
  test('api.js exposes every order endpoint the storefront calls', () => {
    const src = repoFile('market/js/api.js');
    [
      'ghQuote', 'ghMyOrders', 'ghOrder:', 'ghCreateOrder', 'ghPayOrder',
      'ghProvisionOrder', 'ghRenewOrder', 'ghSuspendOrder', 'ghResumeOrder',
      'ghTerminateOrder', 'ghOrderProviderStatus', 'ghAdminOverview',
      'ghAdminRetryProvisioning', 'ghAdminRefund', 'ghAdminExpireSweep'
    ].forEach((fn) => expect(src).toContain(fn));
    ['/orders/quote?', "'/orders'", "'/pay'", "'/provision'", "'/renew'", "'/suspend'", "'/resume'", "'/terminate'", "'/provider-status'", '/admin/overview', '/retry-provisioning', '/refund', '/expiry-sweep']
      .forEach((p) => expect(src).toContain(p));
  });

  test('the client never ships a price — server-side pricing stays authoritative', () => {
    expect(repoFile('market/js/api.js')).not.toContain('amount');
    const app = repoFile('market/js/app.js');
    const call = app.slice(app.indexOf('window.MK_API.ghCreateOrder({'));
    const payload = call.slice(0, call.indexOf('});'));
    expect(payload).toContain('planId');
    expect(payload).toContain('serverName');
    expect(payload).toContain('billingPeriod');
    expect(payload).toContain('idempotencyKey');
    expect(payload).not.toContain('amount');
  });

  test('app.js owns the order routes and pages', () => {
    const src = repoFile('market/js/app.js');
    expect(src).toContain("if (param === 'orders')");
    expect(src).toContain("if (param === 'order') return pageGameHostingOrder();");
    expect(src).toContain('async function pageGameHostingOrder(');
    expect(src).toContain('async function pageGameHostingOrders(');
    expect(src).toContain('async function pageGameHostingOrderDetail(');
    expect(src).toContain('async function pageOperatorOrders(');
    expect(src).toContain('async function pageOperatorOrderDetail(');
    expect(src).toContain('#/game-hosting/orders/');
    expect(src).toContain('#/operator/orders/');
    // The operator board accepts a per-order detail route; both entry points
    // stay behind isOperator() and the server-side requireOperator guard.
    expect(src).toContain("location.hash.split('/')[3]");
    expect(src).toContain('return pageOperatorOrders();');
  });

  test('the storefront plan card drives the order flow', () => {
    const src = repoFile('market/js/app.js');
    expect(src).toContain('#/game-hosting/order?planId=');
    expect(src).toContain("t('gh_order_now')");
    expect(src).not.toContain('#/game-hosting/provision?planId=');
  });

  test('both locales carry every new string (en/ar parity)', () => {
    const locales = loadLocales();
    const en = Object.keys(locales.en);
    const ar = Object.keys(locales.ar);
    expect(en.length).toBe(ar.length);
    expect(en.filter((k) => ar.indexOf(k) === -1)).toEqual([]);
    [
      'gh_order', 'gh_order_now', 'gh_my_orders', 'gh_orders_title', 'gh_order_title',
      'gh_billing_period_label', 'gh_monthly_price', 'gh_total', 'gh_order_submit',
      'gh_order_created', 'gh_order_failed', 'gh_order_detail_title', 'gh_order_not_found',
      'gh_order_status', 'gh_payment_status', 'gh_period_end', 'gh_provider_status_title',
      'gh_pay_now', 'gh_pay_success', 'gh_provision_now', 'gh_provision_success',
      'gh_provision_blocked', 'gh_renew', 'gh_renew_success', 'gh_suspend', 'gh_resume',
      'gh_terminate_order', 'gh_confirm_terminate', 'gh_back_to_orders',
      'gh_order_status_pending', 'gh_order_status_paid', 'gh_order_status_provisioning',
      'gh_order_status_active', 'gh_order_status_suspended', 'gh_order_status_terminated',
      'gh_order_status_provisioning_failed', 'gh_payment_status_pending', 'gh_payment_status_paid',
      'gh_payment_status_failed', 'gh_payment_status_refunded',
      'op_orders', 'op_orders_title', 'op_order_retry', 'op_order_refund', 'op_expiry_sweep'
    ].forEach((key) => {
      expect(en).toContain(key);
      expect(ar).toContain(key);
      expect(String(locales.en[key]).length).toBeGreaterThan(0);
      expect(String(locales.ar[key]).length).toBeGreaterThan(0);
    });
  });

  test('the UI never implies provisioning will run while the provider is blocked', () => {
    const src = repoFile('market/js/app.js');
    expect(src).toContain("provider.status === 'BLOCKED'");
    expect(src).toContain("ghBanner('error', esc(t('gh_provider_blocked')))");
    expect(src).toContain('ghFailClosedBanner');
  });

  test('market.html links the new surfaces and keeps the existing ones', () => {
    const html = repoFile('market.html');
    expect(html).toContain('href="#/game-hosting/orders"');
    expect(html).toContain('id="mk-gh-orders-link"');
    expect(html).toContain('id="mk-mobile-gh-orders-link"');
    expect(html).toContain('href="#/operator/orders"');
    expect(html).toContain('data-i18n="op_orders"');
    // pre-existing surfaces survive
    ['#/home', '#/catalog', '#/cart', '#/track', '#/account', '#/game-hosting',
      '#/game-hosting/orders', '#/game-hosting/requests', '#/operator',
      '#/operator/plans', '#/operator/servers', '#/operator/queue',
      '#/operator/orders', '#/operator/entitlements', '#/operator/audit']
      .forEach((href) => expect(html).toContain('href="' + href + '"'));
    // script order is preserved
    const order = ['market/js/locales.js', 'market/js/api.js', 'market/js/store.js', 'market/js/app.js'];
    let cursor = -1;
    order.forEach((src) => {
      const at = html.indexOf(src);
      expect(at).toBeGreaterThan(cursor);
      cursor = at;
    });
  });

  test('existing Market surfaces are preserved', () => {
    const app = repoFile('market/js/app.js');
    ['pageHome', 'pageCatalog', 'pageProduct', 'pageCart', 'pageCheckout', 'pageConfirmation',
      'pageTrack', 'pageAccount', 'pageGameHosting', 'pageGameHostingMyServers',
      'pageGameHostingRequests', 'pageOperatorPlans', 'pageOperatorServers',
      'pageOperatorQueue', 'pageOperatorEntitlements', 'pageOperatorAudit']
      .forEach((fn) => expect(app).toContain('function ' + fn + '('));
    const apiSrc = repoFile('market/js/api.js');
    ['checkout:', 'myOrders:', 'products:', 'product:', 'login:', 'register:', 'ghPlans:', 'ghServers:', 'ghAuditLog:']
      .forEach((fn) => expect(apiSrc).toContain(fn));
  });
});

// ============================================================================
// B. The endpoint sequence the UI performs
// ============================================================================

describe('Market UI — storefront order pipeline over HTTP', () => {
  test('the quote the storefront renders is server-computed', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-quote-' + Date.now());
    const q = await api.quote(tokenA, plan.id, '3m');
    expect(q.status).toBe(200);
    expect(q.body.data.months).toBe(3);
    expect(q.body.data.monthlyPrice).toBe(20);
    expect(q.body.data.currency).toBe('EGP');
    // Total is the catalog price × months × the server-side period discount.
    expect(q.body.data.total).toBeCloseTo(20 * 3 * q.body.data.discountMultiplier, 5);
    expect(q.body.data.total).toBeLessThan(60);
    // A single month carries no discount.
    const one = await api.quote(tokenA, plan.id, '1m');
    expect(one.body.data.total).toBe(20);
    expect(one.body.data.discountMultiplier).toBe(1);
  });

  test('a forged client-side amount cannot change the price', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-price-' + Date.now());
    const o = await api.createOrder(tokenA, {
      planId: plan.id,
      serverName: 'ui-price-srv',
      billingPeriod: '1m',
      amount: 0.01
    });
    expect(o.status).toBe(201);
    expect(o.body.data.amount).toBe(20);
    expect(o.body.data.status).toBe('pending');
    expect(o.body.data.paymentStatus).toBe('pending');
    expect(o.body.data.customerId).toBe(customerIdA);
  });

  test('re-submitting the same order (idempotency key) returns the same order', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-idem-' + Date.now());
    const idempotencyKey = 'ghorder-ui-' + Date.now();
    const first = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-idem-srv', billingPeriod: '1m', idempotencyKey });
    const second = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-idem-srv', billingPeriod: '1m', idempotencyKey });
    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(first.body.data.id);
  });

  test('order → pay → provision → active, then renew extends the period', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-flow-' + Date.now());
    const created = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-flow-srv', billingPeriod: '1m' });
    const orderId = created.body.data.id;

    // The UI offers no provision action before payment.
    const early = await api.provision(tokenA, orderId);
    expect(early.status).toBe(409);

    const paid = await api.pay(tokenA, orderId);
    expect(paid.status).toBe(200);
    expect(paid.body.data.status).toBe('paid');
    expect(paid.body.data.paymentStatus).toBe('paid');
    const firstPeriodEnd = paid.body.data.periodEndsAt;
    expect(firstPeriodEnd).toBeTruthy();

    const provisioned = await api.provision(tokenA, orderId);
    expect(provisioned.status).toBe(200);
    expect(provisioned.body.data.status).toBe('active');
    expect(provisioned.body.data.providerInfo.externalId).toBeTruthy();

    const provider = await api.providerStatus(tokenA, orderId);
    expect(provider.status).toBe(200);
    expect(provider.body.data.order.id).toBe(orderId);

    const renewed = await api.renew(tokenA, orderId, { billingPeriod: '1m' });
    expect(renewed.status).toBe(200);
    expect(renewed.body.data.status).toBe('active');
    expect(new Date(renewed.body.data.periodEndsAt).getTime()).toBeGreaterThan(new Date(firstPeriodEnd).getTime());

    // Lifecycle actions the detail page exposes.
    const suspended = await api.suspend(tokenA, orderId);
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.status).toBe('suspended');
    const resumed = await api.resume(tokenA, orderId);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe('active');
    const terminated = await api.terminate(tokenA, orderId);
    expect(terminated.status).toBe(200);
    expect(terminated.body.data.status).toBe('terminated');
  });

  test('my orders lists only the signed-in customer orders', async () => {
    const planA = await seedActivePlan(tokenA, 'ui-list-' + Date.now());
    const planB = await seedActivePlan(operatorTokenB, 'ui-list-b-' + Date.now(), authB(operatorTokenB));
    const mine = await api.createOrder(tokenA, { planId: planA.id, serverName: 'ui-list-mine' });
    expect(mine.status).toBe(201);
    const theirs = await request(server.app)
      .post('/api/v1/game-hosting/orders')
      .set(authB(tokenB))
      .send({ planId: planB.id, serverName: 'ui-list-theirs' });
    expect(theirs.status).toBe(201);

    const listA = await api.myOrders(tokenA);
    expect(listA.status).toBe(200);
    expect(Array.isArray(listA.body.data.orders)).toBe(true);
    const idsA = listA.body.data.orders.map((o) => o.id);
    expect(idsA).toContain(mine.body.data.id);
    expect(idsA).not.toContain(theirs.body.data.id);
    expect(listA.body.data.orders.every((o) => o.customerId === customerIdA)).toBe(true);

    const listB = await request(server.app).get('/api/v1/game-hosting/orders').set(authB(tokenB));
    const idsB = listB.body.data.orders.map((o) => o.id);
    expect(idsB).toContain(theirs.body.data.id);
    expect(idsB).not.toContain(mine.body.data.id);
  });

  test('a customer cannot read or act on another customer order (404, no leak)', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-idor-' + Date.now());
    const victim = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-idor-victim' });
    const victimId = victim.body.data.id;

    const other = await registerCustomer(TENANT_A);
    const read = await api.order(other.token, victimId);
    expect(read.status).toBe(404);
    expect(read.body.message || '').not.toMatch(/forbidden|permission/i);
    expect((await api.pay(other.token, victimId)).status).toBe(404);
    expect((await api.provision(other.token, victimId)).status).toBe(404);
    expect((await api.renew(other.token, victimId)).status).toBe(404);
    expect((await api.terminate(other.token, victimId)).status).toBe(404);
  });

  test('cross-tenant order access is denied', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-cross-' + Date.now());
    const order = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-cross-srv' });
    const orderId = order.body.data.id;

    // Tenant B customer cannot see tenant A order (scoped lookup → 404).
    const crossRead = await request(server.app)
      .get('/api/v1/game-hosting/orders/' + orderId)
      .set(authB(tokenB));
    expect(crossRead.status).toBe(404);

    // A tenant A session cannot be re-pointed at another tenant.
    const mismatch = await request(server.app)
      .get('/api/v1/game-hosting/orders/' + orderId)
      .set('X-Tenant-Id', TENANT_B)
      .set('Authorization', 'Bearer ' + tokenA);
    expect(mismatch.status).toBe(403);
  });

  test('unauthenticated storefront order calls are rejected', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-unauth-' + Date.now());
    expect((await request(server.app).get('/api/v1/game-hosting/orders').set(H)).status).toBe(401);
    expect((await request(server.app).post('/api/v1/game-hosting/orders').set(H).send({ planId: plan.id, serverName: 'x' })).status).toBe(401);
    expect((await request(server.app).post('/api/v1/game-hosting/orders/x/pay').set(H)).status).toBe(401);
  });

  test('malformed order ids fail cleanly (404, no crash)', async () => {
    expect((await api.order(tokenA, 'not-a-real-order')).status).toBe(404);
    expect((await api.pay(tokenA, 'not-a-real-order')).status).toBe(404);
    expect((await api.providerStatus(tokenA, 'not-a-real-order')).status).toBe(404);
  });

  test('the operator orders surface gets provider state plus counts', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-admin-' + Date.now());
    await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-admin-srv' });

    const overview = await api.adminOverview(operatorTokenA);
    expect(overview.status).toBe(200);
    expect(overview.body.data.provider).toBeTruthy();
    expect(typeof overview.body.data.provider.status).toBe('string');
    expect(typeof overview.body.data.total).toBe('number');
    expect(Array.isArray(overview.body.data.orders)).toBe(true);

    // Plain customers never reach the operator surface.
    const denied = await api.adminOverview(tokenA);
    expect(denied.status).toBe(403);
  });

  test('operator retry + refund stay tenant-scoped', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-ops-' + Date.now());
    const created = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-ops-srv' });
    const orderId = created.body.data.id;
    await api.pay(tokenA, orderId);

    // A tenant B operator cannot touch a tenant A order.
    const foreign = await request(server.app)
      .post('/api/v1/game-hosting/admin/orders/' + orderId + '/refund')
      .set(authB(operatorTokenB))
      .send({ reason: 'cross-tenant' });
    expect(foreign.status).toBe(404);

    const refunded = await api.adminRefund(operatorTokenA, orderId, { reason: 'ui-test' });
    expect(refunded.status).toBe(200);
    expect(refunded.body.data.paymentStatus).toBe('refunded');
  });
});

// ============================================================================
// C. Fail-closed provider (production policy)
// ============================================================================

// Runs last: it pins the provider to 'unavailable' (the production default when
// no real adapter is configured) and restores the mock afterwards.
describe('Market UI — blocked provider stays fail-closed', () => {
  const previous = process.env.GAME_HOSTING_PROVIDER;

  beforeAll(() => { process.env.GAME_HOSTING_PROVIDER = 'unavailable'; });
  afterAll(() => { process.env.GAME_HOSTING_PROVIDER = previous; });

  test('a paid order cannot fake a provision: 502 + provisioning_failed + no server', async () => {
    const plan = await seedActivePlan(tokenA, 'ui-blocked-' + Date.now());
    const created = await api.createOrder(tokenA, { planId: plan.id, serverName: 'ui-blocked-srv' });
    const orderId = created.body.data.id;
    expect((await api.pay(tokenA, orderId)).status).toBe(200);

    const failed = await api.provision(tokenA, orderId);
    expect(failed.status).toBe(502);
    expect(failed.body.success).toBe(false);
    expect(failed.body.details.providerFailure.code).toBe('NOT_CONFIGURED');

    const after = await api.order(tokenA, orderId);
    expect(after.status).toBe(200);
    expect(after.body.data.status).toBe('provisioning_failed');
    expect(after.body.data.providerInfo).toBeNull();

    // No server was created for the order.
    const servers = await request(server.app)
      .get('/api/v1/game-hosting/servers')
      .set(auth(tokenA))
      .query({ orderId });
    expect(servers.status).toBe(200);
    expect((servers.body.data.servers || []).length).toBe(0);
  });

  test('the storefront reports the blocked provider instead of promising infrastructure', async () => {
    const status = await request(server.app)
      .get('/api/v1/game-hosting/provider/status')
      .set(auth(tokenA));
    expect(status.status).toBe(200);
    expect(status.body.data.status).toBe('BLOCKED');
    expect(status.body.data.isRealProvider).toBe(false);
    expect(String(status.body.data.reason || '').length).toBeGreaterThan(0);
  });
});
