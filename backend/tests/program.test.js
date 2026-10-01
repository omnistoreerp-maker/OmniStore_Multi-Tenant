'use strict';

// STU-5 Education Program records — regression suite (Device 2).
//
// Mirrors the STU-2/3/4 suites and adds the Program-specific concerns: the
// OPTIONAL same-tenant Center reference, descriptive duration metadata, and
// TENANT-SCOPED programCode uniqueness with a deterministic 409.
//
// It also pins the domain contract explicitly: Center -> Program is a
// relationship INSIDE one tenant, never a tenant hierarchy, and Program
// carries no teacher/student/class/enrollment coupling.
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
  { id: 'prg-a', name: 'Program Tenant A', code: 'PRGA', active: true },
  { id: 'prg-b', name: 'Program Tenant B', code: 'PRGB', active: true },
  { id: 'prg-retired', name: 'Retired Program Tenant', code: 'PRGR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'prgOwner', password, role: 'Owner', fullName: 'Program Owner',
      tenantIds: ['prg-a', 'prg-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Program permissions EXPLICITLY, so
      // the suite proves an unregistered permission still fails closed rather
      // than being honoured because a client record asked for it.
      id: 'u-clerk', username: 'prgClerk', password, role: 'Viewer', fullName: 'Program Clerk',
      permissions: ['education.programs.view', 'education.programs.edit'],
      tenantIds: ['prg-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'prgManager', password, role: 'Manager', fullName: 'Program Manager',
      tenantIds: ['prg-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-5 program.service — trusted tenant + relationship integrity', () => {
  let dir;
  let service;
  let centers;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('prg-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/program.service');
    centers = require('../services/center.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'prg-a' };
  const B = { tenantId: 'prg-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listPrograms(null)).toThrow('Tenant context is required');
    expect(() => service.listPrograms({})).toThrow('Tenant context is required');
    expect(() => service.listPrograms({ tenantId: '' })).toThrow('Tenant context is required');
    expect(() => service.getProgram(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createProgram(null, { name: 'P' })).toThrow('Tenant context is required');
    expect(() => service.updateProgram(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveProgram(null, 'x')).toThrow('Tenant context is required');
  });

  test('a numeric tenant id is accepted and stringified', () => {
    const created = service.createProgram({ tenantId: 42 }, { name: 'Num' });
    expect(created.tenantId).toBe('42');
    expect(service.listPrograms({ tenantId: '42' })).toHaveLength(1);
  });

  test('create stamps the trusted tenant and trims input', () => {
    const created = service.createProgram(A, { name: '  English Track  ' });
    expect(created.tenantId).toBe('prg-a');
    expect(created.name).toBe('English Track');
    expect(created.status).toBe('active');
    expect(created.centerId).toBe('');
    expect(created.programCode).toMatch(/^PRG/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('displayName defaults to the name and respects an explicit value', () => {
    expect(service.createProgram(A, { name: 'Sciences' }).displayName).toBe('Sciences');
    expect(service.createProgram(A, { name: 'Arts', displayName: 'Fine Arts Track' }).displayName)
      .toBe('Fine Arts Track');
  });

  test('a rename refreshes a derived displayName but respects an explicit one', () => {
    const derived = service.createProgram(A, { name: 'Sciences' });
    expect(service.updateProgram(A, derived.id, { name: 'Science' }).displayName).toBe('Science');

    const explicit = service.createProgram(A, { name: 'Arts', displayName: 'Fine Arts Track' });
    expect(service.updateProgram(A, explicit.id, { name: 'Art' }).displayName).toBe('Fine Arts Track');
  });

  test('server-owned fields are rejected on create, not silently ignored', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt', 'updatedAt']) {
      expect(() => service.createProgram(A, { name: 'P', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('later-phase relationship fields are refused outright', () => {
    for (const field of ['teacherId', 'studentId', 'classId', 'enrollmentId']) {
      expect(() => service.createProgram(A, { name: 'P', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('create validates required name, enums and duration metadata', () => {
    expect(() => service.createProgram(A, {})).toThrow('name is required');
    expect(() => service.createProgram(A, { name: 'P', status: 'unknown' }))
      .toThrow('status must be one of: active, inactive, archived');
    expect(() => service.createProgram(A, { name: 'P', durationUnit: 'fortnights' }))
      .toThrow('durationUnit must be one of: days, weeks, months');
    expect(() => service.createProgram(A, { name: 'P', durationValue: 0 }))
      .toThrow('durationValue must be an integer between 1 and 1000');
    expect(() => service.createProgram(A, { name: 'P', durationValue: 1.5 }))
      .toThrow('durationValue must be an integer between 1 and 1000');
    expect(() => service.createProgram(A, { name: 'P', durationValue: '8' }))
      .toThrow('durationValue must be a number');
    expect(() => service.createProgram(A, 'not-an-object')).toThrow('request body must be a JSON object');
  });

  test('valid duration metadata is stored descriptively', () => {
    const created = service.createProgram(A, { name: 'Track', durationValue: 12, durationUnit: 'weeks' });
    expect(created.durationValue).toBe(12);
    expect(created.durationUnit).toBe('weeks');
    const omitted = service.createProgram(A, { name: 'NoDuration' });
    expect(omitted.durationValue).toBeNull();
    expect(omitted.durationUnit).toBe('');
  });

  test('every declared status is accepted', () => {
    for (const status of ['active', 'inactive', 'archived']) {
      expect(service.createProgram(A, { name: 'p-' + status, status }).status).toBe(status);
    }
  });

  test('oversized input is rejected rather than silently truncated', () => {
    expect(() => service.createProgram(A, { name: 'x'.repeat(400) }))
      .toThrow('name must be at most 160 characters');
    const created = service.createProgram(A, { name: 'P' });
    expect(() => service.updateProgram(A, created.id, { notes: 'n'.repeat(400) }))
      .toThrow('notes must be at most 160 characters');
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const payload = JSON.parse('{"name":"P","__proto__":{"polluted":"yes"}}');
    expect(() => service.createProgram(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();
  });

  test('list is tenant-scoped, sorted by name and copies records', () => {
    service.createProgram(A, { name: 'Zulu' });
    service.createProgram(A, { name: 'Adams' });
    service.createProgram(B, { name: 'Beta' });

    const listA = service.listPrograms(A);
    expect(listA.map(p => p.name)).toEqual(['Adams', 'Zulu']);
    listA[0].name = 'mutated';
    expect(service.listPrograms(A).find(p => p.name === 'Adams').name).toBe('Adams');
  });

  test('list filters by status, centerId and search', () => {
    const centerA = centers.createCenter(A, { name: 'Cairo Main', centerCode: 'C-1' });
    service.createProgram(A, { name: 'English', programCode: 'P-100', status: 'active', description: 'Language track', centerId: centerA.id });
    service.createProgram(A, { name: 'Closed', status: 'archived' });
    service.createProgram(B, { name: 'Foreign', description: 'Elsewhere' });

    expect(service.listPrograms(A, { status: 'active' })).toHaveLength(1);
    expect(service.listPrograms(A, { status: 'archived' })[0].name).toBe('Closed');
    expect(service.listPrograms(A, { status: 'nonsense' })).toHaveLength(2);
    expect(service.listPrograms(A, { centerId: centerA.id })).toHaveLength(1);
    expect(service.listPrograms(A, { centerId: 'ctr-nope' })).toHaveLength(0);

    expect(service.listPrograms(A, { search: 'p-100' })).toHaveLength(1);
    expect(service.listPrograms(A, { search: 'language track' })).toHaveLength(1);
    expect(service.listPrograms(A, { search: 'elsewhere' })).toHaveLength(0);
  });

  // --- RELATIONSHIP INTEGRITY ------------------------------------------------

  test('RELATIONSHIP: a same-tenant Center reference is accepted', () => {
    const centerA = centers.createCenter(A, { name: 'Cairo Main' });
    const created = service.createProgram(A, { name: 'English', centerId: centerA.id });
    expect(created.centerId).toBe(centerA.id);
    expect(created.tenantId).toBe('prg-a');
  });

  test('RELATIONSHIP: a cross-tenant Center reference is refused', () => {
    const centerB = centers.createCenter(B, { name: 'Foreign Center' });
    expect(() => service.createProgram(A, { name: 'English', centerId: centerB.id }))
      .toThrow('centerId does not reference a Center in this tenant');
    // Nothing was created, and the Center service is untouched.
    expect(service.listPrograms(A)).toHaveLength(0);
    expect(centers.getCenter(B, centerB.id)).not.toBeNull();
  });

  test('RELATIONSHIP: an unknown Center reference is refused identically', () => {
    expect(() => service.createProgram(A, { name: 'English', centerId: 'ctr-does-not-exist' }))
      .toThrow('centerId does not reference a Center in this tenant');
  });

  test('RELATIONSHIP: the cross-tenant and unknown cases are indistinguishable', () => {
    const centerB = centers.createCenter(B, { name: 'Foreign Center' });
    const readForeign = () => {
      try { service.createProgram(A, { name: 'X', centerId: centerB.id }); } catch (e) { return e.message; }
    };
    const readUnknown = () => {
      try { service.createProgram(A, { name: 'X', centerId: 'ctr-nope' }); } catch (e) { return e.message; }
    };
    // Existence of another tenant's Center is not leaked.
    expect(readForeign()).toBe(readUnknown());
  });

  test('RELATIONSHIP: update refuses a cross-tenant Center reference', () => {
    const created = service.createProgram(A, { name: 'English' });
    const centerB = centers.createCenter(B, { name: 'Foreign Center' });
    expect(() => service.updateProgram(A, created.id, { centerId: centerB.id }))
      .toThrow('centerId does not reference a Center in this tenant');
    expect(service.getProgram(A, created.id).centerId).toBe('');
  });

  // --- TENANT ISOLATION ------------------------------------------------------

  test('a tenant cannot read, update or archive another tenant program', () => {
    const created = service.createProgram(A, { name: 'English' });
    expect(service.getProgram(B, created.id)).toBeNull();
    expect(service.updateProgram(B, created.id, { name: 'hack' })).toBeNull();
    expect(service.archiveProgram(B, created.id)).toBeNull();
    expect(service.getProgram(A, created.id).name).toBe('English');
    expect(service.getProgram(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const created = service.createProgram(A, { name: 'English', notes: 'first' });
    const updated = service.updateProgram(A, created.id, { level: 'B2' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('prg-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.name).toBe('English');
    expect(updated.notes).toBe('first');
    expect(updated.level).toBe('B2');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  // --- ARCHIVE ---------------------------------------------------------------

  test('archive sets archived, bumps updatedAt, preserves the record and is idempotent', () => {
    const created = service.createProgram(A, { name: 'English' });
    const once = service.archiveProgram(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('prg-a');
    expect(once.createdAt).toBe(created.createdAt);
    expect(once.updatedAt).not.toBe(created.updatedAt);
    expect(service.archiveProgram(A, created.id).status).toBe('archived');
    expect(service.archiveProgram(A, 'no-such-id')).toBeNull();
    // Preserved, never deleted.
    expect(readStore(dir, 'educationPrograms').programs).toHaveLength(1);
  });

  test('ARCHIVE: archiving a Program never cascades to Centers', () => {
    const centerA = centers.createCenter(A, { name: 'Cairo Main' });
    const created = service.createProgram(A, { name: 'English', centerId: centerA.id });
    service.archiveProgram(A, created.id);
    // The Center keeps its own state; STU-5 does not modify Center behavior.
    expect(centers.getCenter(A, centerA.id).status).toBe('active');
  });

  // --- DUPLICATES ------------------------------------------------------------

  test('a duplicate programCode inside one tenant raises a typed conflict', () => {
    service.createProgram(A, { name: 'English', programCode: 'P-100' });
    let thrown = null;
    try {
      service.createProgram(A, { name: 'Other', programCode: 'P-100' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.conflict).toBe(true);
    expect(thrown.code).toBe('PROGRAM_CODE_CONFLICT');
    expect(thrown).toBeInstanceOf(service.ProgramCodeConflictError);
    expect(service.listPrograms(A)).toHaveLength(1);
  });

  test('the same programCode in different tenants is allowed', () => {
    service.createProgram(A, { name: 'English', programCode: 'P-100' });
    expect(service.createProgram(B, { name: 'Other', programCode: 'P-100' }).tenantId).toBe('prg-b');
  });

  test('an archived program releases its code for reuse', () => {
    const first = service.createProgram(A, { name: 'Old', programCode: 'P-100' });
    service.archiveProgram(A, first.id);
    expect(service.createProgram(A, { name: 'New', programCode: 'P-100' }).programCode).toBe('P-100');
    expect(service.listPrograms(A)).toHaveLength(2);
  });

  test('an inactive program still holds its code', () => {
    service.createProgram(A, { name: 'P', programCode: 'P-100', status: 'inactive' });
    expect(() => service.createProgram(A, { name: 'Dup', programCode: 'P-100' }))
      .toThrow('programCode already exists for this tenant: P-100');
  });

  test('a failed relationship check does not reserve the code', () => {
    const centerB = centers.createCenter(B, { name: 'Foreign Center' });
    expect(() => service.createProgram(A, { name: 'X', programCode: 'P-100', centerId: centerB.id }))
      .toThrow('centerId does not reference a Center in this tenant');
    // The relationship is validated BEFORE the code is reserved.
    const ok = service.createProgram(A, { name: 'Y', programCode: 'P-100' });
    expect(ok.programCode).toBe('P-100');
  });

  // --- SCOPE -----------------------------------------------------------------

  test('persistence uses the educationPrograms store and nothing else', () => {
    service.createProgram(A, { name: 'English' });
    const doc = readStore(dir, 'educationPrograms');
    expect(doc.programs).toHaveLength(1);
    expect(doc.programs[0].tenantId).toBe('prg-a');
    expect(fs.readdirSync(dir)).toEqual(['educationPrograms.json']);
  });

  test('a Program carries no teacher, student, class, enrollment or financial field', () => {
    const created = service.createProgram(A, { name: 'English' });
    for (const key of [
      'teacherId', 'studentId', 'classId', 'enrollmentId',
      'price', 'tuition', 'payment', 'billing', 'invoice', 'revenue',
      'salary', 'payroll', 'bankAccount', 'accountId',
      'password', 'portalToken', 'apiKey'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
  });

  test('a Program introduces no tenant hierarchy', () => {
    const created = service.createProgram(A, { name: 'English' });
    for (const key of ['parentTenantId', 'subTenants', 'isTenant', 'tenantHierarchy']) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-5 program routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('prg-http');
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

  const ownerA = () => token('prgOwner', 'prg-a', 'Owner');
  const ownerB = () => token('prgOwner', 'prg-b', 'Owner');
  const managerA = () => token('prgManager', 'prg-a', 'Manager');
  const clerkA = () => token('prgClerk', 'prg-a', 'Viewer');

  const create = (body, tok) => request(app).post(`${BASE}/programs`).set('Authorization', `Bearer ${tok}`).send(body);

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/programs`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/programs/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/programs`).send({ name: 'P' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/programs/anything`).send({ name: 'P' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/programs/anything/archive`)).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('prg-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/programs`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/programs`).send({ name: 'P' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Program permissions fail closed, with no bypass', async () => {
    const read = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(403);

    const write = await create({ name: 'Guard' }, managerA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationPrograms')).toBeNull();
  });

  test('CRUD: a privileged role performs the full lifecycle', async () => {
    const created = await create({
      name: 'English Track', level: 'B2', durationValue: 12, durationUnit: 'weeks'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('prg-a');
    expect(created.body.data.displayName).toBe('English Track');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/programs/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.durationValue).toBe(12);

    const listed = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/programs/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ name: 'English Advanced' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.tenantId).toBe('prg-a');
    expect(updated.body.data.durationValue).toBe(12);
    expect(updated.body.data.displayName).toBe('English Advanced');

    const archived = await request(app).patch(`${BASE}/programs/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    expect(archived.body.data.tenantId).toBe('prg-a');
  });

  test('VALIDATION: failures answer 400 without creating a record', async () => {
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'P', status: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'P', durationUnit: 'fortnights' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'P', durationValue: -1 }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'x'.repeat(400) }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationPrograms')).toBeNull();
  });

  test('VALIDATION: forbidden server-owned and later-phase fields answer 400', async () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'teacherId', 'classId', 'enrollmentId']) {
      const res = await create({ name: 'P', [field]: 'x' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
  });

  test('RELATIONSHIP: an unresolvable Center reference answers 400 and creates nothing', async () => {
    const unknown = await create({ name: 'P', centerId: 'ctr-nope' }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/centerId does not reference a Center in this tenant/);

    const foreign = await create({ name: 'P', centerId: 'ctr-foreign' }, ownerA());
    expect(foreign.statusCode).toBe(400);
    expect(foreign.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationPrograms')).toBeNull();
  });

  test('DUPLICATES: a duplicate programCode answers 409 inside one tenant and succeeds across tenants', async () => {
    const first = await create({ name: 'English', programCode: 'P-100' }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ name: 'Dup', programCode: 'P-100' }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/programCode already exists for this tenant/);
    expect(dup.body.details.code).toBe('PROGRAM_CODE_CONFLICT');

    const otherTenant = await create({ name: 'Other', programCode: 'P-100' }, ownerB());
    expect(otherTenant.statusCode).toBe(201);
    expect(otherTenant.body.data.tenantId).toBe('prg-b');

    const listA = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listA.body.data).toHaveLength(1);
  });

  test('TENANT: tenant B cannot read, update or archive tenant A programs', async () => {
    const created = await create({ name: 'English' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    expect((await request(app).get(`${BASE}/programs/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/programs/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ name: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/programs/${id}/archive`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/programs/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.name).toBe('English');
    expect(stillA.body.data.status).toBe('active');
  });

  test('TENANT: tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const created = await create({ name: 'English' }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/programs/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'prg-b')
        .set('companyId', 'prg-b')
        .send({ name: 'English', [field]: 'prg-b' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }

    const listB = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('TENANT: query and header tenant values never alter isolation', async () => {
    await create({ name: 'English', description: 'Language track' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/programs?tenantId=prg-b&companyId=prg-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'prg-b')
      .set('companyId', 'prg-b')
      .set('X-Tenant-Id', 'prg-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('prg-a');

    const verifyB = await request(app).get(`${BASE}/programs?tenantId=prg-a&search=Language`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'prgOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant never inherits a live tenant data', async () => {
    await create({ name: 'Live Program' }, ownerA());
    const res = await request(app).get(`${BASE}/programs`)
      .set('Authorization', `Bearer ${token('prgOwner', 'prg-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('no error response leaks internals', async () => {
    const missing = await request(app).get(`${BASE}/programs/no-such-id`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    const text = JSON.stringify(missing.body);
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('prg-a');
  });

  test('REGRESSION: the earlier Education routes are not shadowed', async () => {
    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(caps.body.data.find(c => c.key === 'programs').implemented).toBe(true);
    for (const key of ['students', 'teachers', 'centers', 'enrollments', 'attendance']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(true);
    }
    for (const key of ['scheduling']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(false);
    }

    expect((await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
  });

  test('Program routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/programs').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
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