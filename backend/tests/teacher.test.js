'use strict';

// STU-3 Teacher records — regression suite (Device 2).
//
// Mirrors the STU-2 student suite and adds the Teacher-specific concerns:
// employmentType validation, derived displayName, and TENANT-SCOPED
// teacherCode uniqueness with a deterministic 409.
//
// Proves, against the REAL middleware chain (authMiddleware -> tenantCarry ->
// requirePermission -> controller -> service) and the REAL server.js mount:
//
//   A. Authentication — every route refuses an anonymous caller.
//   B. Authorization — strict gate does not degrade; unregistered permissions
//      fail closed; the global write guard still blocks a Manager; no bypass.
//   C. Tenant isolation — list/get/update/archive are scoped; cross-tenant
//      access answers 404 so existence is not leaked; tenantId, companyId and
//      branchId spoofing cannot move a record.
//   D. CRUD — full lifecycle.
//   E. Validation — required names, enums, email, size caps, forbidden fields,
//      prototype pollution.
//   F. Duplicate handling — same tenant collides, different tenants do not,
//      archived records release their code.
//   G. Archive — status, isolation, updatedAt, idempotency, no hard delete.
//   H. Scope — no payroll/billing/portal field exists on the record.
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
  { id: 'tch-a', name: 'Teacher Tenant A', code: 'TCHA', active: true },
  { id: 'tch-b', name: 'Teacher Tenant B', code: 'TCHB', active: true },
  { id: 'tch-retired', name: 'Retired Teacher Tenant', code: 'TCHR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'tchOwner', password, role: 'Owner', fullName: 'Teacher Owner',
      tenantIds: ['tch-a', 'tch-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Teacher permissions EXPLICITLY, so
      // the suite proves an unregistered permission still fails closed rather
      // than being honoured because a client record asked for it.
      id: 'u-clerk', username: 'tchClerk', password, role: 'Viewer', fullName: 'Teacher Clerk',
      permissions: ['education.teachers.view', 'education.teachers.edit'],
      tenantIds: ['tch-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'tchManager', password, role: 'Manager', fullName: 'Teacher Manager',
      tenantIds: ['tch-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, fail closed, immutability, duplicates
// ---------------------------------------------------------------------------
describe('STU-3 teacher.service — trusted tenant + fail closed', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('tch-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/teacher.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'tch-a' };
  const B = { tenantId: 'tch-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listTeachers(null)).toThrow('Tenant context is required');
    expect(() => service.listTeachers({})).toThrow('Tenant context is required');
    expect(() => service.listTeachers({ tenantId: '' })).toThrow('Tenant context is required');
    expect(() => service.getTeacher(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createTeacher(null, { firstName: 'a', lastName: 'b' })).toThrow('Tenant context is required');
    expect(() => service.updateTeacher(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveTeacher(null, 'x')).toThrow('Tenant context is required');
  });

  test('a numeric tenant id is accepted and stringified', () => {
    const created = service.createTeacher({ tenantId: 42 }, { firstName: 'Num', lastName: 'Ten' });
    expect(created.tenantId).toBe('42');
    expect(service.listTeachers({ tenantId: '42' })).toHaveLength(1);
  });

  test('create stamps the trusted tenant and trims input', () => {
    const created = service.createTeacher(A, { firstName: '  Sara ', lastName: ' Ahmed ', email: 'sara@example.com' });
    expect(created.tenantId).toBe('tch-a');
    expect(created.firstName).toBe('Sara');
    expect(created.lastName).toBe('Ahmed');
    expect(created.status).toBe('active');
    expect(created.teacherCode).toMatch(/^TCH/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('displayName is derived from the names when not supplied', () => {
    const derived = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    expect(derived.displayName).toBe('Sara Ahmed');

    const explicit = service.createTeacher(A, { firstName: 'Omar', lastName: 'B', displayName: 'Dr. Omar' });
    expect(explicit.displayName).toBe('Dr. Omar');
  });

  test('a rename refreshes a derived displayName but respects an explicit one', () => {
    const derived = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const renamed = service.updateTeacher(A, derived.id, { lastName: 'Saleh' });
    expect(renamed.displayName).toBe('Sara Saleh');

    const explicit = service.createTeacher(A, { firstName: 'Omar', lastName: 'B', displayName: 'Dr. Omar' });
    const kept = service.updateTeacher(A, explicit.id, { lastName: 'C' });
    expect(kept.displayName).toBe('Dr. Omar');
  });

  test('server-owned fields are rejected on create, not silently ignored', () => {
    for (const field of ['tenantId', 'companyId', 'branchId', 'userId', 'id', 'createdAt', 'updatedAt']) {
      expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('server-owned fields are rejected on update too', () => {
    const created = service.createTeacher(A, { firstName: 'a', lastName: 'b' });
    expect(() => service.updateTeacher(A, created.id, { tenantId: 'tch-b' })).toThrow('tenantId is not writable');
    expect(() => service.updateTeacher(A, created.id, { companyId: 'x' })).toThrow('companyId is not writable');
    expect(() => service.updateTeacher(A, created.id, { branchId: 'x' })).toThrow('branchId is not writable');
    expect(() => service.updateTeacher(A, created.id, { id: 'hijack' })).toThrow('id is not writable');
    expect(service.getTeacher(A, created.id).tenantId).toBe('tch-a');
  });

  test('create validates required fields, enums, date and email', () => {
    expect(() => service.createTeacher(A, { lastName: 'b' })).toThrow('firstName is required');
    expect(() => service.createTeacher(A, { firstName: 'a' })).toThrow('lastName is required');
    expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', status: 'unknown' }))
      .toThrow('status must be one of: active, inactive, archived');
    expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', employmentType: 'freelance' }))
      .toThrow('employmentType must be one of: full_time, part_time, contract');
    expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', dateOfBirth: '01/02/2000' }))
      .toThrow('dateOfBirth must be YYYY-MM-DD');
    expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', email: 'nope' }))
      .toThrow('email is invalid');
    expect(() => service.createTeacher(A, 'not-an-object')).toThrow('request body must be a JSON object');
    expect(() => service.createTeacher(A, { firstName: 'a', lastName: 'b', phone: 555 }))
      .toThrow('phone must be a string');
  });

  test('every declared status and employment type is accepted', () => {
    for (const status of ['active', 'inactive', 'archived']) {
      expect(service.createTeacher(A, { firstName: 's', lastName: status, status }).status).toBe(status);
    }
    for (const employmentType of ['full_time', 'part_time', 'contract']) {
      const created = service.createTeacher(A, { firstName: 'e', lastName: employmentType, employmentType });
      expect(created.employmentType).toBe(employmentType);
    }
  });

  test('oversized input is rejected rather than silently truncated', () => {
    expect(() => service.createTeacher(A, { firstName: 'x'.repeat(400), lastName: 'y' }))
      .toThrow('firstName must be at most 160 characters');
    const created = service.createTeacher(A, { firstName: 'a', lastName: 'b' });
    expect(() => service.updateTeacher(A, created.id, { notes: 'n'.repeat(400) }))
      .toThrow('notes must be at most 160 characters');
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const payload = JSON.parse('{"firstName":"a","lastName":"b","__proto__":{"polluted":"yes"}}');
    expect(() => service.createTeacher(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();
  });

  test('list is tenant-scoped, sorted by lastName and copies records', () => {
    service.createTeacher(A, { firstName: 'Zoe', lastName: 'Adams' });
    service.createTeacher(A, { firstName: 'Ian', lastName: 'Zulu' });
    service.createTeacher(B, { firstName: 'Other', lastName: 'Beta' });

    const listA = service.listTeachers(A);
    expect(listA.map(t => t.lastName)).toEqual(['Adams', 'Zulu']);
    listA[0].firstName = 'mutated';
    expect(service.listTeachers(A).find(t => t.lastName === 'Adams').firstName).toBe('Zoe');
  });

  test('list filters by status, employmentType and search', () => {
    service.createTeacher(A, {
      firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100',
      status: 'active', employmentType: 'full_time', specialization: 'Mathematics'
    });
    service.createTeacher(A, { firstName: 'Omar', lastName: 'Badawy', status: 'archived', employmentType: 'contract' });
    service.createTeacher(B, { firstName: 'Foreign', lastName: 'Zzz' });

    expect(service.listTeachers(A, { status: 'active' })).toHaveLength(1);
    expect(service.listTeachers(A, { status: 'archived' })[0].firstName).toBe('Omar');
    expect(service.listTeachers(A, { employmentType: 'contract' })).toHaveLength(1);
    expect(service.listTeachers(A, { status: 'nonsense' })).toHaveLength(2);

    // Search covers teacherCode, names, displayName, email and specialization.
    expect(service.listTeachers(A, { search: 't-100' })).toHaveLength(1);
    expect(service.listTeachers(A, { search: 'badawy' })).toHaveLength(1);
    expect(service.listTeachers(A, { search: 'sara ahmed' })).toHaveLength(1);
    expect(service.listTeachers(A, { search: 'mathematics' })).toHaveLength(1);
    expect(service.listTeachers(A, { search: 'zzz' })).toHaveLength(0);
  });

  test('a tenant cannot read, update or archive another tenant teacher', () => {
    const created = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    expect(service.getTeacher(B, created.id)).toBeNull();
    expect(service.updateTeacher(B, created.id, { firstName: 'hack' })).toBeNull();
    expect(service.archiveTeacher(B, created.id)).toBeNull();
    expect(service.getTeacher(A, created.id).firstName).toBe('Sara');
    expect(service.getTeacher(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const created = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed', notes: 'first' });
    const updated = service.updateTeacher(A, created.id, { lastName: 'Saleh' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('tch-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.firstName).toBe('Sara');
    expect(updated.notes).toBe('first');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test('archive sets archived, bumps updatedAt, preserves the record and is idempotent', () => {
    const created = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const once = service.archiveTeacher(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('tch-a');
    expect(once.createdAt).toBe(created.createdAt);
    expect(once.updatedAt).not.toBe(created.updatedAt);
    expect(service.archiveTeacher(A, created.id).status).toBe('archived');
    expect(service.archiveTeacher(A, 'no-such-id')).toBeNull();
    // Preserved, never deleted.
    expect(readStore(dir, 'educationTeachers').teachers).toHaveLength(1);
  });

  test('persistence uses the educationTeachers store and nothing else', () => {
    service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const doc = readStore(dir, 'educationTeachers');
    expect(doc.teachers).toHaveLength(1);
    expect(doc.teachers[0].tenantId).toBe('tch-a');
    expect(fs.readdirSync(dir)).toEqual(['educationTeachers.json']);
  });

  test('the record carries no payroll, billing, payment or portal field', () => {
    const created = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const forbidden = [
      'salary', 'payroll', 'bankAccount', 'iban', 'compensation', 'rate', 'wage',
      'invoice', 'billing', 'payment', 'password', 'passwordHash', 'portalToken'
    ];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
  });

  test('the writable whitelist excludes every server-owned field', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'createdAt', 'updatedAt']) {
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, field)).toBe(false);
      expect(service.FORBIDDEN_FIELDS).toContain(field);
    }
  });

  test('a duplicate teacherCode inside one tenant raises a typed conflict', () => {
    service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100' });
    let thrown = null;
    try {
      service.createTeacher(A, { firstName: 'Other', lastName: 'Person', teacherCode: 'T-100' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.conflict).toBe(true);
    expect(thrown.code).toBe('TEACHER_CODE_CONFLICT');
    expect(thrown).toBeInstanceOf(service.TeacherCodeConflictError);
    expect(service.listTeachers(A)).toHaveLength(1);
  });

  test('the same teacherCode in different tenants is allowed', () => {
    service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100' });
    const inB = service.createTeacher(B, { firstName: 'Other', lastName: 'Person', teacherCode: 'T-100' });
    expect(inB.tenantId).toBe('tch-b');
    expect(service.listTeachers(A)).toHaveLength(1);
    expect(service.listTeachers(B)).toHaveLength(1);
  });

  test('an archived teacher releases its code for reuse', () => {
    const first = service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100' });
    service.archiveTeacher(A, first.id);
    const second = service.createTeacher(A, { firstName: 'New', lastName: 'Hire', teacherCode: 'T-100' });
    expect(second.teacherCode).toBe('T-100');
    expect(service.listTeachers(A)).toHaveLength(2);
  });

  test('an inactive teacher still holds its code', () => {
    service.createTeacher(A, { firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100', status: 'inactive' });
    expect(() => service.createTeacher(A, { firstName: 'Dup', lastName: 'Code', teacherCode: 'T-100' }))
      .toThrow('teacherCode already exists for this tenant: T-100');
  });

  test('an update that collides on teacherCode is refused, and a self-rename is allowed', () => {
    const one = service.createTeacher(A, { firstName: 'One', lastName: 'A', teacherCode: 'T-100' });
    const two = service.createTeacher(A, { firstName: 'Two', lastName: 'B', teacherCode: 'T-200' });

    expect(() => service.updateTeacher(A, two.id, { teacherCode: 'T-100' })).toThrow('teacherCode already exists');
    expect(service.getTeacher(A, two.id).teacherCode).toBe('T-200');

    // Re-submitting its own code is not a collision.
    const same = service.updateTeacher(A, one.id, { teacherCode: 'T-100', notes: 'unchanged code' });
    expect(same.teacherCode).toBe('T-100');
    expect(same.notes).toBe('unchanged code');
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — auth, authorization, isolation, CRUD
// ---------------------------------------------------------------------------
describe('STU-3 teacher routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('tch-http');
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

  const ownerA = () => token('tchOwner', 'tch-a', 'Owner');
  const ownerB = () => token('tchOwner', 'tch-b', 'Owner');
  const managerA = () => token('tchManager', 'tch-a', 'Manager');
  const clerkA = () => token('tchClerk', 'tch-a', 'Viewer');

  const create = (body, tok) => request(app).post(`${BASE}/teachers`).set('Authorization', `Bearer ${tok}`).send(body);

  test('A. unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/teachers`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/teachers/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/teachers`).send({ firstName: 'a', lastName: 'b' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/teachers/anything`).send({ firstName: 'a' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/teachers/anything/archive`)).statusCode).toBe(401);
  });

  test('B. the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('tch-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/teachers`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/teachers`).send({ firstName: 'a', lastName: 'b' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('B. unregistered Teacher permissions fail closed for a non-privileged role', async () => {
    // The clerk explicitly holds education.teachers.* in its user record, yet
    // the permission is absent from backend/permissions/registry.js, so the
    // engine must refuse rather than honour the client record. STU-3 does NOT
    // register the permission and does NOT bypass the gate.
    const read = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(403);

    const write = await create({ firstName: 'M', lastName: 'Guard' }, managerA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
  });

  test('D. a privileged role performs the full lifecycle', async () => {
    const created = await create({
      firstName: 'Sara', lastName: 'Ahmed', email: 'sara@example.com',
      specialization: 'Mathematics', employmentType: 'full_time'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('tch-a');
    expect(created.body.data.displayName).toBe('Sara Ahmed');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/teachers/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.specialization).toBe('Mathematics');

    const listed = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/teachers/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ lastName: 'Saleh' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.firstName).toBe('Sara');
    expect(updated.body.data.tenantId).toBe('tch-a');
    expect(updated.body.data.displayName).toBe('Sara Saleh');

    const archived = await request(app).patch(`${BASE}/teachers/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    expect(archived.body.data.tenantId).toBe('tch-a');
  });

  test('E. validation failures answer 400 without creating a record', async () => {
    expect((await create({ lastName: 'OnlyLast' }, ownerA())).statusCode).toBe(400);
    expect((await create({ firstName: 'a', lastName: 'b', status: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ firstName: 'a', lastName: 'b', employmentType: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ firstName: 'a', lastName: 'b', email: 'bad' }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationTeachers')).toBeNull();
  });

  test('E. a forbidden server-owned field in the payload answers 400', async () => {
    for (const field of ['tenantId', 'companyId', 'branchId', 'id']) {
      const res = await create({ firstName: 'a', lastName: 'b', [field]: 'tch-b' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
  });

  test('F. a duplicate teacherCode answers 409 inside one tenant and succeeds across tenants', async () => {
    const first = await create({ firstName: 'Sara', lastName: 'Ahmed', teacherCode: 'T-100' }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ firstName: 'Dup', lastName: 'Code', teacherCode: 'T-100' }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/teacherCode already exists for this tenant/);

    const otherTenant = await create({ firstName: 'Other', lastName: 'Tenant', teacherCode: 'T-100' }, ownerB());
    expect(otherTenant.statusCode).toBe(201);
    expect(otherTenant.body.data.tenantId).toBe('tch-b');

    // A failed create left nothing behind in tenant A.
    const listA = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listA.body.data).toHaveLength(1);
  });

  test('C. tenant B cannot read, update or archive tenant A teachers', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    // 404, not 403: existence is not leaked across tenants.
    expect((await request(app).get(`${BASE}/teachers/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/teachers/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ firstName: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/teachers/${id}/archive`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/teachers/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.firstName).toBe('Sara');
    expect(stillA.body.data.status).toBe('active');
  });

  test('C. tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/teachers/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'tch-b')
        .set('companyId', 'tch-b')
        .send({ firstName: 'Sara', [field]: 'tch-b' });
      expect(res.statusCode).toBe(400);
    }

    const listB = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('C. query and header tenant values never alter authorization or isolation', async () => {
    await create({ firstName: 'Sara', lastName: 'Ahmed', specialization: 'Mathematics' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/teachers?tenantId=tch-b&companyId=tch-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'tch-b')
      .set('companyId', 'tch-b')
      .set('X-Tenant-Id', 'tch-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('tch-a');

    const verifyB = await request(app).get(`${BASE}/teachers?tenantId=tch-a&search=Mathematics`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'tchOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant never inherits a live tenant data', async () => {
    await create({ firstName: 'Live', lastName: 'Tenant' }, ownerA());
    const res = await request(app).get(`${BASE}/teachers`)
      .set('Authorization', `Bearer ${token('tchOwner', 'tch-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('H. the STU-1 pack and STU-2 student routes are not shadowed', async () => {
    const pack = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: '2026/2027' });
    expect(pack.statusCode).toBe(200);

    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(caps.body.data.find(c => c.key === 'teachers').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'students').implemented).toBe(true);
    for (const key of ['programs', 'enrollments', 'attendance', 'scheduling']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(false);
    }

    const students = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`);
    expect(students.statusCode).toBe(200);
  });

  test('Teacher routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/teachers').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
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