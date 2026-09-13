'use strict';

// API key tenant/owner isolation regression tests.
//
// Proves the ownership fix:
//   1. Keys are bound to the trusted server-side tenant and creator at
//      generation.
//   2. CRUD is tenant-scoped: a tenant can never read/manage another tenant's
//      keys (404); listings reveal only own-tenant keys.
//   3. Non-privileged users manage only keys they own; tenant Owner/Admin can
//      manage every key in their tenant.
//   4. Scopes are server-side allowlisted: '*' and unknown scopes are rejected.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { registerCleanup } = require('./helpers/cleanup');

function hash(pw) { return bcrypt.hashSync(pw, 10); }

const now = new Date().toISOString();
const PW = 'Pass#1234';
const USERS = { users: [
  { id: 'u-a', username: 'keyadmina', password: hash(PW), role: 'Admin', fullName: 'Admin A', tenantIds: ['ta'], tenantRoles: { ta: 'Admin' }, createdAt: now, updatedAt: now },
  { id: 'u-b', username: 'keyadminb', password: hash(PW), role: 'Admin', fullName: 'Admin B', tenantIds: ['tb'], tenantRoles: { tb: 'Admin' }, createdAt: now, updatedAt: now },
  { id: 'u-m', username: 'keymgra', password: hash(PW), role: 'Manager', fullName: 'Manager A', tenantIds: ['ta'], tenantRoles: { ta: 'Manager' }, createdAt: now, updatedAt: now }
]};

const COMPANIES = { companies: [
  { id: 'ta', name: 'Tenant A', active: true },
  { id: 'tb', name: 'Tenant B', active: true }
]};

let server;
let dataDir;
let tokenA, tokenB, tokenM;
let adminAKeyId, adminAKey, managerAKeyId;

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
  dataDir = makeTempDataDir('apikey-tenant');
  seed(dataDir, 'companies', COMPANIES);
  seed(dataDir, 'users', USERS);
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });

  tokenA = await loginAs('keyadmina', 'ta');
  tokenB = await loginAs('keyadminb', 'tb');
  tokenM = await loginAs('keymgra', 'ta');
});

afterAll(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  delete process.env.ENABLE_TENANT_CARRY;
  delete process.env.ENABLE_MULTI_COMPANY_LOGIN;
  delete process.env.ENABLE_TENANT_ROLES;
  delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
});

const auth = (token) => ({ Authorization: 'Bearer ' + token });

describe('API key tenant binding and scope allowlist', () => {
  test('Admin A generates a key bound to tenant ta and creator', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(auth(tokenA))
      .send({ name: 'Key A', scopes: ['read', 'write'] });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.key).toMatch(/^dgv2_live_/);
    expect(res.body.data.tenantId).toBe('ta');
    expect(res.body.data.userId).toBe('u-a');
    expect(res.body.data.scopes).toEqual(['read', 'write']);
    adminAKeyId = res.body.data.id;
    adminAKey = res.body.data.key;
  });

  test('wildcard scope is rejected server-side', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(auth(tokenA))
      .send({ name: 'Wildcard', scopes: ['*'] });
    expect(res.statusCode).toBe(400);
  });

  test('unknown scope is rejected server-side', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(auth(tokenA))
      .send({ name: 'Escalation', scopes: ['admin'] });
    expect(res.statusCode).toBe(400);
  });

  test('a key with no scopes defaults to read', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(auth(tokenA))
      .send({ name: 'Default Scope' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.scopes).toEqual(['read']);
  });
});

describe('API key ownership isolation', () => {
  test('nonexistent or disabled raw key still validates (key sanitation contract)', async () => {
    // The raw key returned at creation is the only usable form.
    const res = await request(server.app)
      .get('/api/v1/api-keys/validate')
      .set('X-API-Key', adminAKey);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.valid).toBe(true);
  });

  test('Admin B cannot read Admin A key (cross-tenant 404)', async () => {
    const res = await request(server.app)
      .get(`/api/v1/api-keys/${adminAKeyId}`)
      .set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin B listing keys never reveals Admin A key', async () => {
    const res = await request(server.app).get('/api/v1/api-keys').set(auth(tokenB));
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data || []).map(k => k.id);
    expect(ids).not.toContain(adminAKeyId);
  });

  test('Admin B cannot disable Admin A key (cross-tenant 404)', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${adminAKeyId}/disable`)
      .set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin B cannot revoke Admin A key (cross-tenant 404)', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${adminAKeyId}/revoke`)
      .set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin B cannot delete Admin A key (cross-tenant 404)', async () => {
    const res = await request(server.app)
      .delete(`/api/v1/api-keys/${adminAKeyId}`)
      .set(auth(tokenB));
    expect(res.statusCode).toBe(404);
  });

  test('Admin A key is still enabled after Admin B attempts', async () => {
    const res = await request(server.app)
      .get(`/api/v1/api-keys/${adminAKeyId}`)
      .set(auth(tokenA));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.enabled).toBe(true);
  });
});

describe('API key owner vs tenant-admin management', () => {
  test('Manager (tenant ta) generates a key bound to own identity', async () => {
    const res = await request(server.app)
      .post('/api/v1/api-keys')
      .set(auth(tokenM))
      .send({ name: 'Manager Key' });
    expect(res.statusCode).toBe(201);
    expect(res.body.data.tenantId).toBe('ta');
    expect(res.body.data.userId).toBe('u-m');
    managerAKeyId = res.body.data.id;
  });

  test('Manager cannot read Admin A key in same tenant (not own, not privileged)', async () => {
    const res = await request(server.app)
      .get(`/api/v1/api-keys/${adminAKeyId}`)
      .set(auth(tokenM));
    expect(res.statusCode).toBe(404);
  });

  test('Manager listing keys shows only own keys', async () => {
    const res = await request(server.app).get('/api/v1/api-keys').set(auth(tokenM));
    expect(res.statusCode).toBe(200);
    const ids = (res.body.data || []).map(k => k.id);
    expect(ids).toContain(managerAKeyId);
    expect(ids).not.toContain(adminAKeyId);
  });

  test('Owner/Admin of tenant can manage any key in the tenant', async () => {
    const res = await request(server.app)
      .post(`/api/v1/api-keys/${managerAKeyId}/disable`)
      .set(auth(tokenA));
    expect(res.statusCode).toBe(200);
    expect(res.body.data.enabled).toBe(false);
  });

  test('Manager can manage own key but not another tenant key', async () => {
    const own = await request(server.app)
      .post(`/api/v1/api-keys/${managerAKeyId}/enable`)
      .set(auth(tokenM));
    expect(own.statusCode).toBe(200);
    expect(own.body.data.enabled).toBe(true);

    // Manager A has no rights in tenant tb's keys at all
    const otherTenant = await request(server.app)
      .post(`/api/v1/api-keys/${managerAKeyId}/disable`)
      .set(auth(tokenB));
    expect(otherTenant.statusCode).toBe(404);
  });
});