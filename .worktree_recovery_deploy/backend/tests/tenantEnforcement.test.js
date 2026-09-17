'use strict';

// Phase 16 — Tenant User Membership Enforcement at login.
//
// Verifies the smallest enforcement point: login is rejected BEFORE any token
// is generated when a member user selects a valid ACTIVE company they do not
// belong to. Enforced only while ENABLE_TENANT_USER_MEMBERSHIP is true.
//
// Legacy compatibility is preserved: users with NO membership (or tenantIds: [])
// are never denied, and missing/unknown/inactive company selections keep the
// GoLive-1 fallback behavior.
//
// Each server instance controls its own flags and uses an isolated temp data
// dir, so the suite behaves correctly under both `npm test` (flag OFF) and
// flag ON, and never touches real production data.

const request = require('supertest');
const fs = require('fs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

// Snapshot original env so the file can restore it once, at the end, to avoid
// leaking flags into other suites that may run in the same jest worker.
const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP
};

async function createViaApi(app, body) {
  return request(app).post('/api/v1/users').send(body);
}

async function loginWith(app, body) {
  const res = await request(app).post('/api/v1/auth/login').send(body);
  const data = res.body && res.body.data;
  return {
    status: res.statusCode,
    body: res.body,
    accessToken: data ? data.accessToken : undefined,
    refreshToken: data ? data.refreshToken : undefined
  };
}

function assertDenied(r) {
  expect(r.status).toBe(403);
  expect(r.accessToken).toBeUndefined();
  expect(r.refreshToken).toBeUndefined();
}

const companies = [
  { id: 'digitronics', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true },
  { id: 'omni', name: 'Omni Components', active: true },
  { id: 'astra', name: 'Astra Components', active: false }
];

describe('Phase 16 enforcement — ENABLE_TENANT_USER_MEMBERSHIP ON', () => {
  let app;
  let dir;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    const server = await startServer();
    app = server.app;
    dir = server.dataDir;
    seed(dir, 'companies', companies);

    await createViaApi(app, { username: 'uA', password: 'Pass#123', role: 'Manager', tenantIds: ['digitronics'] });
    await createViaApi(app, { username: 'uAB', password: 'Pass#123', role: 'Manager', tenantIds: ['digitronics', 'nile', 'nile'] });
    await createViaApi(app, { username: 'uEmpty', password: 'Pass#123', role: 'Manager', tenantIds: [] });
    await createViaApi(app, { username: 'legacy', password: 'Pass#123', role: 'Cashier' });
  });

  afterAll(async () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it('member user (A) + allowed company -> 200/token', async () => {
    const r = await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('member user (A) + unauthorized active company (nile) -> no token', async () => {
    assertDenied(await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'nile' }));
  });

  it('member user (A) + unauthorized active company (omni) -> no token', async () => {
    assertDenied(await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'omni' }));
  });

  it('member user (AB) + A -> 200', async () => {
    const r = await loginWith(app, { username: 'uAB', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('member user (AB) + B -> 200', async () => {
    const r = await loginWith(app, { username: 'uAB', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('member user (AB) + unauthorized omni -> no token', async () => {
    assertDenied(await loginWith(app, { username: 'uAB', password: 'Pass#123', company: 'omni' }));
  });

  it('member user (A) + unknown company -> legacy fallback preserved', async () => {
    const r = await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'ghost' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('member user (A) + inactive company -> legacy fallback preserved', async () => {
    const r = await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'astra' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('member user (A) + no company -> legacy behavior preserved', async () => {
    const r = await loginWith(app, { username: 'uA', password: 'Pass#123' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('empty-membership user (tenantIds:[]) is NOT denied', async () => {
    const r = await loginWith(app, { username: 'uEmpty', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('legacy user (no tenantIds) + valid company -> 200', async () => {
    const r = await loginWith(app, { username: 'legacy', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('legacy user + nile -> 200', async () => {
    const r = await loginWith(app, { username: 'legacy', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('legacy user + omni -> 200', async () => {
    const r = await loginWith(app, { username: 'legacy', password: 'Pass#123', company: 'omni' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('legacy user + inactive company -> 200', async () => {
    const r = await loginWith(app, { username: 'legacy', password: 'Pass#123', company: 'astra' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('legacy user + no company -> 200', async () => {
    const r = await loginWith(app, { username: 'legacy', password: 'Pass#123' });
    expect(r.status).toBe(200); expect(r.accessToken).toBeTruthy();
  });

  it('denied login issues neither accessToken nor refreshToken (generic 403)', async () => {
    const r = await loginWith(app, { username: 'uA', password: 'Pass#123', company: 'nile' });
    assertDenied(r);
    expect(r.body.success).toBe(false);
    expect(r.body.statusCode).toBe(403);
    expect(r.body.details).toBeNull();
  });

  it('auth/me remains unchanged after a successful login', async () => {
    const ok = await loginWith(app, { username: 'uAB', password: 'Pass#123', company: 'nile' });
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer ' + ok.accessToken);
    expect(me.statusCode).toBe(200);
    const u = me.body.data.user || me.body.data;
    expect(u.username).toBe('uAB');
    expect(u.role).toBe('Manager');
    expect(u.tenantIds).toEqual(['digitronics', 'nile']);
  });

  it('roles endpoint remains unchanged', async () => {
    const r = await request(app).get('/api/v1/auth/roles');
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
  });

  it('permissions endpoint remains unchanged', async () => {
    const ok = await loginWith(app, { username: 'uAB', password: 'Pass#123', company: 'nile' });
    const r = await request(app)
      .get('/api/v1/auth/permissions?username=uAB')
      .set('Authorization', 'Bearer ' + ok.accessToken);
    expect(r.statusCode).toBe(200);
    expect(r.body.success).toBe(true);
    expect(r.body.data.permissions).toEqual([]);
  });
});

describe('Phase 16 enforcement — flag OFF (legacy, no enforcement)', () => {
  let app;
  let dir;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'false';
    const server = await startServer();
    app = server.app;
    dir = server.dataDir;
    seed(dir, 'companies', companies);
    await createViaApi(app, { username: 'fA', password: 'Pass#123', role: 'Manager', tenantIds: ['digitronics'] });
  });

  afterAll(async () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it('feature OFF: member user + unauthorized company is ALLOWED (legacy)', async () => {
    const r = await loginWith(app, { username: 'fA', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200);
    expect(r.accessToken).toBeTruthy();
  });

  it('feature OFF: member user + allowed company is allowed', async () => {
    const r = await loginWith(app, { username: 'fA', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200);
    expect(r.accessToken).toBeTruthy();
  });
});

// Restore the original env values so other suites in the same jest worker are
// not affected by the flags this file toggled for its own instances.
afterAll(() => {
  if (ORIGINAL_ENV.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN;
  else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_ENV.MC;
  if (ORIGINAL_ENV.MEM === undefined) delete process.env.ENABLE_TENANT_USER_MEMBERSHIP;
  else process.env.ENABLE_TENANT_USER_MEMBERSHIP = ORIGINAL_ENV.MEM;
});