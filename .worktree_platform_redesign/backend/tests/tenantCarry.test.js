'use strict';

// Phase 19 — Tenant Carry / Persistent Tenant Binding.
//
// Verifies that the tenant selected at login is securely bound to the signed
// token and reconstructed as req.tenantContext on subsequent authenticated
// requests, WITHOUT introducing any authorization enforcement (Phase 18 stays
// unimplemented).
//
//  1. Unit: the optional `tenantId` claim in utils/jwt (backward compatible).
//  2. Middleware: real authMiddleware + tenantCarry wired into a mini app,
//     proving req.tenantContext reconstruction + tamper rejection.
//  3. E2E: full-server login flows (A/B/C, legacy, unknown/inactive/no company,
//     refresh preservation) and Phase 16 membership preservation.
//  4. Feature-OFF parity.

const fs = require('fs');
const express = require('express');
const request = require('supertest');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  ROLES: process.env.ENABLE_TENANT_ROLES
};

const companies = [
  { id: 'digitronics', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true },
  { id: 'omni', name: 'Omni Components', active: true },
  { id: 'inactive1', name: 'Retired Co', active: false }
];

function jwtFor() {
  jest.resetModules();
  process.env.JWT_SECRET = TEST_JWT_SECRET;
  return require('../utils/jwt');
}

// ---------------------------------------------------------------------------
// 1. UNIT — utils/jwt optional tenant claim
// ---------------------------------------------------------------------------
describe('Phase 19 — JWT optional tenantId claim (unit)', () => {
  test('signs tenantId claim when present', () => {
    const jwt = jwtFor();
    const token = jwt.signAccessToken({ id: 'u1', username: 'a', role: 'Admin', tenantId: 'digitronics' });
    const payload = jwt.verifyAccessToken(token);
    expect(payload).toBeTruthy();
    expect(payload.tenantId).toBe('digitronics');
    expect(payload.sub).toBe('u1');
  });

  test('omits tenantId claim when absent (backward compatible)', () => {
    const jwt = jwtFor();
    const payload = jwt.verifyAccessToken(jwt.signAccessToken({ id: 'u2', username: 'b', role: 'Cashier' }));
    expect(payload.tenantId).toBeUndefined();
  });

  test('omits tenantId claim when empty string', () => {
    const jwt = jwtFor();
    const payload = jwt.verifyAccessToken(jwt.signAccessToken({ id: 'u3', username: 'c', role: 'Admin', tenantId: '' }));
    expect(payload.tenantId).toBeUndefined();
  });

  test('existing verification accepts a token with no tenant', () => {
    const jwt = jwtFor();
    expect(jwt.verifyAccessToken(jwt.signAccessToken({ id: 'u4', username: 'd', role: 'Manager' })).sub).toBe('u4');
  });

  test('refresh token also carries the optional tenant claim', () => {
    const jwt = jwtFor();
    const payload = jwt.verifyRefreshToken(jwt.signRefreshToken({ id: 'u5', username: 'e', role: 'Admin', tenantId: 'nile' }));
    expect(payload).toBeTruthy();
    expect(payload.tenantId).toBe('nile');
  });
});

// ---------------------------------------------------------------------------
// 2. Middleware — authMiddleware + tenantCarry in a mini app
// ---------------------------------------------------------------------------
describe('Phase 19 — tenantCarry middleware (reconstruction + tamper)', () => {
  let miniDir;

  beforeAll(() => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_REQUEST_CONTEXT = 'true';
    miniDir = makeTempDataDir('carry');
    seed(miniDir, 'companies', companies);
    process.env.DIGITRONICS_DATA_DIR = miniDir;
  });

  afterAll(() => {
    try { fs.rmSync(miniDir, { recursive: true, force: true }); } catch (_) {}
  });

  function build(user) {
    jest.resetModules();
    process.env.JWT_SECRET = TEST_JWT_SECRET;
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.DIGITRONICS_DATA_DIR = miniDir;
    const { authMiddleware } = require('../middleware/auth');
    const tenantCarry = require('../middleware/tenantCarry');
    const jwt = require('../utils/jwt');
    const app = express();
    app.use(authMiddleware);
    app.use(tenantCarry);
    app.get('/echo', (req, res) => {
      res.status(200).json({ authed: !!req.user, tenantId: req.tenantContext ? req.tenantContext.tenantId : null });
    });
    return { app, token: jwt.signAccessToken(user) };
  }

  test('reconstructs req.tenantContext from bound tenant (digitronics)', async () => {
    const { app, token } = build({ id: 'u1', username: 'a', role: 'Admin', tenantId: 'digitronics' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.authed).toBe(true);
    expect(res.body.tenantId).toBe('digitronics');
  });

  test('reconstructs req.tenantContext for nile', async () => {
    const { app, token } = build({ id: 'u2', username: 'a', role: 'Admin', tenantId: 'nile' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenantId).toBe('nile');
  });

  test('legacy token without tenant -> no tenantContext', async () => {
    const { app, token } = build({ id: 'u3', username: 'a', role: 'Admin' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.authed).toBe(true);
    expect(res.body.tenantId).toBeNull();
  });

  test('bound to inactive company -> no tenantContext (no DEFAULT_TENANT substitution)', async () => {
    const { app, token } = build({ id: 'u4', username: 'a', role: 'Admin', tenantId: 'inactive1' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenantId).toBeNull();
  });

  test('bound to unknown company -> no tenantContext', async () => {
    const { app, token } = build({ id: 'u5', username: 'a', role: 'Admin', tenantId: 'ghost' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${token}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenantId).toBeNull();
  });

  test('tampered token payload cannot switch the tenant', async () => {
    // Sign a valid token for digitronics, then tamper the payload to claim
    // nile WITHOUT re-signing -> signature is invalid -> JWT verification fails.
    const jwt = require('../utils/jwt');
    const valid = jwt.signAccessToken({ id: 'u6', username: 'a', role: 'Admin', tenantId: 'digitronics' });
    const [head, , sig] = valid.split('.');
    const payload = Buffer.from(JSON.stringify({ sub: 'u6', username: 'a', role: 'Admin', tenantId: 'nile', jti: 'x' })).toString('base64url');
    const tampered = `${head}.${payload}.${sig}`;

    const { app } = build({ id: 'u6', username: 'a', role: 'Admin', tenantId: 'digitronics' });
    const res = await request(app).get('/echo').set('Authorization', `Bearer ${tampered}`);
    // Invalid signature -> req.user null -> not authenticated as any tenant.
    expect(res.body.authed).toBe(false);
    expect(res.body.tenantId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. E2E — full server (feature ON)
// ---------------------------------------------------------------------------
describe('Phase 19 — E2E HTTP with ENABLE_TENANT_CARRY ON', () => {
  let app;
  let dir;
  let jwt;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    const s = await startServer();
    app = s.app;
    dir = s.dataDir;
    seed(dir, 'companies', companies);
    jwt = jwtFor();

    await mkUser('a', { role: 'Admin', tenantIds: ['digitronics'], tenantRoles: { digitronics: 'Admin', nile: 'Manager', omni: 'Cashier' } });
    await mkUser('ab', { role: 'Admin', tenantIds: ['digitronics', 'nile'] });
    await mkUser('legacy', { role: 'Cashier' });
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  async function mkUser(username, extra) {
    const res = await request(app).post('/api/v1/users').send({ username, password: 'Pass#123', ...extra });
    if (res.statusCode !== 201) throw new Error(`createUser(${username}) failed ${res.statusCode}`);
    return res.body.data;
  }

  async function loginAs(username, company) {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send(company ? { username, password: 'Pass#123', company } : { username, password: 'Pass#123' });
    const data = res.body && res.body.data;
    return { status: res.statusCode, data, accessToken: data ? data.accessToken : undefined };
  }

  test('A + digitronics -> 200, token carries tenantId=digitronics', async () => {
    const r = await loginAs('a', 'digitronics');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBe('digitronics');
  });

  test('A + nile -> Phase 16 403 (membership preserved)', async () => {
    const r = await loginAs('a', 'nile');
    expect(r.status).toBe(403);
    expect(r.accessToken).toBeUndefined();
  });

  test('AB + digitronics -> 200, tenantId=digitronics', async () => {
    const r = await loginAs('ab', 'digitronics');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBe('digitronics');
  });

  test('AB + nile -> 200, tenantId=nile', async () => {
    const r = await loginAs('ab', 'nile');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBe('nile');
  });

  test('legacy + digitronics -> 200', async () => {
    const r = await loginAs('legacy', 'digitronics');
    expect(r.status).toBe(200);
    expect(r.accessToken).toBeTruthy();
  });

  test('unknown company -> legacy fallback, NO tenant binding', async () => {
    const r = await loginAs('legacy', 'ghost');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
  });

  test('inactive company -> legacy fallback, NO tenant binding', async () => {
    const r = await loginAs('legacy', 'inactive1');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
  });

  test('A + inactive company -> legacy fallback, NO tenant binding, NO 403', async () => {
    const r = await loginAs('a', 'inactive1');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
  });

  test('A + unknown company -> legacy fallback, NO tenant binding, NO 403', async () => {
    const r = await loginAs('a', 'ghost-co');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
  });

  test('no company -> legacy login, NO tenant binding', async () => {
    const r = await loginAs('legacy');
    expect(r.status).toBe(200);
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
  });

  test('existing JWT without tenantId remains valid (auth/me works)', async () => {
    // A real session with NO company -> token carries NO tenant claim, yet it
    // must still authenticate successfully against /auth/me.
    const r = await loginAs('legacy');
    expect(jwt.verifyAccessToken(r.accessToken).tenantId).toBeUndefined();
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${r.accessToken}`);
    expect(me.statusCode).toBe(200);
  });

  test('refresh preserves the carried tenant into the new access token', async () => {
    const r = await loginAs('ab', 'nile');
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: r.data.refreshToken });
    expect(refreshed.statusCode).toBe(200);
    expect(jwt.verifyAccessToken(refreshed.body.data.accessToken).tenantId).toBe('nile');
  });

  test('auth/roles and auth/permissions still work', async () => {
    const roles = await request(app).get('/api/v1/auth/roles');
    expect(roles.statusCode).toBe(200);
    expect(roles.body.success).toBe(true);
    const r = await loginAs('ab', 'digitronics');
    const perms = await request(app)
      .get('/api/v1/auth/permissions?username=ab')
      .set('Authorization', `Bearer ${r.accessToken}`);
    expect(perms.statusCode).toBe(200);
    expect(perms.body.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. E2E — feature OFF parity
// ---------------------------------------------------------------------------
describe('Phase 19 — ENABLE_TENANT_CARRY OFF (legacy, no carry)', () => {
  let app;
  let dir;
  let jwt;

  beforeAll(async () => {
    process.env.ENABLE_TENANT_CARRY = 'false';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    const s = await startServer();
    app = s.app;
    dir = s.dataDir;
    seed(dir, 'companies', companies);
    jwt = jwtFor();
    await request(app).post('/api/v1/users').send({ username: 'arr', password: 'Pass#123', role: 'Admin', tenantIds: ['digitronics'] });
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  test('login with valid company issues NO tenant claim when carry off', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'arr', password: 'Pass#123', company: 'digitronics' });
    expect(res.statusCode).toBe(200);
    expect(jwt.verifyAccessToken(res.body.data.accessToken).tenantId).toBeUndefined();
  });
});

// Restore env so other suites are unaffected.
afterAll(() => {
  for (const [envKey, origKey] of [
    ['ENABLE_TENANT_CARRY', 'CARRY'],
    ['ENABLE_MULTI_COMPANY_LOGIN', 'MC'],
    ['ENABLE_TENANT_USER_MEMBERSHIP', 'MEM'],
    ['ENABLE_TENANT_ROLES', 'ROLES']
  ]) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});