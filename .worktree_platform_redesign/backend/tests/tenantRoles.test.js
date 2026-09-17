'use strict';

// Phase 17 — Tenant-Scoped User Roles: E2E integration at the login boundary.
//
// Verifies the additive effective-role behavior: when ENABLE_TENANT_ROLES is on
// and a valid ACTIVE company resolves into req.tenantContext at login, the
// response includes an `effectiveRole` field derived from the user's
// tenantRoles map (per-tenant role when present, else the global role). No
// existing response field or behavior changes.
//
// Uses an isolated temp data dir + a 15-tenant active catalog, matching the
// strict data-isolation pattern of the Phase 15/16 suites.

const request = require('supertest');
const fs = require('fs');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES
};

// 15 active tenants + 1 inactive, to exercise the wide catalog case.
const companies = [
  { id: 'digitronics', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true },
  { id: 'omni', name: 'Omni Components', active: true },
  { id: 'astra', name: 'Astra Components', active: true },
  { id: 'bravo', name: 'Bravo Tech', active: true },
  { id: 'charlie', name: 'Charlie Systems', active: true },
  { id: 'delta', name: 'Delta Mobile', active: true },
  { id: 'echo', name: 'Echo Audio', active: true },
  { id: 'foxtrot', name: 'Foxtrot Labs', active: true },
  { id: 'golf', name: 'Golf Networks', active: true },
  { id: 'hotel', name: 'Hotel Cloud', active: true },
  { id: 'india', name: 'India Optics', active: true },
  { id: 'juliet', name: 'Juliet Robotics', active: true },
  { id: 'kilo', name: 'Kilo Semiconductors', active: true },
  { id: 'lima', name: 'Lima Power', active: true },
  { id: 'inactive1', name: 'Retired Co', active: false }
];

async function createViaApi(app, body) {
  return request(app).post('/api/v1/users').send(body);
}

async function loginWith(app, body) {
  const res = await request(app).post('/api/v1/auth/login').send(body);
  const data = res.body && res.body.data;
  return {
    status: res.statusCode,
    body: res.body,
    data,
    accessToken: data ? data.accessToken : undefined
  };
}

describe('Phase 17 tenant roles — ENABLE_TENANT_ROLES ON', () => {
  let appV2;
  let appLegacy;
  let appOff;
  let dirV2;
  let dirLegacy;
  let dirOff;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';

    // Enforced+scoped server in a 15-tenant catalog.
    const s1 = await startServer();
    appV2 = s1.app; dirV2 = s1.dataDir;
    seed(dirV2, 'companies', companies);
    // User A: global Admin, per-tenant Admin at digitronics, Manager at nile,
    // Cashier at omni, and NO mapping at bravo (falls back to global Admin).
    await createViaApi(appV2, { username: 'userA', password: 'Pass#123', role: 'Admin', tenantIds: ['digitronics','nile','omni','bravo'], tenantRoles: { digitronics: 'Admin', nile: 'Manager', omni: 'Cashier' } });
    // User B: global Manager, scoped Cashier at digitronics / Admin at nile.
    await createViaApi(appV2, { username: 'userB', password: 'Pass#123', role: 'Manager', tenantIds: ['digitronics','nile','omni'], tenantRoles: { digitronics: 'Cashier', nile: 'Admin' } });
    // Legacy user: member but NO tenantRoles at all.
    await createViaApi(appV2, { username: 'legacy', password: 'Pass#123', role: 'Cashier' });

    // A server with ENABLE_TENANT_USER_MEMBERSHIP ON but roles OFF, so we
    // can prove membership enforcement still works independently.
    process.env.ENABLE_TENANT_ROLES = 'false';
    const s2 = await startServer();
    appLegacy = s2.app; dirLegacy = s2.dataDir;
    seed(dirLegacy, 'companies', companies);
    await createViaApi(appLegacy, { username: 'memOnly', password: 'Pass#123', role: 'Manager', tenantIds: ['nile'] });
    process.env.ENABLE_TENANT_ROLES = 'true';

    // Roles flag OFF server.
    process.env.ENABLE_TENANT_ROLES = 'false';
    const s3 = await startServer();
    appOff = s3.app; dirOff = s3.dataDir;
    seed(dirOff, 'companies', companies);
    await createViaApi(appOff, { username: 'offUser', password: 'Pass#123', role: 'WarehouseSales', tenantRoles: { digitronics: 'Admin' } });
    process.env.ENABLE_TENANT_ROLES = 'true';
  });

  afterAll(async () => {
    try { fs.rmSync(dirV2, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(dirLegacy, { recursive: true, force: true }); } catch (_) {}
    try { fs.rmSync(dirOff, { recursive: true, force: true }); } catch (_) {}
  });

  it('userA at digitronics -> effectiveRole Admin (mapped, equals global)', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Admin');
    expect(r.data.user.role).toBe('Admin');
  });

  it('userA at nile -> effectiveRole Manager (downgrades from global Admin)', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Manager');
    expect(r.data.user.tenantRoles).toEqual({ digitronics: 'Admin', nile: 'Manager', omni: 'Cashier' });
  });

  it('userA at omni -> effectiveRole Cashier', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'omni' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Cashier');
  });

  it('userA at bravo (unmapped) -> falls back to global Admin', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'bravo' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Admin');
  });

  it('userB at digitronics -> effectiveRole Cashier (overrides global Manager)', async () => {
    const r = await loginWith(appV2, { username: 'userB', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Cashier');
  });

  it('userB at nile -> effectiveRole Admin (escalates from global Manager)', async () => {
    const r = await loginWith(appV2, { username: 'userB', password: 'Pass#123', company: 'nile' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Admin');
  });

  it('legacy member user (no tenantRoles) -> global role, no overrides present', async () => {
    const r = await loginWith(appV2, { username: 'legacy', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBe('Cashier');
    expect(r.data.user.tenantRoles).toBeUndefined();
  });

  it('unknown company -> legacy fallback, no effectiveRole field', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'ghost' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBeUndefined();
  });

  it('inactive company -> legacy fallback, no effectiveRole field', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'inactive1' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBeUndefined();
  });

  it('no company -> legacy behavior, no effectiveRole field', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBeUndefined();
  });

  it('unauthorized company (not a member) still denied (Phase 16 intact)', async () => {
    const r = await loginWith(appV2, { username: 'userA', password: 'Pass#123', company: 'hotel' });
    expect(r.status).toBe(403);
    expect(r.data).toBeUndefined();
  });

  it('roles flag independent of membership: member-only user m stays a member', async () => {
    const ok = await loginWith(appLegacy, { username: 'memOnly', password: 'Pass#123', company: 'nile' });
    expect(ok.status).toBe(200);
    expect(ok.data.effectiveRole).toBeUndefined();
    const denied = await loginWith(appLegacy, { username: 'memOnly', password: 'Pass#123', company: 'digitronics' });
    expect(denied.status).toBe(403);
  });
});

describe('Phase 17 tenant roles — flag OFF (legacy, no effectiveRole)', () => {
  let app;
  let dir;

  beforeAll(async () => {
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'false';
    const server = await startServer();
    app = server.app;
    dir = server.dataDir;
    seed(dir, 'companies', companies);
    await createViaApi(app, { username: 'offUser', password: 'Pass#123', role: 'WarehouseSales', tenantRoles: { digitronics: 'Admin' } });
  });

  afterAll(async () => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  it('returns NO effectiveRole field when the flag is off', async () => {
    const r = await loginWith(app, { username: 'offUser', password: 'Pass#123', company: 'digitronics' });
    expect(r.status).toBe(200);
    expect(r.data.effectiveRole).toBeUndefined();
    expect(r.data.user.role).toBe('WarehouseSales');
  });
});

// Restore the original env values so other suites in the same jest worker are
// not affected by the flags this file toggled.
afterAll(() => {
  for (const [envKey, origKey] of [
    ['ENABLE_MULTI_COMPANY_LOGIN', 'MC'],
    ['ENABLE_TENANT_USER_MEMBERSHIP', 'MEM'],
    ['ENABLE_TENANT_ROLES', 'ROLES']
  ]) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});