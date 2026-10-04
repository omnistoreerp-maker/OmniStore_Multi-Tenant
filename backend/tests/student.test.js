'use strict';

// STU-2 Student records — regression suite (Device 2).
//
// Proves the same properties the STU-1 suite proved, extended to a real entity
// surface, against the REAL middleware chain (authMiddleware -> tenantCarry ->
// requirePermission -> controller -> service) and the REAL server.js mount:
//
//   * unauthenticated access is rejected and the strict permission gate does
//     not silently degrade when AUTH_REQUIRED is false;
//   * tenant A and tenant B are fully isolated on read, update and archive;
//   * a missing tenant context FAILS CLOSED with no fallback tenant;
//   * tenant ownership is server-owned and immutable on create AND update —
//     the blind-spread re-parenting defect in customers.service.js is
//     structurally impossible here;
//   * server-owned fields cannot be written from a client payload;
//   * prototype-pollution payloads are rejected;
//   * no client-supplied tenant value (query, body, or header) influences
//     authorization or isolation.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

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
  { id: 'stu-a', name: 'Student Tenant A', code: 'STUA', active: true },
  { id: 'stu-b', name: 'Student Tenant B', code: 'STUB', active: true },
  { id: 'stu-retired', name: 'Retired Student Tenant', code: 'STUR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'stuOwner', password, role: 'Owner', fullName: 'Student Owner',
      tenantIds: ['stu-a', 'stu-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Student permissions EXPLICITLY, so
      // the suite proves a registered, explicitly granted permission is honoured.
      id: 'u-clerk', username: 'stuClerk', password, role: 'Viewer', fullName: 'Student Clerk',
      permissions: ['education.students.view', 'education.students.edit'],
      tenantIds: ['stu-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding a Student permission the registry does NOT
      // know, so the suite proves an unregistered permission still fails closed
      // rather than being honoured because a client record asked for it.
      id: 'u-stranger', username: 'stuStranger', password, role: 'Viewer', fullName: 'Student Stranger',
      permissions: ['education.students.export'],
      tenantIds: ['stu-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'stuManager', password, role: 'Manager', fullName: 'Student Manager',
      tenantIds: ['stu-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, fail closed, immutability
// ---------------------------------------------------------------------------
describe('STU-2 student.service — trusted tenant + fail closed', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('stu-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/student.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'stu-a' };
  const B = { tenantId: 'stu-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listStudents(null)).toThrow('Tenant context is required');
    expect(() => service.listStudents({})).toThrow('Tenant context is required');
    expect(() => service.listStudents({ tenantId: '' })).toThrow('Tenant context is required');
    expect(() => service.getStudent(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createStudent(null, { firstName: 'a', lastName: 'b' })).toThrow('Tenant context is required');
    expect(() => service.updateStudent(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveStudent(null, 'x')).toThrow('Tenant context is required');
  });

  test('a numeric tenant id is accepted and stringified', () => {
    const created = service.createStudent({ tenantId: 42 }, { firstName: 'Num', lastName: 'Ten' });
    expect(created.tenantId).toBe('42');
    expect(service.listStudents({ tenantId: '42' })).toHaveLength(1);
  });

  test('create stamps the trusted tenant and trims input', () => {
    const created = service.createStudent(A, { firstName: '  Sara ', lastName: ' Ahmed ', email: 'sara@example.com' });
    expect(created.tenantId).toBe('stu-a');
    expect(created.firstName).toBe('Sara');
    expect(created.lastName).toBe('Ahmed');
    expect(created.status).toBe('active');
    expect(created.studentCode).toMatch(/^STU/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('server-owned fields are rejected on create, not silently ignored', () => {
    for (const field of ['tenantId', 'companyId', 'branchId', 'userId', 'id', 'createdAt', 'updatedAt']) {
      expect(() => service.createStudent(A, { firstName: 'a', lastName: 'b', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('server-owned fields are rejected on update too', () => {
    const created = service.createStudent(A, { firstName: 'a', lastName: 'b' });
    expect(() => service.updateStudent(A, created.id, { tenantId: 'stu-b' })).toThrow('tenantId is not writable');
    expect(() => service.updateStudent(A, created.id, { id: 'hijack' })).toThrow('id is not writable');
    expect(service.getStudent(A, created.id).tenantId).toBe('stu-a');
  });

  test('create validates required fields, status, date and email', () => {
    expect(() => service.createStudent(A, { lastName: 'b' })).toThrow('firstName is required');
    expect(() => service.createStudent(A, { firstName: 'a' })).toThrow('lastName is required');
    expect(() => service.createStudent(A, { firstName: 'a', lastName: 'b', status: 'unknown' }))
      .toThrow('status must be one of: active, inactive, archived');
    expect(() => service.createStudent(A, { firstName: 'a', lastName: 'b', dateOfBirth: '01/02/2000' }))
      .toThrow('dateOfBirth must be YYYY-MM-DD');
    expect(() => service.createStudent(A, { firstName: 'a', lastName: 'b', email: 'nope' }))
      .toThrow('email is invalid');
    expect(() => service.createStudent(A, 'not-an-object')).toThrow('request body must be a JSON object');
    expect(() => service.createStudent(A, { firstName: 'a', lastName: 'b', phone: 555 }))
      .toThrow('phone must be a string');
  });

  test('every declared status is accepted', () => {
    for (const status of ['active', 'inactive', 'archived']) {
      const created = service.createStudent(A, { firstName: 's', lastName: status, status });
      expect(created.status).toBe(status);
    }
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const payload = JSON.parse('{"firstName":"a","lastName":"b","__proto__":{"polluted":"yes"}}');
    expect(() => service.createStudent(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();
  });

  test('string fields are length-capped', () => {
    const created = service.createStudent(A, { firstName: 'x'.repeat(400), lastName: 'y' });
    expect(created.firstName).toHaveLength(160);
  });

  test('list is tenant-scoped, sorted by lastName and copies records', () => {
    service.createStudent(A, { firstName: 'Zoe', lastName: 'Adams' });
    service.createStudent(A, { firstName: 'Ian', lastName: 'Zulu' });
    service.createStudent(B, { firstName: 'Other', lastName: 'Beta' });

    const listA = service.listStudents(A);
    expect(listA.map(s => s.lastName)).toEqual(['Adams', 'Zulu']);
    listA[0].firstName = 'mutated';
    expect(service.listStudents(A).find(s => s.lastName === 'Adams').firstName).toBe('Zoe');
  });

  test('list filters by status and search, and ignores an unknown status filter', () => {
    service.createStudent(A, { firstName: 'Sara', lastName: 'Ahmed', status: 'active', phone: '0100' });
    service.createStudent(A, { firstName: 'Omar', lastName: 'Badawy', status: 'archived' });
    service.createStudent(B, { firstName: 'Foreign', lastName: 'Zzz' });

    expect(service.listStudents(A, { status: 'active' })).toHaveLength(1);
    expect(service.listStudents(A, { status: 'archived' })[0].firstName).toBe('Omar');
    expect(service.listStudents(A, { status: 'nonsense' })).toHaveLength(2);
    expect(service.listStudents(A, { search: 'badawy' })).toHaveLength(1);
    expect(service.listStudents(A, { search: '0100' })).toHaveLength(1);
    expect(service.listStudents(A, { search: 'zzz' })).toHaveLength(0);
  });

  test('a tenant cannot read, update or archive another tenant record', () => {
    const created = service.createStudent(A, { firstName: 'Sara', lastName: 'Ahmed' });
    expect(service.getStudent(B, created.id)).toBeNull();
    expect(service.updateStudent(B, created.id, { firstName: 'hack' })).toBeNull();
    expect(service.archiveStudent(B, created.id)).toBeNull();
    expect(service.getStudent(A, created.id).firstName).toBe('Sara');
    expect(service.getStudent(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const created = service.createStudent(A, { firstName: 'Sara', lastName: 'Ahmed', notes: 'first' });
    const updated = service.updateStudent(A, created.id, { lastName: 'Saleh' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('stu-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.firstName).toBe('Sara');
    expect(updated.lastName).toBe('Saleh');
    expect(updated.notes).toBe('first');
  });

  test('archive sets status to archived and is idempotent', () => {
    const created = service.createStudent(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const once = service.archiveStudent(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('stu-a');
    const twice = service.archiveStudent(A, created.id);
    expect(twice.status).toBe('archived');
    expect(service.archiveStudent(A, 'no-such-id')).toBeNull();
  });

  test('persistence uses the educationStudents store and nothing else', () => {
    service.createStudent(A, { firstName: 'Sara', lastName: 'Ahmed' });
    const doc = readStore(dir, 'educationStudents');
    expect(doc.students).toHaveLength(1);
    expect(doc.students[0].tenantId).toBe('stu-a');
    expect(fs.readdirSync(dir)).toEqual(['educationStudents.json']);
  });

  test('the store whitelist excludes every server-owned field', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'createdAt', 'updatedAt']) {
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, field)).toBe(false);
      expect(service.FORBIDDEN_FIELDS).toContain(field);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — auth, permissions, isolation
// ---------------------------------------------------------------------------
describe('STU-2 student routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('stu-http');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    const started = startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const token = (username, tenantId, role) =>
    jwt.signAccessToken({ id: 'u-owner', username, role, tenantId });

  const ownerA = () => token('stuOwner', 'stu-a', 'Owner');
  const ownerB = () => token('stuOwner', 'stu-b', 'Owner');
  const managerA = () => token('stuManager', 'stu-a', 'Manager');
  const clerkA = () => token('stuClerk', 'stu-a', 'Viewer');
  const strangerA = () => token('stuStranger', 'stu-a', 'Viewer');

  const create = (body, tok) => request(app).post(`${BASE}/students`).set('Authorization', `Bearer ${tok}`).send(body);

  test('unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/students`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/students/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/students`).send({ firstName: 'a', lastName: 'b' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/students/anything`).send({ firstName: 'a' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/students/anything/archive`)).statusCode).toBe(401);
  });

  test('the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('stu-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      const res = await request(lenientApp).get(`${BASE}/students`);
      expect(res.statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('an unregistered Education permission still fails closed for a non-privileged role', async () => {
    // The stranger explicitly holds education.students.export in its user
    // record, yet the permission is absent from backend/permissions/registry.js,
    // so the authorization engine must refuse rather than honour the client
    // record.
    const res = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${strangerA()}`);
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('PERMISSION_DENIED');
  });

  test('an explicitly granted, registered Student permission is honoured', async () => {
    // The clerk holds education.students.view, which the registry now knows.
    const res = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${clerkA()}`);
    expect(res.statusCode).toBe(200);
  });

  test('a Manager write is blocked by the global write guard before route permissions', async () => {
    const res = await create({ firstName: 'M', lastName: 'Guard' }, managerA());
    expect(res.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(res.body.message);
  });

  test('a privileged role performs the full lifecycle', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed', email: 'sara@example.com' }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('stu-a');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/students/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.firstName).toBe('Sara');

    const listed = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/students/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ lastName: 'Saleh' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.firstName).toBe('Sara');
    expect(updated.body.data.tenantId).toBe('stu-a');

    const archived = await request(app).patch(`${BASE}/students/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  test('validation failures answer 400 without creating a record', async () => {
    const res = await create({ lastName: 'OnlyLast' }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/firstName is required/);
    expect(readStore(dir, 'educationStudents')).toBeNull();
  });

  test('a server-owned field in the payload answers 400', async () => {
    const res = await create({ firstName: 'a', lastName: 'b', tenantId: 'stu-b' }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/tenantId is not writable/);
  });

  test('tenant B cannot read, update or archive tenant A students', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    const getB = await request(app).get(`${BASE}/students/${id}`).set('Authorization', `Bearer ${ownerB()}`);
    expect(getB.statusCode).toBe(404);

    const putB = await request(app).put(`${BASE}/students/${id}`)
      .set('Authorization', `Bearer ${ownerB()}`)
      .send({ firstName: 'hijacked' });
    expect(putB.statusCode).toBe(404);

    const archiveB = await request(app).patch(`${BASE}/students/${id}/archive`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(archiveB.statusCode).toBe(404);

    // Tenant A is completely untouched.
    const stillA = await request(app).get(`${BASE}/students/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.firstName).toBe('Sara');
    expect(stillA.body.data.status).toBe('active');
  });

  test('a spoofed tenantId in the body cannot re-parent a record', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;

    const res = await request(app).put(`${BASE}/students/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ firstName: 'Sara', tenantId: 'stu-b' });
    expect(res.statusCode).toBe(400);

    const listB = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'stuOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant never inherits a live tenant data', async () => {
    await create({ firstName: 'Live', lastName: 'Tenant' }, ownerA());
    const res = await request(app).get(`${BASE}/students`)
      .set('Authorization', `Bearer ${token('stuOwner', 'stu-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('query, body and header tenant values never alter authorization or isolation', async () => {
    const created = await create({ firstName: 'Sara', lastName: 'Ahmed' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/students?tenantId=stu-b&companyId=stu-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'stu-b')
      .set('companyId', 'stu-b')
      .set('X-Tenant-Id', 'stu-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('stu-a');

    const verifyB = await request(app).get(`${BASE}/students?tenantId=stu-a`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);

    // A query filter cannot reach into another tenant either.
    const filteredB = await request(app).get(`${BASE}/students?search=Ahmed`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(filteredB.body.data).toHaveLength(0);
    expect(created.body.data.tenantId).toBe('stu-a');
  });

  test('the STU-1 pack routes are not shadowed by the Student router', async () => {
    const pack = await request(app).put(`${BASE}/pack`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ academicYear: '2026/2027' });
    expect(pack.statusCode).toBe(200);
    expect(pack.body.data.academicYear).toBe('2026/2027');

    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(caps.statusCode).toBe(200);
    expect(caps.body.data.find(c => c.key === 'students').implemented).toBe(true);
    // STU-7 flipped `enrollments`, STU-8 flipped `attendance` and STU-9 flipped
    // `scheduling`, so the manifest now matches the implemented surface exactly.
    expect(caps.body.data.find(c => c.key === 'enrollments').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'attendance').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'scheduling').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'scheduling').phase).toBe('STU-9');
    expect(caps.body.data.find(c => c.key === 'grading').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'grading').phase).toBe('STU-10');

    const students = await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`);
    expect(students.statusCode).toBe(200);
    // The STU-7 Enrollment router does not shadow the Student routes.
    const enrollments = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${ownerA()}`);
    expect(enrollments.statusCode).toBe(200);
    expect(enrollments.body.data).toHaveLength(0);
  });

  test('Student routes are not mounted outside the Education namespace', async () => {
    const res = await request(app).get('/api/v1/students').set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// STU-2 Student progress — read-only, derived from canonical P2 data.
//
// This suite proves the progress contract WITHOUT creating a lesson entity,
// a progress store, or any fabricated relationship:
//
//   * the endpoint is read-only and gated by education.students.view;
//   * every count is derived from the real P2 stores (enrollments, classes,
//     attendance, scheduling) — never from a parallel model;
//   * a student can only ever see their OWN tenant's rows; a foreign id
//     answers 404 so existence is not leaked;
//   * no score, grade, GPA, percentage, performance scale or ranking is
//     present in the payload — the shape is counts only;
//   * `lessons.total` is always 0 because the canonical P2 model has no
//     lesson entity, and the endpoint never fabricates one.
// ---------------------------------------------------------------------------
describe('STU-2 student progress — raw counts only, no fabricated model', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;
  let ownerA;
  let ownerB;
  let clerkA;

  beforeEach(() => {
    dir = makeTempDataDir('stu-prog');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    const started = startServer(dir, { AUTH_REQUIRED: 'true' });
    app = started.app;
    jwt = require('../utils/jwt');
    const token = (username, tenantId, role) =>
      jwt.signAccessToken({ id: 'u-owner', username, role, tenantId });
    ownerA = () => token('stuOwner', 'stu-a', 'Owner');
    ownerB = () => token('stuOwner', 'stu-b', 'Owner');
    clerkA = () => token('stuClerk', 'stu-a', 'Viewer');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  // Creates one student in THIS test's fresh app instance and returns its id.
  const createOwnStudent = async () => {
    const res = await request(app)
      .post(`${BASE}/students`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({
        firstName: 'Progress',
        lastName: 'Student',
        email: 'prog@example.com',
        phone: '+1-555-0100',
        address: 'Test Street 1'
      });
    expect(res.statusCode).toBe(201);
    return res.body.data.id;
  };

  test('the progress route is gated by education.students.view and answers 401 anonymously', async () => {
    const res = await request(app).get(`${BASE}/students/anything/progress`);
    expect(res.statusCode).toBe(401);
  });

  test('a student with only the Student view permission can read their own progress', async () => {
    const id = await createOwnStudent();
    const res = await request(app)
      .get(`${BASE}/students/${id}/progress`)
      .set('Authorization', `Bearer ${clerkA()}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('enrollments');
    expect(res.body.data).toHaveProperty('attendance');
    expect(res.body.data).toHaveProperty('lessons');
  });

  test('the payload contains raw counts only — no score, grade, GPA, percentage or ranking', async () => {
    const id = await createOwnStudent();
    const res = await request(app)
      .get(`${BASE}/students/${id}/progress`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(typeof d.enrollments.total).toBe('number');
    expect(typeof d.enrollments.active).toBe('number');
    expect(typeof d.enrollments.withdrawn).toBe('number');
    expect(typeof d.courses.enrolled).toBe('number');
    expect(typeof d.classes.enrolled).toBe('number');
    expect(typeof d.sessions.scheduled).toBe('number');
    expect(typeof d.attendance.total).toBe('number');
    expect(typeof d.attendance.present).toBe('number');
    expect(typeof d.attendance.absent).toBe('number');
    expect(typeof d.attendance.late).toBe('number');
    expect(typeof d.attendance.excused).toBe('number');
    expect(d.lessons.total).toBe(0);
    // The shape must not smuggle in any derived score field.
    expect(d).not.toHaveProperty('gpa');
    expect(d).not.toHaveProperty('percentage');
    expect(d).not.toHaveProperty('score');
    expect(d).not.toHaveProperty('grade');
    expect(d).not.toHaveProperty('ranking');
    expect(d.attendance).not.toHaveProperty('rate');
    expect(d.attendance).not.toHaveProperty('average');
  });

  test('a foreign student id answers 404 so existence is not leaked across tenants', async () => {
    const res = await request(app)
      .get(`${BASE}/students/zzz-no-such-student/progress`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(404);
  });

  test('a tenant B owner cannot read tenant A student progress', async () => {
    const id = await createOwnStudent();
    const res = await request(app)
      .get(`${BASE}/students/${id}/progress`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(res.statusCode).toBe(404);
  });

  test('the counts reflect only the authenticated tenant rows', async () => {
    const id = await createOwnStudent();
    const res = await request(app)
      .get(`${BASE}/students/${id}/progress`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(200);
    const payload = JSON.stringify(res.body.data);
    // A cross-tenant id must never appear in the derived counts.
    expect(payload).not.toContain('stu-b');
  });
});


// P4 /students/me — link-based identity, tenant isolation
describe('P4 /students/me — link-based identity, tenant and branch isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  const now = new Date().toISOString();

  beforeEach(() => {
    dir = makeTempDataDir('stu-me');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: [
      { id: 'u-owner', username: 'stuOwner', password: bcrypt.hashSync('Pass#123', 10), role: 'Owner', fullName: 'Student Owner', tenantIds: ['stu-a', 'stu-b'], createdAt: now, updatedAt: now },
      { id: 'u-actor', username: 'stuActor', password: bcrypt.hashSync('Pass#123', 10), role: 'Viewer', fullName: 'Student Actor', tenantIds: ['stu-a'], createdAt: now, updatedAt: now },
      { id: 'u-manager', username: 'stuManager', password: bcrypt.hashSync('Pass#123', 10), role: 'Manager', fullName: 'Student Manager', tenantIds: ['stu-a'], createdAt: now, updatedAt: now }
    ]});
    seed(dir, 'educationStudents', { students: [
      { id: 'std-1', tenantId: 'stu-a', studentCode: 'S1', firstName: 'Sara', lastName: 'Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'std-2', tenantId: 'stu-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'std-b1', tenantId: 'stu-b', studentCode: 'SB', firstName: 'Bea', lastName: 'Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
    ]});
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const ownerA = () => jwt.signAccessToken({ id: 'u-owner', username: 'stuOwner', role: 'Owner', tenantId: 'stu-a' });
  const ownerB = () => jwt.signAccessToken({ id: 'u-owner', username: 'stuOwner', role: 'Owner', tenantId: 'stu-b' });
  const actorA = () => jwt.signAccessToken({ id: 'u-actor', username: 'stuActor', role: 'Viewer', tenantId: 'stu-a' });
  const managerA = () => jwt.signAccessToken({ id: 'u-manager', username: 'stuManager', role: 'Manager', tenantId: 'stu-a' });

  const link = (studentId, userId) =>
    request(app).post(BASE + '/students/' + studentId + '/link-user')
      .set('Authorization', 'Bearer ' + ownerA()).send({ userId });
  const delLink = (studentId, tok) =>
    request(app).delete(BASE + '/students/' + studentId + '/link-user')
      .set('Authorization', 'Bearer ' + tok);
  const get = (path, tok) =>
    request(app).get(BASE + path).set('Authorization', 'Bearer ' + tok);

  test('P4: /students/me refuses an anonymous caller with 401', async () => {
    expect((await request(app).get(BASE + '/students/me')).statusCode).toBe(401);
  });

  test('P4: authenticated-but-unlinked account gets 404 STUDENT_NOT_LINKED', async () => {
    const res = await get('/students/me', actorA());
    expect(res.statusCode).toBe(404);
    expect(res.body.details.code).toBe('STUDENT_NOT_LINKED');
  });

  test('P4: after linking, the account resolves its own student (200)', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    const res = await get('/students/me', actorA());
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe('std-1');
    expect(res.body.data.userId).toBe('u-actor');
    expect(res.body.data.tenantId).toBe('stu-a');
  });

  test('P4: after unlink, the portal disappears (404 STUDENT_NOT_LINKED)', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    expect((await delLink('std-1', ownerA())).statusCode).toBe(200);
    const res = await get('/students/me', actorA());
    expect(res.statusCode).toBe(404);
    expect(res.body.details.code).toBe('STUDENT_NOT_LINKED');
  });
  test('P4: tenant B owner cannot resolve a student linked in tenant A', async () => {
    const res = await get('/students/me', ownerB());
    expect(res.statusCode).toBe(404);
    expect(res.body.details.code).toBe('STUDENT_NOT_LINKED');
  });

  test('P4: the link endpoint is Owner/Admin only — Viewer and Manager are 403', async () => {
    const asViewer = await request(app)
      .post(BASE + '/students/std-1/link-user')
      .set('Authorization', 'Bearer ' + actorA())
      .send({ userId: 'u-actor' });
    expect(asViewer.statusCode).toBe(403);
    const asManager = await request(app)
      .post(BASE + '/students/std-1/link-user')
      .set('Authorization', 'Bearer ' + managerA())
      .send({ userId: 'u-actor' });
    expect(asManager.statusCode).toBe(403);
  });

  test('P4: one-to-one — student already linked to different account is 409', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    const res = await link('std-1', 'u-owner');
    expect(res.statusCode).toBe(409);
    expect(res.body.details.code).toBe('STUDENT_ALREADY_LINKED');
  });

  test('P4: one-to-one — account already linked to another student is 409', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    const res = await link('std-2', 'u-actor');
    expect(res.statusCode).toBe(409);
    expect(res.body.details.code).toBe('USER_ALREADY_LINKED');
  });

  test('P4: idempotent re-link of the same pair returns 200', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
  });

  test('P4: linking to a nonexistent user is 400', async () => {
    const res = await link('std-1', 'nonexistent-user-id');
    expect(res.statusCode).toBe(400);
  });

  test('P4: payload shape — no GPA, grade, ranking, percentage, payment fields', async () => {
    expect((await link('std-1', 'u-actor')).statusCode).toBe(200);
    const res = await get('/students/me', actorA());
    expect(res.statusCode).toBe(200);
    const d = res.body.data;
    expect(d).toHaveProperty('id');
    expect(d).toHaveProperty('tenantId');
    expect(d).toHaveProperty('studentCode');
    expect(d).toHaveProperty('userId');
    expect(d.tenantId).toBe('stu-a');
    expect(d).not.toHaveProperty('gpa');
    expect(d).not.toHaveProperty('grade');
    expect(d).not.toHaveProperty('ranking');
    expect(d).not.toHaveProperty('percentage');
    expect(d).not.toHaveProperty('payment');
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