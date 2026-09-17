'use strict';

// 3B.2-D — Sales async domain regression + tenant isolation tests.
//
// Runs TWO real HTTP servers:
//   serverOn  — ENABLE_TENANT_SALES_ISOLATION=true (Phase 24 production path:
//               async entity API, full raw-store writes, ownership enforced)
//   serverOff — sales isolation OFF but ENABLE_TENANT_FILTERING +
//               ENABLE_TENANT_METADATA ON (legacy read-modify-write path,
//               hardened with _loadRaw + ownership gate so a filtered view is
//               never persisted)
//
// Covers: tenant read isolation, create stamping, client-supplied tenantId
// override rejection, cross-tenant update/delete blocked with data survival,
// stats scoping, the MANDATORY data-loss regression (both paths), concurrent
// interleaved requests, async error propagation, and event ordering
// (persist → publish, exactly once).

const fs = require('fs');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  FILTER: process.env.ENABLE_TENANT_FILTERING,
  MD: process.env.ENABLE_TENANT_METADATA,
  ISO_SALES: process.env.ENABLE_TENANT_SALES_ISOLATION,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'corp-a', name: 'Corp A', code: 'CA', active: true },
  { id: 'corp-b', name: 'Corp B', code: 'CB', active: true }
];

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const users = { users: [
  {
    id: 'u-a', username: 'adminA', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin A', tenantIds: ['corp-a'], tenantRoles: { 'corp-a': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  },
  {
    id: 'u-b', username: 'adminB', password: hash('Pass#123'), role: 'Owner',
    fullName: 'Admin B', tenantIds: ['corp-b'], tenantRoles: { 'corp-b': 'Owner' },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  }
]};

function salesRecords() {
  const t = new Date().toISOString();
  return { invoices: [
    { id: 'INV-A-1', invoiceId: 'A-1001', items: [{ productId: 'p1', qty: 1 }], total: 100, customer: 'A Customer', payment: 'cash', tenantId: 'corp-a', createdAt: t, updatedAt: t },
    { id: 'INV-B-1', invoiceId: 'B-2001', items: [{ productId: 'p2', qty: 2 }], total: 200, customer: 'B Customer', payment: 'credit', tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'INV-B-2', invoiceId: 'B-2002', items: [{ productId: 'p2', qty: 1 }], total: 90, customer: 'B Customer 2', payment: 'cash', tenantId: 'corp-b', createdAt: t, updatedAt: t },
    { id: 'INV-LEG-1', invoiceId: 'L-0001', items: [{ productId: 'pX', qty: 1 }], total: 50, customer: 'Legacy', payment: 'cash', createdAt: t, updatedAt: t }
  ]};
}

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', users);
  seed(dir, 'sales', salesRecords());
}

async function loginAs(app, username, company) {
  const res = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: 'Pass#123', company });
  return res.body && res.body.data ? res.body.data.accessToken : undefined;
}

describe('3B.2-D — Sales async domain (isolation ON + legacy OFF paths)', () => {
  let appOn;
  let dirOn;
  let appOff;
  let dirOff;
  let tokenAOn;
  let tokenBOn;
  let tokenAOff;
  let tokenBOff;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.AUTH_REQUIRED = 'true';
    process.env.ENABLE_TENANT_FILTERING = 'true';
    process.env.ENABLE_TENANT_METADATA = 'true';
    // Boot order matters for the event-ordering test: startServer() calls
    // jest.resetModules(), so the eventBus instance cached in the module
    // registry is the LAST-booted server's. Boot appOff first, then appOn, so
    // a require of eventBus inside the tests returns the instance appOn uses.
    delete process.env.ENABLE_TENANT_SALES_ISOLATION;
    dirOff = makeTempDataDir('sales-async-off');
    seedAll(dirOff);
    const sOff = await startServer(dirOff, { AUTH_REQUIRED: 'true' });
    appOff = sOff.app;
    tokenAOff = await loginAs(appOff, 'adminA', 'corp-a');
    tokenBOff = await loginAs(appOff, 'adminB', 'corp-b');

    process.env.ENABLE_TENANT_SALES_ISOLATION = 'true';
    dirOn = makeTempDataDir('sales-async-on');
    seedAll(dirOn);
    const sOn = await startServer(dirOn, { AUTH_REQUIRED: 'true' });
    appOn = sOn.app;
    tokenAOn = await loginAs(appOn, 'adminA', 'corp-a');
    tokenBOn = await loginAs(appOn, 'adminB', 'corp-b');
  });

  afterAll(() => {
    for (const d of [dirOn, dirOff]) {
      if (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) {} }
    }
    const map = [
      ['ROLES', 'ENABLE_TENANT_ROLES'],
      ['CARRY', 'ENABLE_TENANT_CARRY'],
      ['MC', 'ENABLE_MULTI_COMPANY_LOGIN'],
      ['MEM', 'ENABLE_TENANT_USER_MEMBERSHIP'],
      ['AUTH', 'AUTH_REQUIRED'],
      ['FILTER', 'ENABLE_TENANT_FILTERING'],
      ['MD', 'ENABLE_TENANT_METADATA'],
      ['ISO_SALES', 'ENABLE_TENANT_SALES_ISOLATION'],
      ['DATA', 'DIGITRONICS_DATA_DIR']
    ];
    for (const [envKey, origKey] of map) {
      const orig = ORIGINAL_ENV[envKey];
      if (orig === undefined) delete process.env[origKey];
      else process.env[origKey] = orig;
    }
  });

  const get = (app, path, token) => request(app).get(path).set('Authorization', `Bearer ${token}`);
  const post = (app, path, body, token) => request(app).post(path).send(body).set('Authorization', `Bearer ${token}`);
  const put = (app, path, body, token) => request(app).put(path).send(body).set('Authorization', `Bearer ${token}`);
  const del = (app, path, token) => request(app).delete(path).set('Authorization', `Bearer ${token}`);

  // ===================== ISOLATION ON (PRODUCTION PATH) =====================

  describe('isolation ON — tenant read isolation', () => {
    test('list: A sees A + legacy only; B sees B + legacy only', async () => {
      const a = await get(appOn, '/api/v1/sales', tokenAOn);
      const b = await get(appOn, '/api/v1/sales', tokenBOn);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      const idsA = a.body.data.invoices.map(i => i.id);
      const idsB = b.body.data.invoices.map(i => i.id);
      expect(idsA).toContain('INV-A-1');
      expect(idsA).toContain('INV-LEG-1');
      expect(idsA).not.toContain('INV-B-1');
      expect(idsB).toContain('INV-B-1');
      expect(idsB).toContain('INV-LEG-1');
      expect(idsB).not.toContain('INV-A-1');
    });

    test('getById: own 200, legacy 200, foreign 404', async () => {
      const own = await get(appOn, '/api/v1/sales/INV-A-1', tokenAOn);
      expect(own.statusCode).toBe(200);
      const legacy = await get(appOn, '/api/v1/sales/INV-LEG-1', tokenAOn);
      expect(legacy.statusCode).toBe(200);
      const foreign = await get(appOn, '/api/v1/sales/INV-B-1', tokenAOn);
      expect(foreign.statusCode).toBe(404);
    });

    test('stats are tenant scoped', async () => {
      const a = await get(appOn, '/api/v1/sales/stats', tokenAOn);
      const b = await get(appOn, '/api/v1/sales/stats', tokenBOn);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(a.body.data.count).not.toBe(b.body.data.count);
    });
  });

  describe('isolation ON — create binding + override rejection', () => {
    test('create stamps the current tenant', async () => {
      const res = await post(appOn, '/api/v1/sales', { id: 'INV-A-2', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5 }, tokenAOn);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('corp-a');
      const onDisk = readStore(dirOn, 'sales');
      expect(onDisk.invoices.find(i => i.id === 'INV-A-2').tenantId).toBe('corp-a');
    });

    test('client-supplied foreign tenantId cannot override server context (400, store unchanged)', async () => {
      const before = JSON.stringify(readStore(dirOn, 'sales'));
      const res = await post(appOn, '/api/v1/sales', { id: 'INV-INTRUDER', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'corp-b' }, tokenAOn);
      expect(res.statusCode).toBe(400);
      expect(JSON.stringify(readStore(dirOn, 'sales'))).toBe(before);
    });

    test('client-supplied own tenantId is accepted (no tampering)', async () => {
      const res = await post(appOn, '/api/v1/sales', { id: 'INV-OK-A', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5, tenantId: 'corp-a' }, tokenAOn);
      expect(res.statusCode).toBe(201);
      expect(res.body.data.tenantId).toBe('corp-a');
    });
  });

  describe('isolation ON — cross-tenant mutation blocked, data survives', () => {
    test('cross-tenant update blocked (404) + other tenant record survives', async () => {
      const before = JSON.stringify(readStore(dirOn, 'sales'));
      const res = await put(appOn, '/api/v1/sales/INV-B-1', { customer: 'Hijack', total: 1 }, tokenAOn);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(readStore(dirOn, 'sales'))).toBe(before);
    });

    test('cross-tenant delete blocked (404) + other tenant record survives', async () => {
      const res = await del(appOn, '/api/v1/sales/INV-B-1', tokenAOn);
      expect(res.statusCode).toBe(404);
      const onDisk = readStore(dirOn, 'sales');
      expect(onDisk.invoices.some(i => i.id === 'INV-B-1')).toBe(true);
    });

    test('own update works and tenantId is immutable', async () => {
      const res = await put(appOn, '/api/v1/sales/INV-A-1', { customer: 'A Updated' }, tokenAOn);
      expect(res.statusCode).toBe(200);
      expect(res.body.data.customer).toBe('A Updated');
      expect(res.body.data.tenantId).toBe('corp-a');
      const onDisk = readStore(dirOn, 'sales');
      expect(onDisk.invoices.find(i => i.id === 'INV-A-1').customer).toBe('A Updated');
      expect(onDisk.invoices.some(i => i.id === 'INV-B-1')).toBe(true);
    });
  });

  // ===================== MANDATORY DATA-LOSS REGRESSION =====================

  test('DATA-LOSS: after tenant A create+update+delete, tenant B sales survive on disk', async () => {
    const before = readStore(dirOn, 'sales').invoices.map(i => i.id);

    // A creates
    const created = await post(appOn, '/api/v1/sales', { id: 'INV-DL-A', items: [{ productId: 'p1', qty: 1, price: 5 }], total: 5 }, tokenAOn);
    expect(created.statusCode).toBe(201);
    // A updates own
    const updated = await put(appOn, '/api/v1/sales/INV-A-1', { customer: 'DL Updated' }, tokenAOn);
    expect(updated.statusCode).toBe(200);
    // A deletes own
    const deleted = await del(appOn, '/api/v1/sales/INV-DL-A', tokenAOn);
    expect(deleted.statusCode).toBe(200);

    const onDisk = readStore(dirOn, 'sales').invoices.map(i => i.id);
    for (const id of before) expect(onDisk).toContain(id); // nothing of B's dropped
    expect(onDisk).toContain('INV-A-1');
    expect(onDisk).not.toContain('INV-DL-A');
  });

  // ===================== CONCURRENCY + ERRORS + EVENTS =====================

  test('interleaved concurrent requests keep their own tenant', async () => {
    const [a, b] = await Promise.all([
      get(appOn, '/api/v1/sales', tokenAOn),
      get(appOn, '/api/v1/sales', tokenBOn)
    ]);
    const idsA = a.body.data.invoices.map(i => i.id);
    const idsB = b.body.data.invoices.map(i => i.id);
    expect(idsA).not.toContain('INV-B-1');
    expect(idsB).not.toContain('INV-A-1');
  });

  test('async errors reach the error handler without crashing', async () => {
    const missing = await get(appOn, '/api/v1/sales/nonexistent', tokenAOn);
    expect(missing.statusCode).toBe(404);
    const bad = await post(appOn, '/api/v1/sales', { total: 10 }, tokenAOn);
    expect(bad.statusCode).toBe(400);
    const list = await get(appOn, '/api/v1/sales', tokenAOn);
    expect(list.statusCode).toBe(200);
  });

  test('sale.created event fires AFTER persistence, exactly once', async () => {
    const { eventBus } = require('../services/eventBus');
    const seen = [];
    const off = eventBus.subscribe('sale.created', (event) => seen.push(event));
    try {
      const res = await post(appOn, '/api/v1/sales', { id: 'INV-EV-1', items: [{ productId: 'p1', qty: 1, price: 7 }], total: 7 }, tokenAOn);
      expect(res.statusCode).toBe(201);
      expect(seen.length).toBe(1);
      expect(seen[0].type).toBe('sale.created');
      expect(seen[0].data.id).toBe('INV-EV-1'); // payload is the invoice entity itself
      // persist → publish: the invoice is already durable when the event fires
      const onDisk = readStore(dirOn, 'sales');
      expect(onDisk.invoices.some(i => i.id === 'INV-EV-1')).toBe(true);
    } finally {
      off();
    }
  });

  // ===================== ISOLATION OFF + FILTERING ON (LEGACY PATH) =====================

  describe('isolation OFF — legacy read-modify-write path hardening', () => {
    test('legacy-path create does NOT drop other tenants sales (raw-store write)', async () => {
      const before = readStore(dirOff, 'sales').invoices.map(i => i.id);
      const res = await post(appOff, '/api/v1/sales', { id: 'INV-LEG-A', items: [{ productId: 'p1', qty: 1, price: 9 }], total: 9 }, tokenAOff);
      expect(res.statusCode).toBe(201);
      const onDisk = readStore(dirOff, 'sales').invoices.map(i => i.id);
      for (const id of before) expect(onDisk).toContain(id); // B's + legacy survive
      expect(onDisk).toContain('INV-LEG-A');
      // stamping applied via writeAsync (metadata on)
      expect(readStore(dirOff, 'sales').invoices.find(i => i.id === 'INV-LEG-A').tenantId).toBe('corp-a');
    });

    test('legacy-path cross-tenant update blocked + data survives', async () => {
      const before = JSON.stringify(readStore(dirOff, 'sales'));
      const res = await put(appOff, '/api/v1/sales/INV-B-1', { customer: 'Hijack' }, tokenAOff);
      expect(res.statusCode).toBe(404);
      expect(JSON.stringify(readStore(dirOff, 'sales'))).toBe(before);
    });

    test('legacy-path cross-tenant delete blocked + data survives', async () => {
      const res = await del(appOff, '/api/v1/sales/INV-B-1', tokenAOff);
      expect(res.statusCode).toBe(404);
      const onDisk = readStore(dirOff, 'sales');
      expect(onDisk.invoices.some(i => i.id === 'INV-B-1')).toBe(true);
    });

    test('legacy-path reads stay tenant filtered (list)', async () => {
      const a = await get(appOff, '/api/v1/sales', tokenAOff);
      const b = await get(appOff, '/api/v1/sales', tokenBOff);
      const idsA = a.body.data.invoices.map(i => i.id);
      const idsB = b.body.data.invoices.map(i => i.id);
      expect(idsA).toContain('INV-A-1');
      expect(idsA).not.toContain('INV-B-1');
      expect(idsB).toContain('INV-B-1');
      expect(idsB).not.toContain('INV-A-1');
    });
  });
});
