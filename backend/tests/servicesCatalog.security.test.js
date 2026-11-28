'use strict';

// Focused backend security tests for the Unified Services Catalog (M4).
// Covers authentication enforcement, role/permission-based filtering,
// master-service gating, internal-service exclusion, method hardening,
// and server-authoritative role resolution (no client spoofing).

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir } = require('./helpers/testData');
const { createUser, login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const PASSWORD = 'Pass#123';
const CATALOG_URL = '/api/v1/services/catalog';

let server;
let dir;

registerCleanup(() => [server], () => [dir]);

beforeAll(async () => {
  dir = makeTempDataDir('svc-catalog');
  server = await startServer(dir);
});

// Seed users once — shared across all describe blocks in this file.
beforeAll(() => {
  createUser(server.app, {
    username: 'owner', password: PASSWORD, fullName: 'Owner User', role: 'Owner'
  });
  createUser(server.app, {
    username: 'admin', password: PASSWORD, fullName: 'Admin User', role: 'Admin'
  });
  createUser(server.app, {
    username: 'cashier', password: PASSWORD, fullName: 'Cashier User', role: 'Cashier',
    extra: { permissions: ['createInvoices', 'viewCustomers'] }
  });
  createUser(server.app, {
    username: 'tech', password: PASSWORD, fullName: 'Tech User', role: 'Technician',
    extra: { permissions: ['viewMaintenance'] }
  });
});

async function loginToken(username) {
  const res = await request(server.app)
    .post('/api/v1/auth/login')
    .send({ username, password: PASSWORD });
  if (res.statusCode !== 200) {
    throw new Error(`login(${username}) failed: ${res.statusCode} ${JSON.stringify(res.body)}`);
  }
  return res.body.data.accessToken;
}

describe('GET /api/v1/services/catalog — authentication', () => {
  test('unauthenticated request returns 401', async () => {
    const res = await request(server.app).get(CATALOG_URL);
    expect(res.statusCode).toBe(401);
    expect(res.body.success).toBe(false);
  });

  test('invalid bearer token returns 401', async () => {
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', 'Bearer not-a-valid-token');
    expect(res.statusCode).toBe(401);
  });

  test('authenticated Owner receives 200 and a user context block', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user).toBeDefined();
    expect(res.body.data.user.username).toBe('owner');
    expect(res.body.data.services).toBeInstanceOf(Array);
    expect(res.body.data.total).toBeGreaterThan(0);
  });
});

describe('GET /api/v1/services/catalog — server-authoritative role resolution', () => {
  test('Owner sees tenant services and master services', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopes = services.map(s => s.scope);
    expect(scopes).toContain('tenant');
    expect(scopes).toContain('master');
    expect(scopes).not.toContain('internal');
    expect(res.body.data.user.role).toBe('Owner');
  });

  test('Admin sees tenant services and master services', async () => {
    const token = await loginToken('admin');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopes = services.map(s => s.scope);
    expect(scopes).toContain('tenant');
    expect(scopes).toContain('master');
    expect(scopes).not.toContain('internal');
    expect(res.body.data.user.role).toBe('Admin');
  });

  test('Cashier sees only services whose permission matches their baseline', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopes = services.map(s => s.scope);
    expect(scopes).not.toContain('master');
    expect(scopes).not.toContain('internal');
    const ids = services.map(s => s.id);
    // Cashier baseline includes 'dashboard.view' -> sees Dashboard.
    expect(ids).toContain('dashboard');
    // Legacy permission names in catalog metadata (createInvoices, viewCustomers)
    // are NOT in the permission registry, so those services are withheld.
    expect(ids).not.toContain('sales');
    expect(ids).not.toContain('customers');
    expect(ids).not.toContain('inventory');
  });

  test('Technician sees only services whose permission matches their baseline', async () => {
    const token = await loginToken('tech');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopes = services.map(s => s.scope);
    expect(scopes).not.toContain('master');
    expect(scopes).not.toContain('internal');
    const ids = services.map(s => s.id);
    // Technician baseline includes 'dashboard.view'.
    expect(ids).toContain('dashboard');
    // 'viewMaintenance' is not a known registry permission -> Repairs withheld.
    expect(ids).not.toContain('repairs');
    expect(ids).not.toContain('products');
  });

  test('Internal services are never exposed to any role', async () => {
    const internalIds = ['internal_go_live', 'internal_uat', 'internal_auth_center',
      'internal_tenant_center', 'internal_performance_center', 'internal_qa_center',
      'internal_command_center'];
    for (const username of ['owner', 'admin', 'cashier', 'tech']) {
      const token = await loginToken(username);
      const res = await request(server.app)
        .get(CATALOG_URL)
        .set('Authorization', `Bearer ${token}`);
      expect(res.statusCode).toBe(200);
      const ids = res.body.data.services.map(s => s.id);
      for (const id of internalIds) {
        expect(ids).not.toContain(id);
      }
    }
  });
});

describe('GET /api/v1/services/catalog — client cannot spoof role', () => {
  test('query param role is ignored (server-authoritative)', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL + '?role=Owner')
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const scopes = res.body.data.services.map(s => s.scope);
    expect(scopes).not.toContain('master');
    expect(res.body.data.user.role).toBe('Cashier');
  });

  test('x-role header is ignored', async () => {
    const token = await loginToken('cashier');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`)
      .set('x-role', 'Admin');
    expect(res.statusCode).toBe(200);
    const scopes = res.body.data.services.map(s => s.scope);
    expect(scopes).not.toContain('master');
  });
});

describe('GET /api/v1/services/catalog — service metadata integrity', () => {
  test('every returned service has required fields', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    for (const svc of res.body.data.services) {
      expect(svc.id).toBeTruthy();
      expect(svc.name).toBeTruthy();
      expect(svc.category).toBeTruthy();
      expect(svc.scope).toBeTruthy();
      expect(['tenant', 'master', 'internal']).toContain(svc.scope);
      expect(['READY', 'PARTIAL', 'BACKEND_ONLY', 'NOT_VERIFIED']).toContain(svc.status);
      // Master services may have destination: null (not yet verified). Only
      // assert destination when present.
      if (svc.destination) expect(typeof svc.destination).toBe('string');
      expect(svc.source).toBeTruthy();
    }
  });

  test('services are sorted by scope then category', async () => {
    const token = await loginToken('owner');
    const res = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    const services = res.body.data.services;
    const scopeOrder = { tenant: 0, master: 1, internal: 2 };
    for (let i = 1; i < services.length; i++) {
      const prevScope = scopeOrder[services[i - 1].scope] || 99;
      const currScope = scopeOrder[services[i].scope] || 99;
      expect(currScope).toBeGreaterThanOrEqual(prevScope);
      if (currScope === prevScope) {
        // String comparison: category should be >= previous category.
        expect(services[i].category >= services[i - 1].category).toBe(true);
      }
    }
  });
});

describe('Methods other than GET on /catalog return 405', () => {
  test.each([
    ['POST', 'post'],
    ['PUT', 'put'],
    ['PATCH', 'patch'],
    ['DELETE', 'delete']
  ])('%s returns 405', async (method, fn) => {
    const token = await loginToken('owner');
    const res = await request(server.app)[fn](CATALOG_URL)
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.statusCode).toBe(405);
    expect(res.body.success).toBe(false);
  });

  test('unauthenticated POST returns 405 (method check before auth on route)', async () => {
    const res = await request(server.app).post(CATALOG_URL).send({});
    expect(res.statusCode).toBe(405);
  });
});

describe('GET /api/v1/services/catalog — empty/edge cases', () => {
  test('catalog is deterministic across calls', async () => {
    const token = await loginToken('owner');
    const r1 = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    const r2 = await request(server.app)
      .get(CATALOG_URL)
      .set('Authorization', `Bearer ${token}`);
    expect(r1.statusCode).toBe(200);
    expect(r2.statusCode).toBe(200);
    expect(r1.body.data.total).toBe(r2.body.data.total);
    expect(r1.body.data.services.map(s => s.id)).toEqual(r2.body.data.services.map(s => s.id));
  });
});
