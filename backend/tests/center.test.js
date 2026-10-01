'use strict';

// STU-4 Education Center records — regression suite (Device 2).
//
// Mirrors the STU-2 student and STU-3 teacher suites and adds the
// Center-specific concerns: name-derived displayName, timezone validation, and
// TENANT-SCOPED centerCode uniqueness with a deterministic 409.
//
// It also pins the tenant-model contract explicitly: a Center is an entity
// INSIDE the existing tenant. The suite asserts no tenant hierarchy, no
// companyId/ownerUserId/billingAccountId field, and no cross-tenant reach.
//
// Proves, against the REAL middleware chain (authMiddleware -> tenantCarry ->
// requirePermission -> controller -> service) and the REAL server.js mount:
//
//   AUTHENTICATION — every route refuses an anonymous caller.
//   AUTHORIZATION — strict gate does not degrade; unregistered permissions
//     fail closed; the global write guard still blocks a Manager; no bypass.
//   TENANT ISOLATION — list/get/update/archive are scoped; cross-tenant access
//     answers 404 so existence is not leaked; tenantId, companyId and branchId
//     spoofing cannot move a record.
//   CRUD — full lifecycle.
//   VALIDATION — required name, enums, email, timezone, size caps, forbidden
//     fields, prototype pollution.
//   DUPLICATES — same tenant collides, different tenants do not, archived
//     records release their code.
//   ARCHIVE — status, isolation, updatedAt, idempotency, no hard delete.
//   TENANT MODEL — Center is not a tenant, company, or billing account.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'ctr-a', name: 'Center Tenant A', code: 'CTRA', active: true },
  { id: 'ctr-b', name: 'Center Tenant B', code: 'CTRB', active: true },
  { id: 'ctr-retired', name: 'Retired Center Tenant', code: 'CTRR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'ctrOwner', password, role: 'Owner', fullName: 'Center Owner',
      tenantIds: ['ctr-a', 'ctr-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Center permissions EXPLICITLY, so
      // the suite proves an unregistered permission still fails closed rather
      // than being honoured because a client record asked for it.
      id: 'u-clerk', username: 'ctrClerk', password, role: 'Viewer', fullName: 'Center Clerk',
      permissions: ['education.centers.view', 'education.centers.edit'],
      tenantIds: ['ctr-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'ctrManager', password, role: 'Manager', fullName: 'Center Manager',
      tenantIds: ['ctr-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, fail closed, immutability, duplicates
// ---------------------------------------------------------------------------
describe('STU-4 center.service — trusted tenant + fail closed', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('ctr-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/center.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'ctr-a' };
  const B = { tenantId: 'ctr-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listCenters(null)).toThrow('Tenant context is required');
    expect(() => service.listCenters({})).toThrow('Tenant context is required');
    expect(() => service.listCenters({ tenantId: '' })).toThrow('Tenant context is required');
    expect(() => service.getCenter(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createCenter(null, { name: 'Main' })).toThrow('Tenant context is required');
    expect(() => service.updateCenter(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveCenter(null, 'x')).toThrow('Tenant context is required');
  });

  test('a numeric tenant id is accepted and stringified', () => {
    const created = service.createCenter({ tenantId: 42 }, { name: 'Num' });
    expect(created.tenantId).toBe('42');
    expect(service.listCenters({ tenantId: '42' })).toHaveLength(1);
  });

  test('create stamps the trusted tenant and trims input', () => {
    const created = service.createCenter(A, { name: '  Cairo Main  ', email: 'info@example.com' });
    expect(created.tenantId).toBe('ctr-a');
    expect(created.name).toBe('Cairo Main');
    expect(created.status).toBe('active');
    expect(created.centerCode).toMatch(/^CTR/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('displayName defaults to the name and respects an explicit value', () => {
    expect(service.createCenter(A, { name: 'Cairo Main' }).displayName).toBe('Cairo Main');
    expect(service.createCenter(A, { name: 'Alex', displayName: 'Alexandria Campus' }).displayName)
      .toBe('Alexandria Campus');
  });

  test('a rename refreshes a derived displayName but respects an explicit one', () => {
    const derived = service.createCenter(A, { name: 'Cairo Main' });
    expect(service.updateCenter(A, derived.id, { name: 'Cairo Central' }).displayName).toBe('Cairo Central');

    const explicit = service.createCenter(A, { name: 'Alex', displayName: 'Alexandria Campus' });
    expect(service.updateCenter(A, explicit.id, { name: 'Alex South' }).displayName).toBe('Alexandria Campus');
  });

  test('server-owned fields are rejected on create, not silently ignored', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'billingAccountId', 'createdAt', 'updatedAt']) {
      expect(() => service.createCenter(A, { name: 'Main', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('server-owned fields are rejected on update too', () => {
    const created = service.createCenter(A, { name: 'Main' });
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'billingAccountId']) {
      expect(() => service.updateCenter(A, created.id, { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.getCenter(A, created.id).tenantId).toBe('ctr-a');
  });

  test('create validates required name, enums, email and timezone', () => {
    expect(() => service.createCenter(A, {})).toThrow('name is required');
    expect(() => service.createCenter(A, { name: '  ' })).toThrow('name is required');
    expect(() => service.createCenter(A, { name: 'Main', status: 'unknown' }))
      .toThrow('status must be one of: active, inactive, archived');
    expect(() => service.createCenter(A, { name: 'Main', email: 'nope' })).toThrow('email is invalid');
    expect(() => service.createCenter(A, { name: 'Main', phone: 555 })).toThrow('phone must be a string');
    expect(() => service.createCenter(A, { name: 'Main', timezone: 'Mars/Olympus' }))
      .toThrow('timezone must be a valid IANA time zone');
    expect(() => service.createCenter(A, 'not-an-object')).toThrow('request body must be a JSON object');
  });

  test('a valid IANA timezone is accepted', () => {
    for (const tz of ['Africa/Cairo', 'UTC', 'Europe/Berlin']) {
      expect(service.createCenter(A, { name: 'C' + tz, timezone: tz }).timezone).toBe(tz);
    }
  });

  test('every declared status is accepted', () => {
    for (const status of ['active', 'inactive', 'archived']) {
      expect(service.createCenter(A, { name: 'c-' + status, status }).status).toBe(status);
    }
  });

  test('oversized input is rejected rather than silently truncated', () => {
    expect(() => service.createCenter(A, { name: 'x'.repeat(400) }))
      .toThrow('name must be at most 160 characters');
    const created = service.createCenter(A, { name: 'Main' });
    expect(() => service.updateCenter(A, created.id, { notes: 'n'.repeat(400) }))
      .toThrow('notes must be at most 160 characters');
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const payload = JSON.parse('{"name":"Main","__proto__":{"polluted":"yes"}}');
    expect(() => service.createCenter(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();
  });

  test('list is tenant-scoped, sorted by name and copies records', () => {
    service.createCenter(A, { name: 'Zulu' });
    service.createCenter(A, { name: 'Adams' });
    service.createCenter(B, { name: 'Beta' });

    const listA = service.listCenters(A);
    expect(listA.map(c => c.name)).toEqual(['Adams', 'Zulu']);
    listA[0].name = 'mutated';
    expect(service.listCenters(A).find(c => c.name === 'Adams').name).toBe('Adams');
  });

  test('list filters by status and search across the declared fields', () => {
    service.createCenter(A, {
      name: 'Cairo Main', centerCode: 'C-100', status: 'active',
      phone: '0100', email: 'main@example.com', address: 'Tahrir Square'
    });
    service.createCenter(A, { name: 'Closed Branch', status: 'archived' });
    service.createCenter(B, { name: 'Foreign', address: 'Elsewhere Road' });

    expect(service.listCenters(A, { status: 'active' })).toHaveLength(1);
    expect(service.listCenters(A, { status: 'archived' })[0].name).toBe('Closed Branch');
    expect(service.listCenters(A, { status: 'nonsense' })).toHaveLength(2);

    expect(service.listCenters(A, { search: 'c-100' })).toHaveLength(1);
    expect(service.listCenters(A, { search: 'cairo main' })).toHaveLength(1);
    expect(service.listCenters(A, { search: 'tahrir' })).toHaveLength(1);
    expect(service.listCenters(A, { search: '0100' })).toHaveLength(1);
    expect(service.listCenters(A, { search: 'elsewhere' })).toHaveLength(0);
  });

  test('a tenant cannot read, update or archive another tenant center', () => {
    const created = service.createCenter(A, { name: 'Cairo Main' });
    expect(service.getCenter(B, created.id)).toBeNull();
    expect(service.updateCenter(B, created.id, { name: 'hijack' })).toBeNull();
    expect(service.archiveCenter(B, created.id)).toBeNull();
    expect(service.getCenter(A, created.id).name).toBe('Cairo Main');
    expect(service.getCenter(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const created = service.createCenter(A, { name: 'Cairo Main', notes: 'first' });
    const updated = service.updateCenter(A, created.id, { address: 'Tahrir' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('ctr-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe('Cairo Main');
    expect(updated.notes).toBe('first');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test('archive sets archived, bumps updatedAt, preserves the record and is idempotent', () => {
    const created = service.createCenter(A, { name: 'Cairo Main' });
    const once = service.archiveCenter(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('ctr-a');
    expect(once.createdAt).toBe(created.createdAt);
    expect(once.updatedAt).not.toBe(created.updatedAt);
    expect(service.archiveCenter(A, created.id).status).toBe('archived');
    expect(service.archiveCenter(A, 'no-such-id')).toBeNull();
    // Preserved, never deleted.
    expect(readStore(dir, 'educationCenters').centers).toHaveLength(1);
  });

  test('persistence uses the educationCenters store and nothing else', () => {
    service.createCenter(A, { name: 'Cairo Main' });
    const doc = readStore(dir, 'educationCenters');
    expect(doc.centers).toHaveLength(1);
    expect(doc.centers[0].tenantId).toBe('ctr-a');
    expect(fs.readdirSync(dir)).toEqual(['educationCenters.json']);
  });

  test('a Center is not a tenant, company, billing account or auth holder', () => {
    const created = service.createCenter(A, { name: 'Cairo Main' });
    // No tenant hierarchy, no company/owner/billing ownership, no credentials.
    for (const key of [
      'parentTenantId', 'subTenants', 'isTenant', 'tenantHierarchy',
      'companyId', 'ownerUserId', 'billingAccountId',
      'subscription', 'revenue', 'payment', 'invoice',
      'salary', 'payroll', 'bankAccount', 'iban',
      'password', 'passwordHash', 'portalToken', 'apiKey'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
    // The only tenant reference is the server-owned tenantId.
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });

  test('the writable whitelist excludes every server-owned field', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'billingAccountId', 'createdAt', 'updatedAt']) {
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, field)).toBe(false);
      expect(service.FORBIDDEN_FIELDS).toContain(field);
    }
  });

  test('a duplicate centerCode inside one tenant raises a typed conflict', () => {
    service.createCenter(A, { name: 'Cairo Main', centerCode: 'C-100' });
    let thrown = null;
    try {
      service.createCenter(A, { name: 'Other', centerCode: 'C-100' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.conflict).toBe(true);
    expect(thrown.code).toBe('CENTER_CODE_CONFLICT');
    expect(thrown).toBeInstanceOf(service.CenterCodeConflictError);
    expect(service.listCenters(A)).toHaveLength(1);
  });

  test('the same centerCode in different tenants is allowed', () => {
    service.createCenter(A, { name: 'Cairo Main', centerCode: 'C-100' });
    const inB = service.createCenter(B, { name: 'Other', centerCode: 'C-100' });
    expect(inB.tenantId).toBe('ctr-b');
    expect(service.listCenters(A)).toHaveLength(1);
    expect(service.listCenters(B)).toHaveLength(1);
  });

  test('an archived center releases its code for reuse', () => {
    const first = service.createCenter(A, { name: 'Old', centerCode: 'C-100' });
    service.archiveCenter(A, first.id);
    const second = service.createCenter(A, { name: 'New', centerCode: 'C-100' });
    expect(second.centerCode).toBe('C-100');
    expect(service.listCenters(A)).toHaveLength(2);
  });

  test('an inactive center still holds its code', () => {
    service.createCenter(A, { name: 'Main', centerCode: 'C-100', status: 'inactive' });
    expect(() => service.createCenter(A, { name: 'Dup', centerCode: 'C-100' }))
      .toThrow('centerCode already exists for this tenant: C-100');
  });

  test('an update that collides on centerCode is refused, and a self-rename is allowed', () => {
    const one = service.createCenter(A, { name: 'One', centerCode: 'C-100' });
    const two = service.createCenter(A, { name: 'Two', centerCode: 'C-200' });

    expect(() => service.updateCenter(A, two.id, { centerCode: 'C-100' })).toThrow('centerCode already exists');
    expect(service.getCenter(A, two.id).centerCode).toBe('C-200');

    const same = service.updateCenter(A, one.id, { centerCode: 'C-100', notes: 'unchanged code' });
    expect(same.centerCode).toBe('C-100');
    expect(same.notes).toBe('unchanged code');
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — auth, authorization, isolation, CRUD
// ---------------------------------------------------------------------------
describe('STU-4 center routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('ctr-http');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const token = (username, tenantId, role) =>
    jwt.signAccessToken({ id: 'u-owner', username, role, tenantId });

  const ownerA = () => token('ctrOwner', 'ctr-a', 'Owner');
  const ownerB = () => token('ctrOwner', 'ctr-b', 'Owner');
  const managerA = () => token('ctrManager', 'ctr-a', 'Manager');
  const clerkA = () => token('ctrClerk', 'ctr-a', 'Viewer');

  const create = (body, tok) => request(app).post(`${BASE}/centers`).set('Authorization', `Bearer ${tok}`).send(body);

  test('AUTHENTICATION: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/centers`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/centers/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/centers`).send({ name: 'Main' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/centers/anything`).send({ name: 'Main' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/centers/anything/archive`)).statusCode).toBe(401);
  });

  test('AUTHORIZATION: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('ctr-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/centers`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/centers`).send({ name: 'Main' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Center permissions fail closed, with no bypass', async () => {
    // The clerk explicitly holds education.centers.* in its user record, yet
    // the permission is absent from backend/permissions/registry.js, so the
    // engine must refuse rather than honour the client record. STU-4 does NOT
    // register the permission and does NOT bypass the gate.
    const read = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(403);

    const write = await create({ name: 'Guard' }, managerA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationCenters')).toBeNull();
  });

  test('CRUD: a privileged role performs the full lifecycle', async () => {
    const created = await create({
      name: 'Cairo Main', email: 'info@example.com',
      timezone: 'Africa/Cairo', address: 'Tahrir Square'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('ctr-a');
    expect(created.body.data.displayName).toBe('Cairo Main');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.timezone).toBe('Africa/Cairo');

    const listed = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/centers/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ name: 'Cairo Central' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.tenantId).toBe('ctr-a');
    expect(updated.body.data.displayName).toBe('Cairo Central');
    expect(updated.body.data.address).toBe('Tahrir Square');

    const archived = await request(app).patch(`${BASE}/centers/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    expect(archived.body.data.tenantId).toBe('ctr-a');
  });

  test('VALIDATION: failures answer 400 without creating a record', async () => {
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'Main', status: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'Main', email: 'bad' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'Main', timezone: 'Mars/Olympus' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'x'.repeat(400) }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationCenters')).toBeNull();
  });

  test('VALIDATION: a forbidden server-owned field in the payload answers 400', async () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'ownerUserId', 'billingAccountId']) {
      const res = await create({ name: 'Main', [field]: 'ctr-b' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
  });

  test('VALIDATION: a prototype-pollution key over the wire never reaches a record', async () => {
    // LAYERING, pinned deliberately. The global, Master-owned `sanitizeBody`
    // middleware (backend/middleware/security.js) DELETES __proto__ /
    // constructor / prototype / $-prefixed keys from the parsed body before
    // any controller runs. So over HTTP the Center service never observes the
    // key at all and the request succeeds with a clean payload. The service's
    // own rejection (proven above) is defence in depth for any non-HTTP
    // caller, not the HTTP-layer behaviour.
    //
    // STU-4 does NOT modify security.js. Supertest serialises an object with a
    // raw string so the key actually reaches the wire.
    const res = await request(app)
      .post(`${BASE}/centers`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('Content-Type', 'application/json')
      .send('{"name":"Main","__proto__":{"polluted":"yes"}}');

    expect(res.statusCode).toBe(201);
    expect({}.polluted).toBeUndefined();

    const stored = readStore(dir, 'educationCenters').centers[0];
    expect(Object.prototype.hasOwnProperty.call(stored, '__proto__')).toBe(false);
    expect(stored.name).toBe('Main');
    expect(stored.tenantId).toBe('ctr-a');
  });

  test('DUPLICATES: a duplicate centerCode answers 409 inside one tenant and succeeds across tenants', async () => {
    const first = await create({ name: 'Cairo Main', centerCode: 'C-100' }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ name: 'Dup', centerCode: 'C-100' }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/centerCode already exists for this tenant/);
    expect(dup.body.details.code).toBe('CENTER_CODE_CONFLICT');

    const otherTenant = await create({ name: 'Other', centerCode: 'C-100' }, ownerB());
    expect(otherTenant.statusCode).toBe(201);
    expect(otherTenant.body.data.tenantId).toBe('ctr-b');

    const listA = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listA.body.data).toHaveLength(1);
  });

  test('TENANT ISOLATION: tenant B cannot read, update or archive tenant A centers', async () => {
    const created = await create({ name: 'Cairo Main' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    // 404, not 403: existence is not leaked across tenants.
    expect((await request(app).get(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ name: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/centers/${id}/archive`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.name).toBe('Cairo Main');
    expect(stillA.body.data.status).toBe('active');
  });

  test('TENANT ISOLATION: tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const created = await create({ name: 'Cairo Main' }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/centers/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'ctr-b')
        .set('companyId', 'ctr-b')
        .send({ name: 'Cairo Main', [field]: 'ctr-b' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }

    const listB = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('TENANT ISOLATION: query and header tenant values never alter authorization or isolation', async () => {
    await create({ name: 'Cairo Main', address: 'Tahrir Square' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/centers?tenantId=ctr-b&companyId=ctr-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'ctr-b')
      .set('companyId', 'ctr-b')
      .set('X-Tenant-Id', 'ctr-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('ctr-a');

    const verifyB = await request(app).get(`${BASE}/centers?tenantId=ctr-a&search=Tahrir`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'ctrOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant never inherits a live tenant data', async () => {
    await create({ name: 'Live Center' }, ownerA());
    const res = await request(app).get(`${BASE}/centers`)
      .set('Authorization', `Bearer ${token('ctrOwner', 'ctr-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('no error response leaks internals', async () => {
    const missing = await request(app).get(`${BASE}/centers/no-such-id`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    const text = JSON.stringify(missing.body);
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('.js:');
    expect(text).not.toContain('C:\\');
  });

  test('REGRESSION: the pack, student and teacher routes are not shadowed', async () => {
    const pack = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: '2026/2027' });
    expect(pack.statusCode).toBe(200);

    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(caps.body.data.find(c => c.key === 'centers').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'students').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'teachers').implemented).toBe(true);
    for (const key of ['programs', 'enrollments', 'attendance', 'scheduling']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(false);
    }

    expect((await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
  });

  test('Center routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/centers').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
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