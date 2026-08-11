'use strict';

// Phase 20 — Tenant-scoped authorization enforcement.
//
// Composes Phase 17 (tenantRole.resolveEffectiveRole) + Phase 19 (tenant carry /
// bound tenantId in JWT) into the EXISTING authorization middleware: the gates
// (requireRole / requirePermission / writeRoleGuard) now gate on the EFFECTIVE
// role for the request's tenant whenever ENABLE_TENANT_ROLES is on and a valid
// tenant context exists. Everything else behaves exactly as GoLive-1 (gate on
// req.user.role). No JWT / tenantCarry / login code is modified here.
//
//  1. Unit: gates respect the effective role — escalation, downgrade, unmapped
//     fallback, legacy global role, claim/context conflict, meta on req.user,
//     and full feature-OFF parity.
//  2. E2E: REAL production HTTP on an AUTH_REQUIRED=true server, exercising the
//     global writeRoleGuard('Owner','Admin','Manager') over the real
//     /api/v1/users route, plus the carried tenant enforcement.

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'digitronics', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true },
  { id: 'omni', name: 'Omni Components', active: true },
  { id: 'inactive1', name: 'Retired Co', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-mgr', username: 'managerUser', password, role: 'Manager', fullName: 'Manager User',
      tenantRoles: { digitronics: 'Admin', nile: 'Cashier' },
      tenantIds: ['digitronics', 'nile'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-owner', username: 'ownerUser', password, role: 'Owner', fullName: 'Owner User',
      tenantIds: ['digitronics', 'nile'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-cash', username: 'cashUser', password, role: 'Cashier', fullName: 'Cashier User',
      tenantIds: ['digitronics'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return require('../utils/jwt');
}

// ---------------------------------------------------------------------------
// 1. UNIT — authorize gates consume the tenant-effective role
// ---------------------------------------------------------------------------
describe('Phase 20 — authorize gates resolve the tenant-effective role (unit)', () => {
  let unitDir;

  beforeAll(() => {
    unitDir = makeTempDataDir('tz-authz');
    seed(unitDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.DIGITRONICS_DATA_DIR = unitDir;
  });

  afterAll(() => {
    try { fs.rmSync(unitDir, { recursive: true, force: true }); } catch (_) {}
  });

  function build(rolesOn) {
    jest.resetModules();
    process.env.DIGITRONICS_DATA_DIR = unitDir;
    if (rolesOn) process.env.ENABLE_TENANT_ROLES = 'true';
    else process.env.ENABLE_TENANT_ROLES = 'false';
    const { requireRole, writeRoleGuard } = require('../middleware/authorize');
    const app = express();
    app.use((req, res, next) => {
      req.user = req.headers['x-user'] ? JSON.parse(req.headers['x-user']) : null;
      if (req.headers['x-tenant']) req.tenantContext = { tenantId: req.headers['x-tenant'] };
      next();
    });
    app.post('/write', writeRoleGuard('Owner', 'Admin', 'Manager'), (req, res) => res.json({ ok: true, role: req.user.role, effective: req.user.effectiveRole }));
    app.post('/owner', requireRole('Owner', 'Admin'), (req, res) => res.json({ ok: true, role: req.user.role }));
    app.post('/meta', requireRole('Owner', 'Admin', 'Manager', 'Cashier'), (req, res) => res.json({
      role: req.user.role,
      effective: req.user.effectiveRole !== undefined ? req.user.effectiveRole : null
    }));
    return app;
  }

  const mgr = { role: 'Manager', username: 'managerUser', tenantId: 'digitronics' };
  const mgrNile = { role: 'Manager', username: 'managerUser', tenantId: 'nile' };
  const mgrOmni = { role: 'Manager', username: 'managerUser', tenantId: 'omni' };
  const owner = { role: 'Owner', username: 'ownerUser', tenantId: 'digitronics' };
  const untethered = { role: 'Manager', username: 'managerUser' };

  test('per-tenant Admin allows the tenant write (digitronics)', async () => {
    const res = await request(build(true)).post('/write').set('x-user', JSON.stringify(mgr)).set('x-tenant', 'digitronics');
    expect(res.statusCode).toBe(200);
  });

  test('per-tenant Cashier is denied the tenant write (nile)', async () => {
    const res = await request(build(true)).post('/write').set('x-user', JSON.stringify(mgrNile)).set('x-tenant', 'nile');
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('Insufficient role');
  });

  test('per-tenant Admin passes Owner/Admin-only routes', async () => {
    const res = await request(build(true)).post('/owner').set('x-user', JSON.stringify(mgr)).set('x-tenant', 'digitronics');
    expect(res.statusCode).toBe(200);
  });

  test('per-tenant Cashier is denied Owner/Admin-only routes', async () => {
    const res = await request(build(true)).post('/owner').set('x-user', JSON.stringify(mgrNile)).set('x-tenant', 'nile');
    expect(res.statusCode).toBe(403);
  });

  test('unmapped tenant falls back to the global role (no invented role)', async () => {
    const write = await request(build(true)).post('/write').set('x-user', JSON.stringify(mgrOmni)).set('x-tenant', 'omni');
    expect(write.statusCode).toBe(200); // global Manager is write-allowed
    const gate = await request(build(true)).post('/owner').set('x-user', JSON.stringify(mgrOmni)).set('x-tenant', 'omni');
    expect(gate.statusCode).toBe(403); // Manager is NOT Owner/Admin
  });

  test('legacy global role is preserved inside a tenant', async () => {
    const write = await request(build(true)).post('/write').set('x-user', JSON.stringify(owner)).set('x-tenant', 'digitronics');
    expect(write.statusCode).toBe(200);
    const gate = await request(build(true)).post('/owner').set('x-user', JSON.stringify(owner)).set('x-tenant', 'digitronics');
    expect(gate.statusCode).toBe(200);
  });

  test('claim/context mismatch never escalates to the tenant mapping', async () => {
    // Identity claims nile, context digitronics -> mismatch -> GLOBAL role only.
    const write = await request(build(true)).post('/write')
      .set('x-user', JSON.stringify({ role: 'Manager', username: 'managerUser', tenantId: 'nile' })).set('x-tenant', 'digitronics');
    expect(write.statusCode).toBe(200); // still Manager -> write-allowed
    const gate = await request(build(true)).post('/owner')
      .set('x-user', JSON.stringify({ role: 'Manager', username: 'managerUser', tenantId: 'nile' })).set('x-tenant', 'digitronics');
    expect(gate.statusCode).toBe(403); // NOT upgraded to the digitronics Admin mapping
  });

  test('no valid tenant context keeps the global behavior', async () => {
    const res = await request(build(true)).post('/write').set('x-user', JSON.stringify(untethered));
    expect(res.statusCode).toBe(200); // Manager allowed globally
  });

  test('meta: effective role is exposed on req.user', async () => {
    const res = await request(build(true)).post('/meta').set('x-user', JSON.stringify(mgr)).set('x-tenant', 'digitronics');
    expect(res.statusCode).toBe(200);
    expect(res.body.role).toBe('Manager');
    expect(res.body.effective).toBe('Admin');
  });

  test('meta: legacy user inside a tenant resolves to the global role', async () => {
    const res = await request(build(true)).post('/meta').set('x-user', JSON.stringify(owner)).set('x-tenant', 'digitronics');
    expect(res.statusCode).toBe(200);
    expect(res.body.effective).toBe('Owner');
  });

  test('feature OFF: gates are pure GoLive-1 (tenant mapping ignored)', async () => {
    const write = await request(build(false)).post('/write').set('x-user', JSON.stringify(mgrNile)).set('x-tenant', 'nile');
    expect(write.statusCode).toBe(200); // global Manager allowed despite nile Cashier mapping
    const gate = await request(build(false)).post('/owner').set('x-user', JSON.stringify(mgr)).set('x-tenant', 'digitronics');
    expect(gate.statusCode).toBe(403); // global Manager, NOT tenant Admin
  });
});

// ---------------------------------------------------------------------------
// 2. E2E — REAL HTTP on the hardened server
// ---------------------------------------------------------------------------
describe('Phase 20 — real authorization boundary (AUTH_REQUIRED=true + full flags)', () => {
  let app;
  let dir;
  let jwt;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_ROLES = 'true';
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    dir = makeTempDataDir('authz-e2e');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const s = await startServer(dir, { AUTH_REQUIRED: 'true' });
    app = s.app;
    jwt = jwtFor();
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  async function loginAs(username, company) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(company ? { username, password: 'Pass#123', company } : { username, password: 'Pass#123' });
    const data = res.body && res.body.data;
    return { status: res.statusCode, body: res.body, accessToken: data ? data.accessToken : undefined };
  }

  test('no token -> 401 on the protected boundary', async () => {
    const res = await request(app).get('/api/v1/users');
    expect(res.statusCode).toBe(401);
  });

  test('login binds the tenant and reports effective Admin (digitronics)', async () => {
    const r = await loginAs('managerUser', 'digitronics');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBe('digitronics');
    expect(r.body.data.effectiveRole).toBe('Admin');
  });

  test('login reports effective Cashier for nile', async () => {
    const r = await loginAs('managerUser', 'nile');
    expect(r.status).toBe(200);
    expect(r.body.data.effectiveRole).toBe('Cashier');
  });

  test('tenant Admin writes via the real /api/v1/users route', async () => {
    const r = await loginAs('managerUser', 'digitronics');
    const res = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${r.accessToken}`)
      .send({ username: 'created', password: 'Pass#123', role: 'Cashier' });
    expect(res.statusCode).toBe(201);
  });

  test('tenant Cashier is denied writes via the real route (nile)', async () => {
    const r = await loginAs('managerUser', 'nile');
    const res = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${r.accessToken}`)
      .send({ username: 'blocked-1', password: 'Pass#123', role: 'Cashier' });
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('Insufficient role');
  });

  test('the Cashier can still READ inside that tenant (write guard only)', async () => {
    const r = await loginAs('managerUser', 'nile');
    const res = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${r.accessToken}`);
    expect(res.statusCode).toBe(200);
  });

  test('global Owner is unchanged inside a tenant', async () => {
    const r = await loginAs('ownerUser', 'digitronics');
    expect(r.body.data.effectiveRole).toBe('Owner');
    const create = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${r.accessToken}`)
      .send({ username: 'created-2', password: 'Pass#123', role: 'Cashier' });
    expect(create.statusCode).toBe(201);
  });

  test('legacy login (no company) keeps the global role path', async () => {
    const r = await loginAs('managerUser');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
    const create = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${r.accessToken}`)
      .send({ username: 'created-3', password: 'Pass#123', role: 'Cashier' });
    expect(create.statusCode).toBe(201); // global Manager is write-allowed
  });

  test('client-supplied headers cannot move a user into another tenant', async () => {
    const r = await loginAs('managerUser', 'nile'); // Cashier in nile
    const res = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${r.accessToken}`)
      .set('X-Company-Id', 'digitronics')
      .send({ username: 'sneaky', password: 'Pass#123', role: 'Cashier' });
    expect(res.statusCode).toBe(403); // still resolved as nile -> Cashier
  });

  test('a forged but server-signed token still resolves the tenant record', async () => {
    // Token only claims identity + bound tenant; the GATE must derive the role
    // from the USER RECORD (nile -> Cashier), not from the token claims.
    const forged = jwt.signAccessToken({ id: 'u-mgr', username: 'managerUser', role: 'Manager', tenantId: 'nile' });
    const res = await request(app).post('/api/v1/users')
      .set('Authorization', `Bearer ${forged}`)
      .send({ username: 'forged-1', password: 'Pass#123', role: 'Cashier' });
    expect(res.statusCode).toBe(403);
  });
});

// Restore env so other suites are unaffected.
afterAll(() => {
  const mapping = {
    ENABLE_TENANT_ROLES: 'ROLES',
    ENABLE_TENANT_CARRY: 'CARRY',
    ENABLE_MULTI_COMPANY_LOGIN: 'MC',
    ENABLE_TENANT_USER_MEMBERSHIP: 'MEM',
    AUTH_REQUIRED: 'AUTH',
    DIGITRONICS_DATA_DIR: 'DATA'
  };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});