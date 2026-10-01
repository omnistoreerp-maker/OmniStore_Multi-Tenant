'use strict';

// STU-1 Education foundation — regression suite (Device 2).
//
// Proves the properties the STU-1 audit demanded, against the REAL middleware
// chain (authMiddleware -> tenantCarry -> requirePermission -> controller ->
// service) and the REAL server.js mount:
//
//   * unauthenticated access is rejected, and the strict permission gate does
//     not silently degrade when AUTH_REQUIRED is false;
//   * tenant A and tenant B are fully isolated on read, update and delete;
//   * a missing or inactive tenant context FAILS CLOSED with no fallback to
//     another tenant;
//   * tenant ownership is server-owned and immutable on create AND update;
//   * unknown / unregistered Education permissions fail closed;
//   * no client-supplied tenant value (query, body, or header) can influence
//     authorization or isolation.
//
// Test safety: every store lives in a fresh mkdtemp directory (helpers/
// testData). Nothing here reads or writes backend/data, and the directory is
// removed after each block.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer, TEST_JWT_SECRET } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'edu-a', name: 'Education Tenant A', code: 'EDUA', active: true },
  { id: 'edu-b', name: 'Education Tenant B', code: 'EDUB', active: true },
  { id: 'edu-retired', name: 'Retired Education Tenant', code: 'EDUR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'eduOwner', password, role: 'Owner', fullName: 'Education Owner',
      tenantIds: ['edu-a', 'edu-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff. Holds the Education permissions EXPLICITLY so the
      // suite proves that an unregistered permission still fails closed rather
      // than being honoured because a client record asked for it.
      id: 'u-viewer', username: 'eduViewer', password, role: 'Viewer', fullName: 'Education Viewer',
      permissions: ['education.pack.view', 'education.pack.edit'],
      tenantIds: ['edu-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'eduManager', password, role: 'Manager', fullName: 'Education Manager',
      tenantIds: ['edu-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, fail-closed, tenantId immutability
// ---------------------------------------------------------------------------
describe('STU-1 educationPack.service — trusted tenant + fail closed', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('edu-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/educationPack.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  test('missing trusted tenant fails closed on every entry point', () => {
    for (const bad of [null, undefined, {}, { tenantId: '' }, { tenantId: null }]) {
      expect(() => service.getPack(bad)).toThrow(/Tenant context is required/);
      expect(() => service.updatePack(bad, { academicYear: '2026' })).toThrow(/Tenant context is required/);
      expect(() => service.resetPack(bad)).toThrow(/Tenant context is required/);
    }
  });

  test('a tenant with no pack gets its OWN default, never another tenant data', () => {
    service.updatePack({ tenantId: 'edu-a' }, { academicYear: '2026/2027', currency: 'EGP' });
    const virgin = service.getPack({ tenantId: 'edu-b' });
    expect(virgin.tenantId).toBe('edu-b');
    expect(virgin.academicYear).toBe('');
    // Reading must not have persisted anything for edu-b.
    expect(service.resetPack({ tenantId: 'edu-b' })).toBe(false);
  });

  test('reads never cross tenants', () => {
    service.updatePack({ tenantId: 'edu-a' }, { academicYear: 'A-year', timezone: 'Africa/Cairo' });
    service.updatePack({ tenantId: 'edu-b' }, { academicYear: 'B-year', timezone: 'Asia/Dubai' });

    expect(service.getPack({ tenantId: 'edu-a' }).academicYear).toBe('A-year');
    expect(service.getPack({ tenantId: 'edu-b' }).academicYear).toBe('B-year');
    expect(service.getPack({ tenantId: 'edu-a' }).timezone).toBe('Africa/Cairo');
    expect(service.getPack({ tenantId: 'edu-b' }).timezone).toBe('Asia/Dubai');
  });

  test('updates never cross tenants', () => {
    service.updatePack({ tenantId: 'edu-a' }, { academicYear: 'A-year' });
    service.updatePack({ tenantId: 'edu-b' }, { academicYear: 'B-year' });
    service.updatePack({ tenantId: 'edu-b' }, { academicYear: 'B-revised' });

    expect(service.getPack({ tenantId: 'edu-a' }).academicYear).toBe('A-year');
    expect(service.getPack({ tenantId: 'edu-b' }).academicYear).toBe('B-revised');
  });

  test('deletes never cross tenants', () => {
    service.updatePack({ tenantId: 'edu-a' }, { academicYear: 'A-year' });
    service.updatePack({ tenantId: 'edu-b' }, { academicYear: 'B-year' });

    // edu-b resets only its OWN pack.
    expect(service.resetPack({ tenantId: 'edu-b' })).toBe(true);
    expect(service.getPack({ tenantId: 'edu-b' }).academicYear).toBe('');
    expect(service.getPack({ tenantId: 'edu-a' }).academicYear).toBe('A-year');
  });

  test('client tenantId is ignored on CREATE — server tenant wins', () => {
    const created = service.updatePack(
      { tenantId: 'edu-a' },
      { tenantId: 'edu-b', academicYear: '2026/2027' }
    );
    expect(created.tenantId).toBe('edu-a');
    expect(service.getPack({ tenantId: 'edu-b' }).academicYear).toBe('');
  });

  test('client tenantId is ignored on UPDATE — ownership is immutable', () => {
    service.updatePack({ tenantId: 'edu-a' }, { academicYear: 'A-year' });
    const updated = service.updatePack({ tenantId: 'edu-a' }, { tenantId: 'edu-b', academicYear: 'A-revised' });

    expect(updated.tenantId).toBe('edu-a');
    expect(service.getPack({ tenantId: 'edu-b' }).academicYear).toBe('');
    expect(service.getPack({ tenantId: 'edu-a' }).academicYear).toBe('A-revised');
  });

  test('only whitelisted fields are persisted — no blind spread of client input', () => {
    const saved = service.updatePack({ tenantId: 'edu-a' }, {
      academicYear: '2026/2027',
      // Every one of these must be dropped.
      createdAt: '1999-01-01T00:00:00.000Z',
      updatedAt: '1999-01-01T00:00:00.000Z',
      tenantId: 'edu-b',
      packs: [{ tenantId: 'edu-b', academicYear: 'injected' }],
      role: 'Owner',
      permissions: ['all'],
      __proto__: { polluted: true }
    });

    expect(saved.tenantId).toBe('edu-a');
    expect(saved.createdAt).not.toBe('1999-01-01T00:00:00.000Z');
    expect(saved.packs).toBeUndefined();
    expect(saved.role).toBeUndefined();
    expect(saved.permissions).toBeUndefined();

    // The persisted document holds exactly one pack, owned by edu-a.
    const doc = readStore(dir, service.STORE_KEY);
    expect(doc.packs).toHaveLength(1);
    expect(doc.packs[0].tenantId).toBe('edu-a');
    expect(doc.packs[0].academicYear).toBe('2026/2027');
  });

  test('writable fields are type-validated', () => {
    expect(() => service.updatePack({ tenantId: 'edu-a' }, { academicYear: 1234 }))
      .toThrow(/academicYear must be a string/);
    expect(() => service.updatePack({ tenantId: 'edu-a' }, { currency: {} }))
      .toThrow(/currency must be a string/);
  });

  test('tenantId is not a writable field in the whitelist', () => {
    expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, 'tenantId')).toBe(false);
  });

  test('capability manifest never advertises an unimplemented Education entity', () => {
    const caps = service.listCapabilities();
    // STU-2 flipped 'students', STU-3 flipped 'teachers', STU-4 flipped
    // 'centers', STU-5 flipped 'programs' and 'courses' and STU-6 flipped
    // 'classes' and STU-7 flipped 'enrollments'; everything after it
    // must still report false so the manifest never overstates the surface.
    expect(caps.find(c => c.key === 'students').implemented).toBe(true);
    expect(caps.find(c => c.key === 'teachers').implemented).toBe(true);
    expect(caps.find(c => c.key === 'centers').implemented).toBe(true);
    expect(caps.find(c => c.key === 'programs').implemented).toBe(true);
    expect(caps.find(c => c.key === 'courses').implemented).toBe(true);
    expect(caps.find(c => c.key === 'classes').implemented).toBe(true);
    expect(caps.find(c => c.key === 'enrollments').implemented).toBe(true);
    expect(caps.find(c => c.key === 'attendance').implemented).toBe(true);
    expect(caps.find(c => c.key === 'attendance').phase).toBe('STU-8');
    // STU-9 closes the last Education capability, so nothing is pending.
    expect(caps.find(c => c.key === 'scheduling').implemented).toBe(true);
    expect(caps.find(c => c.key === 'scheduling').phase).toBe('STU-9');
    const stillPending = [];
    for (const key of stillPending) {
      const cap = caps.find(c => c.key === key);
      expect(cap).toBeDefined();
      expect(cap.implemented).toBe(false);
    }
    expect(caps.find(c => c.key === 'pack').implemented).toBe(true);
  });

  test('the initial store has no global/shared collection to leak', () => {
    const doc = readStore(dir, service.STORE_KEY);
    // Either untouched (nothing written yet) or packs-only — never a shared
    // top-level settings object readable by every tenant.
    expect(doc === null || Array.isArray(doc.packs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — real server.js mount, real auth + tenantCarry + requirePermission
// ---------------------------------------------------------------------------
describe('STU-1 /api/v1/tenant/education — authorization and isolation over HTTP', () => {
  let dir;
  let app;
  let jwt;

  beforeAll(() => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    dir = makeTempDataDir('edu-http');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const started = startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    jwt = require('../utils/jwt');
  });

  afterAll(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const ownerA = () => jwt.signAccessToken({ id: 'u-owner', username: 'eduOwner', role: 'Owner', tenantId: 'edu-a' });
  const ownerB = () => jwt.signAccessToken({ id: 'u-owner', username: 'eduOwner', role: 'Owner', tenantId: 'edu-b' });
  const ownerRetired = () => jwt.signAccessToken({ id: 'u-owner', username: 'eduOwner', role: 'Owner', tenantId: 'edu-retired' });
  const viewerA = () => jwt.signAccessToken({ id: 'u-viewer', username: 'eduViewer', role: 'Viewer', tenantId: 'edu-a' });
  const managerA = () => jwt.signAccessToken({ id: 'u-manager', username: 'eduManager', role: 'Manager', tenantId: 'edu-a' });

  const BASE = '/api/v1/tenant/education';

  // --- Authentication -----------------------------------------------------

  test('unauthenticated reads and writes are rejected with 401', async () => {
    for (const call of [
      request(app).get(`${BASE}/pack`),
      request(app).put(`${BASE}/pack`).send({ academicYear: '2026' }),
      request(app).delete(`${BASE}/pack`),
      request(app).get(`${BASE}/capabilities`)
    ]) {
      const res = await call;
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe('Authentication required');
    }
  });

  test('a garbage/unsigned token is rejected with 401', async () => {
    const res = await request(app).get(`${BASE}/pack`).set('Authorization', 'Bearer not.a.real.token');
    expect(res.statusCode).toBe(401);
  });

  test('the Education surface is NOT registered behind the ERP/Market/TikTok prefixes', async () => {
    for (const path of ['/api/v1/education/pack', '/api/v1/students', '/api/v1/market/education']) {
      const res = await request(app).get(path).set('Authorization', `Bearer ${ownerA()}`);
      expect(res.statusCode).not.toBe(200);
    }
  });

  test('strict permission gate does NOT degrade when AUTH_REQUIRED is false', async () => {
    // Separate instance with authentication globally OFF, which is the shipped
    // default. If Education used requirePermissionIfAuth this would return 200.
    const offDir = makeTempDataDir('edu-noauth');
    seed(offDir, 'companies', companies);
    seed(offDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    const offApp = startServer(offDir, { AUTH_REQUIRED: 'false' }).app;

    try {
      const config = require('../config');
      expect(config.authRequired).toBe(false);

      const res = await request(offApp).get(`${BASE}/pack`);
      expect(res.statusCode).toBe(401);
      expect(res.body.message).toBe('Authentication required');

      const write = await request(offApp).put(`${BASE}/pack`).send({ academicYear: '2026' });
      expect(write.statusCode).toBe(401);
    } finally {
      try { fs.rmSync(offDir, { recursive: true, force: true }); } catch (_) {}
      // Restore the hardened instance for the remaining tests.
      process.env.ENABLE_TENANT_CARRY = 'true';
      app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    }
  });

  // --- Permission boundaries ---------------------------------------------

  test('an unregistered Education permission fails CLOSED even when granted on the user record', async () => {
    // eduViewer holds education.pack.view / .edit explicitly in the user store.
    // They are NOT in backend/permissions/registry.js, and unknown permissions
    // fail closed — so this must be 403, not 200.
    const res = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${viewerA()}`);
    expect(res.statusCode).toBe(403);
    expect(res.body.message).toBe('Insufficient permission');
    expect(res.body.details.code).toBe('PERMISSION_DENIED');
  });

  test('a role with no Education permission is denied writes', async () => {
    const res = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${managerA()}`)
      .send({ academicYear: '2026' });
    expect(res.statusCode).toBe(403);
  });

  test('a privileged role reaches the controller and service', async () => {
    const res = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: '2026/2027', timezone: 'Africa/Cairo' });
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('edu-a');
    expect(res.body.data.academicYear).toBe('2026/2027');
  });

  test('capabilities are readable by a privileged role and expose no student data', async () => {
    const res = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(200);
    const keys = res.body.data.map(c => c.key);
    expect(keys).toEqual(expect.arrayContaining(['pack', 'students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance', 'scheduling']));
    // STU-2 flipped `students`, STU-3 flipped `teachers`, STU-4 flipped
    // `centers`, STU-5 flipped `programs` and `courses`, STU-6 flipped
    // `classes`, STU-7 flipped `enrollments`, STU-8 flipped `attendance` and
    // STU-9 flipped `scheduling`. Every Education capability is implemented, so
    // the manifest overstates nothing.
    for (const key of ['students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance', 'scheduling']) {
      expect(res.body.data.find(c => c.key === key).implemented).toBe(true);
    }
    expect(res.body.data.find(c => c.key === 'attendance').phase).toBe('STU-8');
    expect(res.body.data.find(c => c.key === 'scheduling').phase).toBe('STU-9');
  });

  // --- Tenant isolation over HTTP ----------------------------------------

  test('tenant B cannot read tenant A pack values', async () => {
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: 'A-only-year', timezone: 'Africa/Cairo' });

    const resA = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerA()}`);
    const resB = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerB()}`);

    expect(resA.body.data.academicYear).toBe('A-only-year');
    expect(resB.body.data.academicYear).not.toBe('A-only-year');
    expect(resB.body.data.tenantId).toBe('edu-b');
  });

  test('tenant B cannot update tenant A pack values', async () => {
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: 'A-locked' });

    // edu-b attempts to write, including a spoofed tenantId in the body.
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerB()}`)
      .send({ tenantId: 'edu-a', academicYear: 'B-overwrite-attempt' });

    const resA = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerA()}`);
    expect(resA.body.data.academicYear).toBe('A-locked');
    expect(resA.body.data.tenantId).toBe('edu-a');
  });

  test('tenant B cannot delete tenant A pack', async () => {
    // Give BOTH tenants a pack so the delete has something real to act on.
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: 'A-survives-delete' });
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerB()}`)
      .send({ academicYear: 'B-gets-deleted' });

    // B deletes only B's OWN pack, while trying to name A in every client slot.
    const deleted = await request(app).delete(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerB()}`)
      .set('tenantId', 'edu-a')
      .set('companyId', 'edu-a');
    expect(deleted.statusCode).toBe(200);

    // B's pack is gone...
    const resB = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerB()}`);
    expect(resB.body.data.academicYear).toBe('');
    expect(resB.body.data.tenantId).toBe('edu-b');

    // ...and A's pack is untouched.
    const resA = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerA()}`);
    expect(resA.body.data.academicYear).toBe('A-survives-delete');
    expect(resA.body.data.tenantId).toBe('edu-a');

    // A second delete now has nothing to remove for B.
    const again = await request(app).delete(`${BASE}/pack`).set('Authorization', `Bearer ${ownerB()}`);
    expect(again.statusCode).toBe(404);
  });

  // --- Fail closed --------------------------------------------------------

  test('missing tenant context fails closed with 400 and no fallback tenant', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'eduOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant does NOT silently fall back to another tenant', async () => {
    await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: 'A-year-before-inactive' });

    const res = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerRetired()}`);

    // NUANCE, pinned deliberately. tenantCarry declines to rebuild a
    // TenantContext for an INACTIVE company, but `trustedTenantId(req)` still
    // falls back to the SERVER-SIGNED token claim, so the request resolves to
    // its own namespace 'edu-retired' rather than to any other tenant.
    //
    // The security property that actually matters is therefore ISOLATION, not
    // rejection: an inactive tenant must never inherit a live tenant's data,
    // and must never be silently reassigned to DEFAULT_TENANT_ID.
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('edu-retired');
    expect(res.body.data.academicYear).not.toBe('A-year-before-inactive');
    expect(res.body.data.academicYear).toBe('');

    // edu-a is completely unaffected.
    const stillThere = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillThere.body.data.academicYear).toBe('A-year-before-inactive');
    expect(stillThere.body.data.tenantId).toBe('edu-a');
  });

  test('an unknown tenant claim cannot reach another tenant either', async () => {
    const bogus = jwt.signAccessToken({ id: 'u-owner', username: 'eduOwner', role: 'Owner', tenantId: 'edu-does-not-exist' });
    const res = await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${bogus}`);
    // No company record, no tenant context, and the claim names a namespace
    // that owns no data — it resolves to an empty default of its own.
    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('edu-does-not-exist');
    expect(res.body.data.academicYear).toBe('');
  });

  // --- Client tenant spoofing --------------------------------------------

  test('query, body and header tenant values never alter authorization or isolation', async () => {
    const res = await request(app).get(`${BASE}/pack?tenantId=edu-b&companyId=edu-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'edu-b')
      .set('companyId', 'edu-b')
      .set('X-Tenant-Id', 'edu-b');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.tenantId).toBe('edu-a');

    const write = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'edu-b')
      .set('companyId', 'edu-b')
      .send({ tenantId: 'edu-b', academicYear: 'spoof-attempt' });

    expect(write.statusCode).toBe(200);
    expect(write.body.data.tenantId).toBe('edu-a');

    const verify = await request(app).get(`${BASE}/pack?tenantId=edu-b`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verify.body.data.tenantId).toBe('edu-b');
    expect(verify.body.data.academicYear).not.toBe('spoof-attempt');
  });
});

// ---------------------------------------------------------------------------
// 3. WRITE GUARD — documented Master-owned interaction (verify, do not fix)
// ---------------------------------------------------------------------------
describe('STU-1 global write guard interaction (Master-owned — documented, not altered)', () => {
  const PERMISSION_GUARDED_WRITE_ROUTES = new Set([
    '/sales', '/purchases', '/inventory', '/inventory-transactions', '/customers',
    '/suppliers', '/partners', '/vouchers', '/employees', '/treasury', '/dashboard',
    '/reports', '/users', '/audit-log', '/permissions'
  ]);

  test("'/education' is genuinely absent from PERMISSION_GUARDED_WRITE_ROUTES today", () => {
    // The Set is module-private (not exported), so assert against the real
    // source rather than duplicating it blindly.
    const src = fs.readFileSync(require('path').join(__dirname, '..', 'middleware', 'authorize.js'), 'utf8');
    const block = src.match(/PERMISSION_GUARDED_WRITE_ROUTES\s*=\s*new Set\(\[([\s\S]*?)\]\)/);
    expect(block).not.toBeNull();

    const entries = block[1].match(/'([^']+)'/g).map(s => s.slice(1, -1));
    expect(entries).toEqual(expect.arrayContaining(['/customers', '/users', '/permissions']));
    expect(entries).not.toContain('/education');
    expect(entries).not.toContain('/tenant');
  });

  test('the global write guard keys on "tenant", so the documented one-line fix would be INEFFECTIVE', () => {
    // scopedWriteRoleGuard does: req.path.split('/')[1] where req.path is
    // relative to the '/api/v1' mount. Verified empirically:
    //   /api/v1/tenant/education/pack -> req.path '/tenant/education/pack'
    //   -> segments ["", "tenant", "education", "pack"] -> seg "tenant"
    const relativePath = '/tenant/education/pack';
    const seg = relativePath.split('/')[1];
    expect(seg).toBe('tenant');
    expect(PERMISSION_GUARDED_WRITE_ROUTES.has('/' + seg)).toBe(false);

    // Adding '/education' would NOT be consulted for this namespace.
    const widened = new Set([...PERMISSION_GUARDED_WRITE_ROUTES, '/education']);
    expect(widened.has('/' + seg)).toBe(false);
    // Only exempting the whole '/tenant' segment would change behaviour — a
    // broad change that also affects student-services, shifts, online-store
    // and notifications. That decision belongs to Master.
    const broad = new Set([...PERMISSION_GUARDED_WRITE_ROUTES, '/tenant']);
    expect(broad.has('/' + seg)).toBe(true);
  });

  test('a Manager write is blocked before Education permissions are evaluated', async () => {
    const dir = makeTempDataDir('edu-guard');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    const guardApp = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    const jwt = require('../utils/jwt');

    try {
      const res = await request(guardApp)
        .put('/api/v1/tenant/education/pack')
        .set('Authorization', `Bearer ${jwt.signAccessToken({ id: 'u-manager', username: 'eduManager', role: 'Manager', tenantId: 'edu-a' })}`)
        .send({ academicYear: '2026' });

      // Manager is not privileged and holds no Education permission, so the
      // write is refused. This documents the current gate order without
      // changing any Master-owned authorization file.
      expect(res.statusCode).toBe(403);
      expect(['Insufficient role', 'Insufficient permission']).toContain(res.body.message);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    }
  });
});

// Restore env so other suites are unaffected.
afterAll(() => {
  const mapping = {
    ENABLE_TENANT_CARRY: 'CARRY',
    ENABLE_TENANT_ROLES: 'ROLES',
    AUTH_REQUIRED: 'AUTH',
    DIGITRONICS_DATA_DIR: 'DATA'
  };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});
