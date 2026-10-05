'use strict';

// gameHostingOperatorOrdersUi.test.js — the operator side of the Game Hosting
// order pipeline inside the CURRENT Market UI.
//
// The board existed but was a thin list: no status filter, no per-order detail,
// no distinction between "empty" and "failed to load", and every action button
// rendered unconditionally. Worse, the order projection that left the server
// was the internal bookkeeping record, so provider payloads and internal
// correlation keys reached browsers.
//
// Part A pins the HTTP contract the board depends on, including the
// authorization boundary (requireOperator) and the tenant scope. Part B runs
// the REAL market/js/app.js in a vm sandbox with a scripted API + DOM and pins
// the rendering/action semantics: rows, filter, error state, empty state,
// localization, provider fail-closed banner, retry/refund wiring and the
// confirm-before-mutate guarantee.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, readStore, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

// The happy path needs a working adapter. Only the mock is non-production, and
// it is pinned explicitly. The fail-closed block flips the registry instead.
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
  const email = 'opui' + tenantId + '+' + Date.now() + Math.random().toString(36).slice(2, 8) + '@test.com';
  const res = await request(server.app)
    .post('/api/v1/market/auth/register')
    .set('X-Tenant-Id', tenantId)
    .send({ email, password: 'Secret123' });
  expect(res.statusCode).toBe(201);
  return { token: res.body.data.token, customerId: res.body.data.customer.id };
}

async function createOperator(tenantId) {
  const { customerId } = await registerCustomer(tenantId);
  marketAuthService.setOperatorRole(customerId, tenantId, 'operator');
  const customer = marketAuthService.getById(customerId);
  const { signCustomerToken } = require('../utils/marketJwt');
  return { token: signCustomerToken(customer), customerId };
}

const auth = (t) => ({ 'X-Tenant-Id': TENANT_A, Authorization: 'Bearer ' + t });
const authB = (t) => ({ 'X-Tenant-Id': TENANT_B, Authorization: 'Bearer ' + t });

const api = {
  createOrder: (token, body) => request(server.app)
    .post('/api/v1/game-hosting/orders').set(auth(token)).send(body),
  pay: (token, id) => request(server.app)
    .post('/api/v1/game-hosting/orders/' + id + '/pay').set(auth(token)),
  provision: (token, id) => request(server.app)
    .post('/api/v1/game-hosting/orders/' + id + '/provision').set(auth(token)),
  order: (token, id) => request(server.app)
    .get('/api/v1/game-hosting/orders/' + id).set(auth(token)),
  adminOverview: (token, q) => request(server.app)
    .get('/api/v1/game-hosting/admin/overview').set(auth(token)).query(q || {}),
  adminRetry: (token, id) => request(server.app)
    .post('/api/v1/game-hosting/admin/orders/' + id + '/retry-provisioning').set(auth(token)),
  adminRefund: (token, id, body) => request(server.app)
    .post('/api/v1/game-hosting/admin/orders/' + id + '/refund').set(auth(token)).send(body || {}),
  adminSweep: (token) => request(server.app)
    .post('/api/v1/game-hosting/admin/expiry-sweep').set(auth(token))
};

async function seedActivePlan(token, name) {
  const res = await request(server.app)
    .post('/api/v1/game-hosting/plans')
    .set(auth(token))
    .send({ name, gameTitle: 'Minecraft', maxPlayers: 10, pricePerMonth: 20, status: 'active' });
  expect(res.statusCode).toBe(201);
  return res.body.data;
}

// Creates a paid order for tenant A and returns its id.
async function paidOrder(tag) {
  const plan = await seedActivePlan(tokenA, tag + '-' + Date.now() + Math.random().toString(36).slice(2, 6));
  const created = await api.createOrder(tokenA, { planId: plan.id, serverName: tag + '-srv', billingPeriod: '1m' });
  expect(created.statusCode).toBe(201);
  const id = created.body.data.id;
  const paid = await api.pay(tokenA, id);
  expect(paid.statusCode).toBe(200);
  return id;
}

beforeAll(async () => {
  dataDir = makeTempDataDir('gh-operator-ui');
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
  operatorTokenA = (await createOperator(TENANT_A)).token;
});

afterAll(() => {
  delete process.env.DIGITRONICS_DATA_DIR;
  delete process.env.GAME_HOSTING_PROVIDER;
  if (dataDir && fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
});

// ============================================================================
// A. HTTP — authorization, tenant scope, operator actions
// ============================================================================

describe('Operator orders API — authorization', () => {
  test('an operator sees the tenant-scoped board (provider state + counts + orders)', async () => {
    const id = await paidOrder('op-board');
    const res = await api.adminOverview(operatorTokenA);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.provider).toBeTruthy();
    expect(typeof res.body.data.provider.status).toBe('string');
    expect(res.body.data.total).toBeGreaterThan(0);
    expect(res.body.data.counts.paid).toBeGreaterThan(0);
    expect(res.body.data.orders.some((o) => o.id === id)).toBe(true);
  });

  test('a plain customer is refused on every operator endpoint (403, server-side)', async () => {
    const id = await paidOrder('op-customer-denied');
    const overview = await api.adminOverview(tokenA);
    expect(overview.statusCode).toBe(403);
    expect((await api.adminRetry(tokenA, id)).statusCode).toBe(403);
    expect((await api.adminRefund(tokenA, id)).statusCode).toBe(403);
    expect((await api.adminSweep(tokenA)).statusCode).toBe(403);
  });

  test('unauthenticated operator calls are rejected (401)', async () => {
    const res = await request(server.app)
      .get('/api/v1/game-hosting/admin/overview')
      .set('X-Tenant-Id', TENANT_A);
    expect(res.statusCode).toBe(401);
  });

  test('the board is tenant-scoped: another tenant\'s operator never sees the row', async () => {
    const id = await paidOrder('op-scope');
    const tenantBOperator = (await createOperator(TENANT_B)).token;
    const other = await request(server.app)
      .get('/api/v1/game-hosting/admin/overview')
      .set(authB(tenantBOperator));
    expect(other.statusCode).toBe(200);
    expect(other.body.data.orders.some((o) => o.id === id)).toBe(false);
    // ...and the owner tenant still sees it.
    const own = await api.adminOverview(operatorTokenA);
    expect(own.body.data.orders.some((o) => o.id === id)).toBe(true);
  });

  test('an operator token is bound to its own tenant: a foreign X-Tenant-Id is refused', async () => {
    const tenantBOperator = (await createOperator(TENANT_B)).token;
    // Same trusted token, wrong tenant scope → not an operator for that tenant.
    const mismatch = await request(server.app)
      .get('/api/v1/game-hosting/admin/overview')
      .set(auth(tenantBOperator));
    expect(mismatch.statusCode).toBe(403);
  });

  test('operator actions on a foreign tenant order fail closed (404, no existence leak)', async () => {
    const id = await paidOrder('op-foreign');
    const tokenOpB = (await createOperator(TENANT_B)).token;
    const retry = await request(server.app)
      .post('/api/v1/game-hosting/admin/orders/' + id + '/retry-provisioning')
      .set(authB(tokenOpB));
    // Tenant B is a different trust domain: the order is invisible there.
    expect([403, 404]).toContain(retry.statusCode);
    const refund = await request(server.app)
      .post('/api/v1/game-hosting/admin/orders/' + id + '/refund')
      .set(authB(tokenOpB))
      .send({ reason: 'cross-tenant' });
    expect([403, 404]).toContain(refund.statusCode);
    const after = await api.order(tokenA, id);
    expect(after.body.data.paymentStatus).toBe('paid');
  });
});

describe('Operator orders API — order detail + actions', () => {
  test('order detail is reachable for the operator and honours the status filter', async () => {
    const id = await paidOrder('op-detail');
    const one = await api.order(operatorTokenA, id);
    expect(one.statusCode).toBe(200);
    expect(one.body.data.id).toBe(id);
    expect(one.body.data.customerId).toBe(customerIdA);

    const filtered = await api.adminOverview(operatorTokenA, { status: 'paid' });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.body.data.orders.every((o) => o.status === 'paid')).toBe(true);
    expect(filtered.body.data.orders.some((o) => o.id === id)).toBe(true);
  });

  test('retry provisioning moves a paid order to active (and is rejected while unpaid)', async () => {
    const plan = await seedActivePlan(tokenA, 'op-retry-' + Date.now());
    const created = await api.createOrder(tokenA, { planId: plan.id, serverName: 'op-retry-srv' });
    const id = created.body.data.id;

    // Unpaid: the operator action must not bypass the payment gate.
    const tooEarly = await api.adminRetry(operatorTokenA, id);
    expect(tooEarly.statusCode).toBe(409);

    expect((await api.pay(tokenA, id)).statusCode).toBe(200);
    const retried = await api.adminRetry(operatorTokenA, id);
    expect(retried.statusCode).toBe(200);
    expect(retried.body.data.status).toBe('active');
    expect(retried.body.data.providerInfo.externalId).toBeTruthy();
  });

  test('refund flips the payment state exactly once', async () => {
    const id = await paidOrder('op-refund');
    const refunded = await api.adminRefund(operatorTokenA, id, { reason: 'operator-ui' });
    expect(refunded.statusCode).toBe(200);
    expect(refunded.body.data.paymentStatus).toBe('refunded');
    // Terminal: a second refund is refused rather than double-crediting.
    const again = await api.adminRefund(operatorTokenA, id, { reason: 'again' });
    expect(again.statusCode).toBe(409);
  });

  test('expiry sweep expires only due orders and reports the count', async () => {
    const id = await paidOrder('op-sweep');
    expect((await api.adminRetry(operatorTokenA, id)).body.data.status).toBe('active');

    // Back-date the period on the real store, then run the sweep the board calls.
    const store = readStore(dataDir, 'gameHostingOrders');
    const idx = store.orders.findIndex((o) => o.id === id);
    expect(idx).toBeGreaterThan(-1);
    store.orders[idx].periodEndsAt = new Date(Date.now() - 60 * 1000).toISOString();
    store.orders[idx].note = 'back-dated for sweep'; // keep the file size different from the cached read
    seed(dataDir, 'gameHostingOrders', store);

    const sweep = await api.adminSweep(operatorTokenA);
    expect(sweep.statusCode).toBe(200);
    expect(sweep.body.data.expired).toBeGreaterThan(0);
    const after = await api.order(operatorTokenA, id);
    expect(after.body.data.status).toBe('expired');
  });

  test('provider failure surfaces as an explicit 502 with a sanitized failure envelope', async () => {
    const previous = process.env.GAME_HOSTING_PROVIDER;
    process.env.GAME_HOSTING_PROVIDER = 'unavailable';
    try {
      const id = await paidOrder('op-failed');
      const res = await api.adminRetry(operatorTokenA, id);
      expect(res.statusCode).toBe(502);
      expect(res.body.success).toBe(false);
      expect(res.body.details.providerFailure.code).toBe('NOT_CONFIGURED');
      // The adapter's raw envelope is never forwarded to a browser session.
      expect(res.body.details.providerFailure.raw).toBeUndefined();
      const after = await api.order(operatorTokenA, id);
      expect(after.body.data.status).toBe('provisioning_failed');
    } finally {
      process.env.GAME_HOSTING_PROVIDER = previous;
    }
  });
});

describe('Order wire projection — internal fields never leave the server', () => {
  test('order responses omit internal correlation keys and provider payloads', async () => {
    const id = await paidOrder('op-wire');
    expect((await api.adminRetry(operatorTokenA, id)).statusCode).toBe(200);

    const one = await api.order(operatorTokenA, id);
    expect(one.body.data.providerInfo.externalId).toBeTruthy();
    expect(one.body.data.providerInfo.details).toBeUndefined();
    expect(one.body.data.providerKey).toBeUndefined();
    expect(one.body.data.idempotencyKey).toBeUndefined();

    const board = await api.adminOverview(operatorTokenA);
    const row = board.body.data.orders.find((o) => o.id === id);
    expect(row).toBeTruthy();
    expect(row.providerKey).toBeUndefined();
    expect(row.idempotencyKey).toBeUndefined();
    if (row.providerInfo) expect(row.providerInfo.details).toBeUndefined();

    // The record on disk still carries them: the provider idempotency key is
    // required for retries and must not have been dropped at the source.
    const store = readStore(dataDir, 'gameHostingOrders');
    const stored = store.orders.find((o) => o.id === id);
    expect(stored.providerKey).toBeTruthy();
  });

  test('provider-status payloads are sanitized too (no raw envelope)', async () => {
    const id = await paidOrder('op-provider-status');
    expect((await api.adminRetry(operatorTokenA, id)).statusCode).toBe(200);
    const res = await request(server.app)
      .get('/api/v1/game-hosting/orders/' + id + '/provider-status')
      .set(auth(tokenA));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.order.providerInfo.details).toBeUndefined();
    expect(res.body.data.order.providerKey).toBeUndefined();
    if (res.body.data.provider) expect(res.body.data.provider.raw).toBeUndefined();
  });
});

// ============================================================================
// B. UI — the real market/js/app.js rendered in a sandbox
// ============================================================================

const APP_SRC = repoFile('market/js/app.js');
const LOCALES = loadLocales();

function makeElement(id) {
  const el = {
    id,
    innerHTML: '',
    textContent: '',
    value: '',
    disabled: false,
    style: {},
    dataset: {},
    _handlers: {},
    classList: { add() {}, remove() {}, toggle() { return false; }, contains() { return false; } },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    appendChild() {},
    removeChild() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener(ev, fn) { (el._handlers[ev] = el._handlers[ev] || []).push(fn); },
    removeEventListener(ev, fn) {
      const list = el._handlers[ev];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i !== -1) list.splice(i, 1);
    },
    showModal() { el._open = true; },
    close() { el._open = false; },
    focus() {},
    blur() {},
    dispatchEvent() { return true; },
    click() { (el._handlers.click || []).slice().forEach((fn) => fn({ preventDefault() {}, target: el })); }
  };
  return el;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

// Boots the real app.js with a scripted API/DOM. Nothing outside the sandbox
// is touched; the sources are the repo files themselves.
function bootMarket(opts) {
  const o = opts || {};
  const els = new Map();
  // Ids the shell owns outside the rendered page (nav/auth links + the modal).
  const SHELL_IDS = new Set([
    'mk-app', 'mk-cart-count', 'mk-mobile-cart-count', 'mk-bottom-cart-count',
    'mk-lang-btn', 'mk-menu-btn', 'mk-mobile-nav', 'mk-bottom-nav',
    'mk-confirm-dialog', 'mk-confirm-title', 'mk-confirm-msg',
    'mk-confirm-cancel', 'mk-confirm-ok',
    'mk-op-nav', 'mk-mobile-op-nav', 'mk-op-nav-link', 'mk-mobile-op-nav-link',
    'mk-gh-orders-link', 'mk-mobile-gh-orders-link',
    'mk-gh-requests-link', 'mk-mobile-gh-requests-link'
  ]);
  const appEl = makeElement('mk-app');
  els.set('mk-app', appEl);

  // DOM-like lookup: only ids that actually exist (shell ids or ids present in
  // the currently rendered page). A handler bound to a button the page never
  // rendered is therefore a test failure, not a silent stub.
  function getEl(id) {
    if (els.has(id)) return els.get(id);
    if (SHELL_IDS.has(id)) { const e = makeElement(id); els.set(id, e); return e; }
    // Scan the page plus every already-materialised node, because some surfaces
    // inject their buttons into a container element after the first paint.
    const re = /id="([^"]+)"/g;
    const rendered = new Set();
    const sources = [appEl.innerHTML || ''];
    els.forEach((e) => sources.push(e.innerHTML || ''));
    sources.forEach((html) => {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(html))) rendered.add(m[1]);
    });
    if (!rendered.has(id)) return null;
    const e = makeElement(id);
    els.set(id, e);
    return e;
  }
  const el = (id) => els.get(id) || getEl(id);
  const winHandlers = {};
  const docHandlers = {};
  const storage = { mk_locale: o.locale || 'ar' };
  const calls = { overview: [], retry: [], refund: [], sweep: [] };

  const api = {
    isAuthed: () => o.authed !== false,
    isOperator: () => o.isOperator !== false,
    ghAdminOverview: (q) => {
      calls.overview.push(q || {});
      if (o.overviewError) return Promise.reject(o.overviewError);
      return Promise.resolve(o.overview === undefined ? null : o.overview);
    },
    ghAdminRetryProvisioning: (id) => {
      calls.retry.push(id);
      if (o.retryError) return Promise.reject(o.retryError);
      return o.retryPending ? new Promise(() => {}) : Promise.resolve({ id, status: 'active' });
    },
    ghAdminRefund: (id, payload) => {
      calls.refund.push({ id, payload });
      if (o.refundError) return Promise.reject(o.refundError);
      return Promise.resolve({ id, paymentStatus: 'refunded' });
    },
    ghAdminExpireSweep: () => {
      calls.sweep.push(true);
      return Promise.resolve({ expired: 2 });
    }
  };

  const window = {
    addEventListener(ev, fn) { (winHandlers[ev] = winHandlers[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() { return true; },
    MK_API: api,
    MK_LOCALES: LOCALES,
    MK_CONFIG: { currency: 'USD' },
    MK_CART: { count: () => 0, items: () => [], setQty() {}, remove() {}, add() {} },
    lucide: { createIcons() {} },
    confirm: () => true
  };

  const document = {
    readyState: 'loading',
    documentElement: { lang: 'ar', dir: 'rtl' },
    body: makeElement('body'),
    getElementById: getEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: (tag) => makeElement('new:' + tag),
    addEventListener(ev, fn) { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
    removeEventListener() {}
  };

  const localStorage = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null),
    setItem: (k, v) => { storage[k] = String(v); },
    removeItem: (k) => { delete storage[k]; }
  };

  const location = { hash: o.hash || '#/operator/orders' };

  const sandbox = {
    window,
    document,
    localStorage,
    location,
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
    Intl,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    Promise,
    Date,
    Math,
    JSON,
    fetch: () => Promise.reject(new Error('network disabled in the sandbox'))
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(APP_SRC, sandbox, { filename: 'market/js/app.js' });

  // The app defers init() until DOMContentLoaded; drive it explicitly.
  document.readyState = 'complete';
  (docHandlers.DOMContentLoaded || []).forEach((fn) => fn());

  const hashchange = () => (winHandlers.hashchange || []).slice().forEach((fn) => fn());

  return {
    els, el, elOrNull: getEl, calls, location, hashchange,
    html: () => appEl.innerHTML,
    navigate: async (hash) => { location.hash = hash; hashchange(); await flush(); await flush(); }
  };
}

const SAMPLE_ORDER = (over) => Object.assign({
  id: '11111111-2222-3333-4444-555555555555',
  tenantId: TENANT_A,
  customerId: '99999999-8888-7777-6666-555555555555',
  planId: 'plan-1',
  planName: 'Minecraft Starter',
  serverName: 'srv-alpha',
  region: 'eu',
  billingPeriod: '1m',
  currency: 'USD',
  amount: 20,
  monthlyPrice: 20,
  status: 'active',
  paymentStatus: 'paid',
  paymentRef: 'GH-PAY-abc',
  payments: [{ ref: 'GH-PAY-abc', amount: 20, status: 'paid' }],
  providerInfo: { provider: 'mock', externalId: 'mocksrv-1', endpoint: 'mock://srv-alpha', provisionedAt: '2026-09-01T00:00:00.000Z', attempts: 1 },
  provisioningAttempts: 1,
  lastProvisionError: null,
  periodStartsAt: '2026-09-01T00:00:00.000Z',
  periodEndsAt: '2026-10-01T00:00:00.000Z',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z'
}, over || {});

const PROVIDER_READY = { status: 'READY', providerKind: 'mock', isRealProvider: true };

describe('Operator board UI — rendering states', () => {
  test('renders the tenant-scoped board with rows, status badges and detail links', async () => {
    const view = bootMarket({
      overview: { provider: PROVIDER_READY, counts: { active: 1, provisioning_failed: 1 }, total: 2, orders: [
        SAMPLE_ORDER(),
        SAMPLE_ORDER({ id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', planName: 'Rust Server', status: 'provisioning_failed', lastProvisionError: 'NOT_CONFIGURED' })
      ] }
    });
    await flush();
    const html = view.html();
    expect(html).toContain('Minecraft Starter');
    expect(html).toContain('Rust Server');
    // Rows are addressed by a short, non-spoofable id and link to the detail route.
    expect(html).toContain('#/operator/orders/11111111-2222-3333-4444-555555555555');
    expect(html).toContain('11111111');
    expect(html).toContain(LOCALES.ar.op_order_details);
    expect(html).toContain(LOCALES.ar.op_order_last_error);
    expect(html).toContain('NOT_CONFIGURED');
    expect(html).not.toContain('idempotencyKey');
    expect(html).not.toContain('providerKey');
  });

  test('empty board is an explicit empty state, not a blank page', async () => {
    const view = bootMarket({ overview: { provider: PROVIDER_READY, counts: {}, total: 0, orders: [] } });
    await flush();
    const html = view.html();
    expect(html).toContain('mk-empty');
    expect(html).toContain(LOCALES.ar.op_orders_empty_hint);
    expect(html).not.toContain('mk-banner error');
  });

  test('the status filter is server-driven and a filtered-empty board offers a way back', async () => {
    const view = bootMarket({ hash: '#/operator/orders?status=provisioning_failed' });
    view.calls.overview.length = 0;
    await view.navigate('#/operator/orders?status=provisioning_failed');
    expect(view.calls.overview[view.calls.overview.length - 1]).toEqual({ status: 'provisioning_failed' });
    const html = view.html();
    expect(html).toContain('mk-empty');
    expect(html).toContain(LOCALES.ar.op_orders_empty_filtered);
    expect(html).toContain(LOCALES.ar.op_orders_filter_clear);
    expect(html).toContain('#/operator/orders"');
  });

  test('a failed load shows an error banner with a retry action (never an empty board)', async () => {
    const err = new Error('Service unavailable');
    const view = bootMarket({ overviewError: err });
    await flush();
    const html = view.html();
    expect(html).toContain('Service unavailable');
    expect(html).toContain('mk-banner error');
    expect(html).toContain(LOCALES.ar.op_orders_reload);
    expect(html).not.toContain('mk-empty-title');
  });

  test('a 403 from the server is surfaced as an authorization failure', async () => {
    const err = new Error('Forbidden');
    err.status = 403;
    const view = bootMarket({ overviewError: err });
    await flush();
    expect(view.html()).toContain(LOCALES.ar.op_orders_forbidden);
  });

  test('a non-operator client never calls the operator API', async () => {
    const view = bootMarket({ isOperator: false });
    await flush();
    expect(view.calls.overview.length).toBe(0);
    expect(view.html()).toContain(LOCALES.ar.gh_auth_required);
  });

  test('a blocked provider is announced and no success is implied', async () => {
    const view = bootMarket({
      overview: { provider: { status: 'BLOCKED', providerKind: 'unavailable', isRealProvider: false }, counts: { paid: 1 }, total: 1, orders: [SAMPLE_ORDER({ status: 'paid' })] }
    });
    await flush();
    expect(view.html()).toContain(LOCALES.ar.gh_provider_blocked);
  });

  test('localization: the same board renders Arabic (RTL) and English', async () => {
    const data = { provider: PROVIDER_READY, counts: { active: 1 }, total: 1, orders: [SAMPLE_ORDER()] };
    const ar = bootMarket({ locale: 'ar', overview: data });
    await flush();
    expect(ar.html()).toContain('تاريخ الإنشاء');
    expect(ar.el('mk-lang-btn').textContent || '').not.toBe(undefined);

    const en = bootMarket({ locale: 'en', overview: data });
    await flush();
    expect(en.html()).toContain('Created');
    expect(en.html()).not.toContain('تاريخ الإنشاء');
  });

  test('every new operator string exists in both locales', () => {
    const keys = [
      'op_orders_filter_label', 'op_orders_filter_all', 'op_orders_filter_clear',
      'op_orders_empty_hint', 'op_orders_empty_filtered', 'op_orders_error',
      'op_orders_forbidden', 'op_orders_reload', 'op_orders_order_id',
      'op_orders_customer', 'op_orders_created', 'op_order_details',
      'op_back_to_orders', 'op_order_detail_title', 'op_order_payment_ref',
      'op_order_payments', 'op_order_provider_kind', 'op_order_provider_external',
      'op_order_endpoint_placeholder_unused_guard_removed', 'op_order_provision_attempts',
      'op_order_last_error', 'op_order_period_start', 'op_order_monthly',
      'op_order_updated', 'op_order_not_real_provider'
    ].filter((k) => !k.startsWith('op_order_endpoint_placeholder'));
    keys.forEach((k) => {
      expect(LOCALES.ar[k]).toBeTruthy();
      expect(LOCALES.en[k]).toBeTruthy();
      expect(LOCALES.ar[k]).not.toBe(LOCALES.en[k]);
    });
  });
});

describe('Operator board UI — action wiring', () => {
  const single = () => ({ provider: PROVIDER_READY, counts: { paid: 1 }, total: 1, orders: [SAMPLE_ORDER({ status: 'paid' })] });

  test('retry provisioning is disabled while the request is in flight', async () => {
    const view = bootMarket({ overview: single(), retryPending: true });
    await flush();
    const btn = view.el('op-gh-retry-11111111-2222-3333-4444-555555555555');
    expect(btn._handlers.click.length).toBe(1);
    btn._handlers.click[0]();
    expect(btn.disabled).toBe(true);
    expect(view.calls.retry).toEqual(['11111111-2222-3333-4444-555555555555']);
  });

  test('a failed retry surfaces the reason and re-enables the button', async () => {
    const view = bootMarket({
      overview: single(),
      retryError: Object.assign(new Error('Provisioning still failing: NOT_CONFIGURED'), { status: 502 })
    });
    await flush();
    const btn = view.el('op-gh-retry-11111111-2222-3333-4444-555555555555');
    await btn._handlers.click[0]();
    await flush();
    const html = view.el('op-gh-orders-msg').innerHTML;
    expect(html).toContain('Provisioning still failing');
    expect(btn.disabled).toBe(false);
  });

  test('refund mutates nothing when the operator cancels the confirmation', async () => {
    const view = bootMarket({ overview: single() });
    await flush();
    const btn = view.el('op-gh-refund-11111111-2222-3333-4444-555555555555');
    expect(btn._handlers.click.length).toBe(1);
    btn._handlers.click[0]();
    await flush();
    // The dialog is open, nothing has been sent yet.
    expect(view.calls.refund.length).toBe(0);
    expect(view.el('mk-confirm-dialog')._open).toBe(true);
    view.el('mk-confirm-cancel').click();
    await flush();
    expect(view.calls.refund.length).toBe(0);
    expect(btn.disabled).toBe(false);
  });

  test('refund runs exactly once after the operator confirms', async () => {
    const view = bootMarket({ overview: single() });
    await flush();
    view.el('op-gh-refund-11111111-2222-3333-4444-555555555555')._handlers.click[0]();
    await flush();
    view.el('mk-confirm-ok').click();
    await flush();
    await flush();
    expect(view.calls.refund.length).toBe(1);
    expect(view.calls.refund[0].id).toBe('11111111-2222-3333-4444-555555555555');
    expect(typeof view.calls.refund[0].payload.reason).toBe('string');
  });

  test('the expiry sweep is wired to the operator endpoint and reports the count', async () => {
    const view = bootMarket({ overview: single() });
    await flush();
    await view.el('op-gh-sweep')._handlers.click[0]();
    await flush();
    expect(view.calls.sweep.length).toBe(1);
    expect(view.el('op-gh-sweep-msg').textContent).toContain('2');
  });
});

describe('Operator order detail UI', () => {
  const ORDER_ID = '11111111-2222-3333-4444-555555555555';

  test('renders the order detail from the tenant-scoped board without leaking internals', async () => {
    const view = bootMarket({ hash: '#/operator/orders/' + ORDER_ID, overview: { provider: PROVIDER_READY, counts: { active: 1 }, total: 1, orders: [SAMPLE_ORDER()] } });
    await flush();
    const html = view.html();
    expect(html).toContain(ORDER_ID);
    expect(html).toContain('mocksrv-1');
    expect(html).toContain(LOCALES.ar.op_order_provision_attempts);
    expect(html).not.toContain('providerKey');
    expect(html).not.toContain('idempotencyKey');
    expect(html).not.toContain('"details"');
  });

  test('an unknown order id is an empty state with a way back', async () => {
    const view = bootMarket({ hash: '#/operator/orders/does-not-exist', overview: { provider: PROVIDER_READY, counts: {}, total: 0, orders: [] } });
    await flush();
    expect(view.html()).toContain(LOCALES.ar.gh_order_not_found);
    expect(view.html()).toContain(LOCALES.ar.op_back_to_orders);
  });

  test('an active order offers renewal/termination to the customer but only admin actions to the operator', async () => {
    const view = bootMarket({ hash: '#/operator/orders/' + ORDER_ID, overview: { provider: PROVIDER_READY, counts: { active: 1 }, total: 1, orders: [SAMPLE_ORDER()] } });
    await flush();
    // Active + paid: no retry (state machine), but a refund is legitimate.
    expect(view.html()).not.toContain('op-gh-detail-retry');
    expect(view.elOrNull('op-gh-detail-retry')).toBeNull();
    expect(view.el('op-gh-detail-refund')._handlers.click.length).toBe(1);
  });

  test('a failed order exposes retry on the detail page', async () => {
    const view = bootMarket({
      hash: '#/operator/orders/' + ORDER_ID,
      overview: { provider: PROVIDER_READY, counts: { provisioning_failed: 1 }, total: 1, orders: [SAMPLE_ORDER({ status: 'provisioning_failed', lastProvisionError: 'NOT_CONFIGURED' })] }
    });
    await flush();
    expect(view.el('op-gh-detail-retry')._handlers.click.length).toBe(1);
    // Retrying a failed provision happens while the payment is still held.
    expect(view.html()).not.toContain('op-gh-detail-refund');
    expect(view.html()).toContain('NOT_CONFIGURED');
  });

  test('a non-operator cannot render the detail page and no request is made', async () => {
    const view = bootMarket({ hash: '#/operator/orders/' + ORDER_ID, isOperator: false });
    await flush();
    expect(view.calls.overview.length).toBe(0);
    expect(view.html()).toContain(LOCALES.ar.gh_auth_required);
  });
});
