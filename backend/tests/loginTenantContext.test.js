'use strict';

// loginTenantContext.test.js — EDUCATION_COMPLETION P1 proof: a NORMAL login
// on SHIPPED (default) settings establishes a server-authoritative tenant that
// the Education APIs accept.
//
// These tests run the REAL path end to end: POST /api/v1/auth/login ->
// companyContext -> loginTenant resolution -> signed JWT (server secret) ->
// tenantCarry rebuild of req.tenantContext on the next request ->
// trustedTenantId(req) inside the Education controllers. Nothing here mints a
// token by hand to prove tenant context: every assertion is made with a token
// the login endpoint actually issued. Nothing reads or writes backend/data
// (temporary stores only), and the default-config block runs with NO
// test-only feature flags set at all.
//
// 1. single-tenant user  -> login (no company selection) -> claim -> Education GET 200
// 2. single-tenant user  -> create + read inside its own tenant (server stamp)
// 3. multi-tenant user   -> selection required and honored per selected company
// 4. tampering           -> client company/tenantId/headers/forged JWT never widen
// 5. cross-tenant        -> foreign rows are 404 / never listed
// 6. Master/platform     -> platform identity is NOT mixed into a tenant
// 7. default config      -> works with no test-only flags, exactly as shipped

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const MANAGED_ENV_KEYS = [
  'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP',
  'ENABLE_TENANT_ROLES', 'ENABLE_TENANT_FILTERING', 'ENABLE_TENANT_ENTITY_ISOLATION',
  'ENABLE_TENANT_RESOLUTION', 'ENABLE_TENANT_METADATA', 'ENABLE_TENANT_SALES_ISOLATION',
  'ENABLE_TENANT_PURCHASES_ISOLATION', 'PLATFORM_ADMINS', 'AUTH_REQUIRED'
];
const ORIGINAL_ENV = {};
for (const key of MANAGED_ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];

function clearTenantEnv() {
  for (const key of MANAGED_ENV_KEYS) delete process.env[key];
}

const STAMP = '2026-01-01T00:00:00.000Z';
const BASE = '/api/v1/tenant/education';
const HASH = bcrypt.hashSync('Pass#123', 10);

const companies = [
  { id: 'co-a', name: 'Alpha Education', code: 'COA', active: true },
  { id: 'co-b', name: 'Beta Education', code: 'COB', active: true },
  { id: 'co-c', name: 'Gamma Dormant', code: 'COC', active: false }
];

function seedWorld(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', {
    users: [
      // Single-tenant accounts (Solution A): membership resolves the tenant.
      { id: 'u-solo', username: 'solo', password: HASH, role: 'Owner', fullName: 'Solo Owner', tenantIds: ['co-a'], createdAt: STAMP, updatedAt: STAMP },
      { id: 'u-solob', username: 'soloB', password: HASH, role: 'Owner', fullName: 'Solo B Owner', tenantIds: ['co-b'], createdAt: STAMP, updatedAt: STAMP },
      // Multi-tenant account (Solution B): must select explicitly.
      { id: 'u-multi', username: 'multi', password: HASH, role: 'Owner', fullName: 'Multi Owner', tenantIds: ['co-a', 'co-b'], createdAt: STAMP, updatedAt: STAMP },
      // Legacy account with NO membership: in a multi-company catalog nothing
      // may be invented for it. Owner role so the request reaches the
      // controller and the refusal is exactly the tenant check (400), not an
      // earlier permission gate.
      { id: 'u-legacy', username: 'legacy', password: HASH, role: 'Owner', fullName: 'Legacy Owner', createdAt: STAMP, updatedAt: STAMP },
      // Platform/Master identity: holds a membership, yet platform scope must
      // never be folded into a tenant identity ('master' is the dev/test
      // bootstrap platform owner seeded by platformAdmin.ensureSeeded()).
      { id: 'u-master', username: 'master', password: HASH, role: 'Owner', fullName: 'Platform Owner', tenantIds: ['co-a'], createdAt: STAMP, updatedAt: STAMP }
    ]
  });
  seed(dir, 'educationCenters', { centers: [] });
  seed(dir, 'educationStudents', { students: [] });
}

const claim = (app, body) =>
  request(app).post('/api/v1/auth/login').send(body);

async function login(app, username, extra) {
  const res = await claim(app, Object.assign({ username, password: 'Pass#123' }, extra));
  expect(res.statusCode).toBe(200);
  const token = res.body.data.accessToken;
  const decoded = require('../utils/jwt').verifyAccessToken(token);
  return { token, decoded, res };
}

const get = (app, path, token) =>
  request(app).get(path).set('Authorization', `Bearer ${token}`);

const post = (app, path, token, body) =>
  request(app).post(path).set('Authorization', `Bearer ${token}`).send(body || {});

const edu = (app, path, token) => get(app, BASE + path, token);

afterAll(() => {
  for (const key of MANAGED_ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

// ---------------------------------------------------------------------------
// 1 / 2 / 5 / 6 / 7 — DEFAULT CONFIGURATION (no test-only flags)
// ---------------------------------------------------------------------------
describe('P1 default configuration — normal login establishes the tenant', () => {
  let app;
  let dir;

  beforeEach(() => {
    clearTenantEnv();
    dir = makeTempDataDir('p1-default');
    seedWorld(dir);
    // AUTH_REQUIRED only hardens the mount; it is NOT a tenant flag and the
    // login route is mounted before the auth gate (server.js:335 vs :412).
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    clearTenantEnv();
  });

  test('1. single-tenant login without any company input yields the trusted tenant', async () => {
    const config = require('../config');
    expect(config.tenantCarryEnabled).toBe(true);
    expect(process.env.ENABLE_TENANT_CARRY).toBeUndefined();

    const { token, decoded } = await login(app, 'solo');
    expect(decoded.tenantId).toBe('co-a');

    const res = await edu(app, '/centers', token);
    expect(res.statusCode).toBe(200);
  });

  test('2. single-tenant login creates and reads its own tenant data', async () => {
    const { token, decoded } = await login(app, 'solo');
    expect(decoded.tenantId).toBe('co-a');

    const created = await post(app, `${BASE}/centers`, token, { name: 'Solo Center', centerCode: 'SC1' });
    expect(created.statusCode).toBe(201);
    // Server-owned: the stamp comes from the signed claim, never the body.
    expect(created.body.data.tenantId).toBe('co-a');

    const list = await edu(app, '/centers', token);
    expect(list.statusCode).toBe(200);
    expect(list.body.data.map(c => c.id)).toEqual([created.body.data.id]);

    const students = await edu(app, '/students', token);
    expect(students.statusCode).toBe(200);
  });

  test('5. cross-tenant access is denied after login', async () => {
    const a = await login(app, 'solo');
    const b = await login(app, 'soloB');
    expect(a.decoded.tenantId).toBe('co-a');
    expect(b.decoded.tenantId).toBe('co-b');

    const created = await post(app, `${BASE}/centers`, a.token, { name: 'Alpha Only', centerCode: 'CA1' });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;

    // Tenant B neither lists nor reads tenant A's row (no existence oracle).
    const foreignList = await edu(app, '/centers', b.token);
    expect(foreignList.statusCode).toBe(200);
    expect(foreignList.body.data).toEqual([]);
    const foreignGet = await edu(app, `/centers/${id}`, b.token);
    expect(foreignGet.statusCode).toBe(404);

    // Writes are stamped with the CALLER's trusted tenant, not a foreign one.
    const foreignCreate = await post(app, `${BASE}/centers`, b.token, { name: 'Beta Center', centerCode: 'CB1' });
    expect(foreignCreate.statusCode).toBe(201);
    expect(foreignCreate.body.data.tenantId).toBe('co-b');
  });

  test('6. Master/platform identity is unchanged and never mixed into a tenant', async () => {
    const { token, decoded } = await login(app, 'master');
    // Holds tenantIds ['co-a'], yet platform scope must not become a tenant.
    expect(decoded.tenantId).toBeUndefined();

    const platform = await get(app, '/api/v1/platform/summary', token);
    expect(platform.statusCode).toBe(200);

    // An ordinary tenant account is still refused platform scope.
    const tenant = await login(app, 'solo');
    const denied = await get(app, '/api/v1/platform/summary', tenant.token);
    expect(denied.statusCode).toBe(403);
  });

  test('7. shipped defaults work with no test-only flags at all', async () => {
    const config = require('../config');
    expect(process.env.ENABLE_TENANT_CARRY).toBeUndefined();
    expect(process.env.ENABLE_MULTI_COMPANY_LOGIN).toBeUndefined();
    expect(process.env.ENABLE_TENANT_USER_MEMBERSHIP).toBeUndefined();
    expect(config.tenantCarryEnabled).toBe(true);
    expect(config.multiCompanyLoginEnabled).toBe(false);
    expect(config.tenantUserMembershipEnabled).toBe(false);

    // login -> Education fetch journey, exactly as a real operator would run it.
    const { token, decoded } = await login(app, 'solo');
    expect(decoded.tenantId).toBe('co-a');
    expect((await edu(app, '/centers', token)).statusCode).toBe(200);
    expect((await edu(app, '/students', token)).statusCode).toBe(200);
    expect((await edu(app, '/pack', token)).statusCode).toBe(200);
    // and the platform surface is still closed to it.
    expect((await get(app, '/api/v1/platform/summary', token)).statusCode).toBe(403);
  });

  test('4a. client-supplied tenant/company input cannot widen access (default config)', async () => {
    // A forged `company` field on login: the selector is disabled, so nothing
    // is honored and nothing is substituted -> no tenant at all.
    const tampered = await login(app, 'solo', { company: 'co-b' });
    expect(tampered.decoded.tenantId).toBeUndefined();
    expect((await edu(app, '/centers', tampered.token)).statusCode).toBe(400);

    // A tenant-less (legacy/unbound) account in a multi-company catalog gets
    // NO tenant invented for it either.
    const legacy = await login(app, 'legacy');
    expect(legacy.decoded.tenantId).toBeUndefined();
    expect((await edu(app, '/centers', legacy.token)).statusCode).toBe(400);

    // Server-owned field in the write body is refused, not honored.
    const b = await login(app, 'soloB');
    const write = await post(app, `${BASE}/centers`, b.token, { name: 'Rogue', tenantId: 'co-a' });
    expect(write.statusCode).toBe(400);
    expect(String(write.body.message)).toMatch(/not writable/i);

    // Tenant headers are ignored: tenant B still sees only tenant B.
    const a = await login(app, 'solo');
    await post(app, `${BASE}/centers`, a.token, { name: 'Alpha Row', centerCode: 'CR1' });
    const spoofed = await request(app)
      .get(`${BASE}/centers`)
      .set('Authorization', `Bearer ${b.token}`)
      .set('X-Tenant-Id', 'co-a')
      .set('X-Company-Id', 'co-a')
      .set('X-Active-Tenant-Id', 'co-a');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toEqual([]);

    // A JWT signed with anything but the server secret is rejected outright.
    const jsonwebtoken = require('jsonwebtoken');
    const forged = jsonwebtoken.sign(
      { sub: 'u-solo', username: 'solo', role: 'Owner', tenantId: 'co-b' },
      'not-the-server-secret',
      { algorithm: 'HS256' }
    );
    expect((await get(app, `${BASE}/centers`, forged)).statusCode).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 3 / 4b — COMPANY SELECTION + MEMBERSHIP (documented optional flags)
// ---------------------------------------------------------------------------
describe('P1 multi-tenant login — explicit company selection', () => {
  let app;
  let dir;

  beforeEach(() => {
    clearTenantEnv();
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    dir = makeTempDataDir('p1-select');
    seedWorld(dir);
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    clearTenantEnv();
  });

  test('3. multi-tenant user must select, and each selection binds exactly that tenant', async () => {
    // No selection -> no claim (never a default/random tenant) and the
    // Education API refuses instead of guessing.
    const none = await login(app, 'multi');
    expect(none.decoded.tenantId).toBeUndefined();
    expect((await edu(app, '/centers', none.token)).statusCode).toBe(400);

    const a = await login(app, 'multi', { company: 'co-a' });
    expect(a.decoded.tenantId).toBe('co-a');
    const rowA = await post(app, `${BASE}/centers`, a.token, { name: 'A Center', centerCode: 'MA' });
    expect(rowA.statusCode).toBe(201);
    expect(rowA.body.data.tenantId).toBe('co-a');

    const b = await login(app, 'multi', { company: 'co-b' });
    expect(b.decoded.tenantId).toBe('co-b');
    const listB = await edu(app, '/centers', b.token);
    expect(listB.statusCode).toBe(200);
    expect(listB.body.data).toEqual([]);

    // An unknown company is refused as a selection and never substituted.
    const ghost = await login(app, 'multi', { company: 'ghost' });
    expect(ghost.decoded.tenantId).toBeUndefined();
    expect((await edu(app, '/centers', ghost.token)).statusCode).toBe(400);

    // Refresh keeps the server-bound tenant.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: a.res.body.data.refreshToken });
    expect(refresh.statusCode).toBe(200);
    const renewed = require('../utils/jwt').verifyAccessToken(refresh.body.data.accessToken);
    expect(renewed.tenantId).toBe('co-a');
  });

  test('4b. selecting a company the user is not a member of is denied', async () => {
    // Positive control first: a member selecting their own company works.
    const ok = await login(app, 'solo', { company: 'co-a' });
    expect(ok.decoded.tenantId).toBe('co-a');

    // The same user selecting a foreign company is refused BEFORE any token.
    const denied = await claim(app, { username: 'solo', password: 'Pass#123', company: 'co-b' });
    expect(denied.statusCode).toBe(403);
    expect(String(denied.body.message)).toMatch(/not a member/i);

    // And a non-member can never reach the foreign tenant through Education.
    expect(denied.body.data).toBeUndefined();

    // An inactive company is not a valid selection either (legacy fallback,
    // no claim, no widening).
    const inactive = await login(app, 'solo', { company: 'co-c' });
    expect(inactive.decoded.tenantId).toBeUndefined();
  });

  test('6b. platform identity may still select a tenant explicitly', async () => {
    const selected = await login(app, 'master', { company: 'co-a' });
    expect(selected.decoded.tenantId).toBe('co-a');
    expect((await edu(app, '/centers', selected.token)).statusCode).toBe(200);

    // Without a selection it stays a platform identity, not a tenant.
    const bare = await login(app, 'master');
    expect(bare.decoded.tenantId).toBeUndefined();
    expect((await get(app, '/api/v1/platform/summary', bare.token)).statusCode).toBe(200);
  });
});
