'use strict';

// Webhook tenant-isolation regression tests.
//
// Proves the cross-tenant exposure fix:
//   1. Webhooks are bound to the trusted server-side tenant at registration.
//   2. webhooks.manage gates every webhook route (Owner/Admin only).
//   3. CRUD is ownership-scoped: a tenant can never see/manage another
//      tenant's webhooks (404), and lists reveal only own webhooks.
//   4. Dispatch is tenant-scoped: tenant A's hook NEVER receives tenant B's
//      event even when both subscribe to the same event type.

const fs = require('fs');
const http = require('http');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const now = new Date().toISOString();
const PW = 'Pass#1234';
const USERS = { users: [
  { id: 'u-a', username: 'whadmina', password: hash(PW), role: 'Admin', fullName: 'Admin A', tenantIds: ['ta'], tenantRoles: { ta: 'Admin' }, createdAt: now, updatedAt: now },
  { id: 'u-b', username: 'whadminb', password: hash(PW), role: 'Admin', fullName: 'Admin B', tenantIds: ['tb'], tenantRoles: { tb: 'Admin' }, createdAt: now, updatedAt: now },
  { id: 'u-m', username: 'whmgra', password: hash(PW), role: 'Manager', fullName: 'Manager A', tenantIds: ['ta'], tenantRoles: { ta: 'Manager' }, createdAt: now, updatedAt: now }
]};

const COMPANIES = { companies: [
  { id: 'ta', name: 'Tenant A', active: true },
  { id: 'tb', name: 'Tenant B', active: true }
]};

let server;
let dataDir;
let tokenA, tokenB, tokenM;

registerCleanup(() => [server], () => [dataDir]);

async function loginAs(username, company) {
  const res = await request(server.app).post('/api/v1/auth/login').send({ username, password: PW, company });
  if (res.statusCode !== 200) throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  return res.body.data.accessToken;
}

beforeAll(async () => {
  process.env.ENABLE_TENANT_CARRY = 'true';
  process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
  process.env.ENABLE_TENANT_ROLES = 'true';
  process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
  dataDir = makeTempDataDir('webhook-tenant');
  seed(dataDir, 'companies', COMPANIES);
  seed(dataDir, 'users', USERS);
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  tokenA = await loginAs('whadmina', 'ta');
  tokenB = await loginAs('whadminb', 'tb');
  tokenM = await loginAs('whmgra', 'ta');
});

afterAll(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  delete process.env.ENABLE_TENANT_CARRY;
  delete process.env.ENABLE_MULTI_COMPANY_LOGIN;
  delete process.env.ENABLE_TENANT_ROLES;
  delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
});

const auth = (token) => ({ Authorization: 'Bearer ' + token });

function startReceiver() {
  const deliveries = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      deliveries.push({ event: req.headers['x-webhook-event'], payload: body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  return new Promise((resolve) => {
    srv.listen(0, '127.0.0.1', () => {
      resolve({ srv, deliveries, url: `http://127.0.0.1:${srv.address().port}/hook` });
    });
  });
}

describe('Webhook tenant isolation — binding, permission gate, cross-tenant CRUD', () => {
  let hookA;

  test('Admin A registers a webhook bound to tenant ta', async () => {
    const res = await request(server.app)
      .post('/api/v1/webhooks')
      .set(auth(tokenA))
      .send({ url: 'https://example.com/a', events: ['sale.created'], description: 'A' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.id).toBeTruthy();
    expect(res.body.data.tenantId).toBe('ta');
    hookA = res.body.data.id;
  });

  test('Manager (tenant ta) cannot register a webhook — webhooks.manage owners only', async () => {
    const res = await request(server.app)
      .post('/api/v1/webhooks')
      .set(auth(tokenM))
      .send({ url: 'https://example.com/mgr', events: ['sale.created'] });
    expect(res.statusCode).toBe(403);
  });

  test('Manager (tenant ta) cannot list webhooks', async () => {
    const res = await request(server.app).get('/api/v1/webhooks').set(auth(tokenM));
    expect(res.statusCode).toBe(403);
  });

  test('Admin B cannot read Admin A webhook (cross-tenant 404)', async () => {
    const res = await request(server.app).get(`/api/v1/webhooks/${hookA}`).set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin B listing webhooks never reveals Admin A webhook', async () => {
    const res = await request(server.app).get('/api/v1/webhooks').set(auth(tokenB));
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data || []).map(h => h.id);
    expect(ids).not.toContain(hookA);
  });

  test('Admin B cannot update Admin A webhook (cross-tenant 404)', async () => {
    const res = await request(server.app)
      .put(`/api/v1/webhooks/${hookA}`)
      .set(auth(tokenB))
      .send({ active: false });
    expect(res.statusCode).toBe(404);
  });

  test('Admin B cannot delete Admin A webhook (cross-tenant 404)', async () => {
    const res = await request(server.app).delete(`/api/v1/webhooks/${hookA}`).set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin A webhook is untouched after Admin B attempts', async () => {
    const res = await request(server.app).get(`/api/v1/webhooks/${hookA}`).set(auth(tokenA));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.active).toBe(true);
  });

  test('Admin A can still manage own webhook (update + remove)', async () => {
    const up = await request(server.app)
      .put(`/api/v1/webhooks/${hookA}`)
      .set(auth(tokenA))
      .send({ active: false });
    expect(up.statusCode).toBe(200);
    expect(up.body.data.active).toBe(false);

    const del = await request(server.app).delete(`/api/v1/webhooks/${hookA}`).set(auth(tokenA));
    expect(del.statusCode).toBe(200);
  });
});

describe('Webhook tenant isolation — dispatch never crosses tenants', () => {
  test('tenant A event does NOT reach tenant B webhook', async () => {
    const recvA = await startReceiver();
    const recvB = await startReceiver();

    try {
      const hA = await request(server.app)
        .post('/api/v1/webhooks')
        .set(auth(tokenA))
        .send({ url: recvA.url, events: ['sale.created'] });
      expect(hA.statusCode).toBe(201);

      const hB = await request(server.app)
        .post('/api/v1/webhooks')
        .set(auth(tokenB))
        .send({ url: recvB.url, events: ['sale.created'] });
      expect(hB.statusCode).toBe(201);

      // Create a sale as Admin A (tenant ta) — publishes sale.created in ta context.
      const sale = await request(server.app)
        .post('/api/v1/sales')
        .set(auth(tokenA))
        .send({ id: 'INV-ISO-A', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'A', payment: 'cash' });
      expect(sale.statusCode).toBe(201);

      await new Promise(r => setTimeout(r, 400));

      expect(recvA.deliveries.length).toBeGreaterThan(0);
      expect(recvB.deliveries.length).toBe(0);
    } finally {
      recvA.srv.close();
      recvB.srv.close();
    }
  });

  test('tenant B webhook still receives its own tenant events', async () => {
    const recvB = await startReceiver();

    try {
      const hB = await request(server.app)
        .post('/api/v1/webhooks')
        .set(auth(tokenB))
        .send({ url: recvB.url, events: ['sale.created'] });
      expect(hB.statusCode).toBe(201);

      const sale = await request(server.app)
        .post('/api/v1/sales')
        .set(auth(tokenB))
        .send({ id: 'INV-ISO-B', items: [{ productId: 'p1', qty: 1, price: 10 }], total: 10, customer: 'B', payment: 'cash' });
      expect(sale.statusCode).toBe(201);

      await new Promise(r => setTimeout(r, 400));

      expect(recvB.deliveries.length).toBeGreaterThan(0);
    } finally {
      recvB.srv.close();
    }
  });
});