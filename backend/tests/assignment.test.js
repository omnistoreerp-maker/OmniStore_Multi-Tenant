'use strict';

// assignment.test.js — EDU-ASG Assignment records: tenant-scoped class-owned
// content with teacher/center/student ownership narrowing.
//
// WHAT IS PINNED HERE. Assignments inherit their class's authorization
// (`education.classes.view` / `education.classes.edit` — no new permission
// strings) and every row is additionally narrowed to the caller's own
// classes, so a grant alone never opens a foreign class's assignments:
//
//   Owner / operator            -> full tenant view (create/read/update/archive)
//   linked teacher              -> own classes only (reads AND writes)
//   linked center               -> own-center classes only
//   linked student (no grants)  -> enrolled classes only, reads only
//   same-tenant foreign rows    -> 403 OWNERSHIP_DENIED (never widened)
//   cross-tenant rows           -> 404 (never leaked)
//   anonymous                   -> 401
//   unlinked grant-less account -> 403 PERMISSION_DENIED
//   student writes              -> 403 (role gate; students are read-only)
//   assignments expose no link-user surface (routes simply do not exist)
//
// The server boots through helpers/testServer with the REAL server.js mount
// order (attachTeacherActor + attachCenterActor + attachStudentActor ->
// requireAuth -> scopedWriteRoleGuard -> requirePermission[OrSelf] ->
// controller -> service). Real JWT, isolated temporary stores, no mocked
// authorization, no mocked storage. Nothing here reads or writes backend/data.

const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const STAMP = '2026-01-01T00:00:00.000Z';
const BASE = '/api/v1/tenant/education';

const companies = [
  { id: 'asg-a', name: 'Assignment Tenant A', code: 'ASA', active: true },
  { id: 'asg-b', name: 'Assignment Tenant B', code: 'ASB', active: true }
];

const VIEW = ['education.classes.view'];
const EDIT = ['education.classes.view', 'education.classes.edit'];

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'asgOwner', password, role: 'Owner', fullName: 'Asg Owner', tenantIds: ['asg-a', 'asg-b'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-t1', username: 'asgTeacher1', password, role: 'Viewer', fullName: 'Teacher One', permissions: EDIT.slice(), tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-t2', username: 'asgTeacher2', password, role: 'Viewer', fullName: 'Teacher Two', permissions: EDIT.slice(), tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-ca1', username: 'asgCenter1', password, role: 'Manager', fullName: 'Center Admin', permissions: EDIT.slice(), tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-s1', username: 'asgStudent1', password, role: 'Viewer', fullName: 'Student One', permissions: [], tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-s2', username: 'asgStudent2', password, role: 'Viewer', fullName: 'Student Two', permissions: [], tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-sg', username: 'asgStudentGrants', password, role: 'Viewer', fullName: 'Student Grants', permissions: EDIT.slice(), tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-unlinked', username: 'asgUnlinked', password, role: 'Viewer', fullName: 'Unlinked', permissions: [], tenantIds: ['asg-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-ob', username: 'asgOwnerB', password, role: 'Owner', fullName: 'Owner B', tenantIds: ['asg-b'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

function seedAll(dir, password) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(password) });
  seed(dir, 'educationCenters', { centers: [
    { id: 'cen-a1', tenantId: 'asg-a', centerCode: 'CA1', name: 'Center A1', status: 'active', userId: 'u-ca1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cen-a2', tenantId: 'asg-a', centerCode: 'CA2', name: 'Center A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cen-b', tenantId: 'asg-b', centerCode: 'CB', name: 'Center B', status: 'active', userId: 'u-ob', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationPrograms', { programs: [
    { id: 'prg-a1', tenantId: 'asg-a', centerId: 'cen-a1', name: 'Track A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'prg-a2', tenantId: 'asg-a', centerId: 'cen-a2', name: 'Track A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'prg-b', tenantId: 'asg-b', centerId: 'cen-b', name: 'Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationCourses', { courses: [
    { id: 'crs-a1', tenantId: 'asg-a', programId: 'prg-a1', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'crs-a2', tenantId: 'asg-a', programId: 'prg-a2', name: 'Course A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'crs-b', tenantId: 'asg-b', programId: 'prg-b', name: 'Course B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationTeachers', { teachers: [
    { id: 'tch-a1', tenantId: 'asg-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'tch-a2', tenantId: 'asg-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', status: 'active', userId: 'u-t2', createdAt: STAMP, updatedAt: STAMP },
    { id: 'tch-b', tenantId: 'asg-b', teacherCode: 'TB', firstName: 'Ben', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationClasses', { classes: [
    { id: 'cls-a1', tenantId: 'asg-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-a2', tenantId: 'asg-a', courseId: 'crs-a2', teacherId: 'tch-a2', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-b', tenantId: 'asg-b', courseId: 'crs-b', teacherId: 'tch-b', classCode: 'CB', name: 'Algebra B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationStudents', { students: [
    { id: 'stu-1', tenantId: 'asg-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-s1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'stu-2', tenantId: 'asg-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', userId: 'u-s2', createdAt: STAMP, updatedAt: STAMP },
    { id: 'stu-g', tenantId: 'asg-a', studentCode: 'SG', firstName: 'Syd', lastName: 'Gee', status: 'active', userId: 'u-sg', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationEnrollments', { enrollments: [
    { id: 'enr-1', tenantId: 'asg-a', studentId: 'stu-1', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP },
    { id: 'enr-2', tenantId: 'asg-a', studentId: 'stu-2', classId: 'cls-a2', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP },
    { id: 'enr-g', tenantId: 'asg-a', studentId: 'stu-g', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP }
  ] });
}

// ---------------------------------------------------------------------------
// Service layer: tenant source, whitelist, parent resolution, lifecycle
// ---------------------------------------------------------------------------
describe('assignment.service — tenant isolation, whitelist, lifecycle', () => {
  const A = { tenantId: 'asg-a' };
  const B = { tenantId: 'asg-b' };
  let dir;
  let service;

  // fileStore pins DIGITRONICS_DATA_DIR at require time, so every test boots
  // a fresh module registry pointed at its own temp dir — exactly the
  // enrollment.test.js service pattern. Nothing here can touch backend/data.
  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('asg-svc');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/assignment.service');
    seed(dir, 'educationClasses', { classes: [
      { id: 'cls-a1', tenantId: 'asg-a', courseId: 'crs-a1', teacherId: 'tch-a1', name: 'Algebra', status: 'active', createdAt: STAMP, updatedAt: STAMP },
      { id: 'cls-arch', tenantId: 'asg-a', courseId: 'crs-a1', teacherId: 'tch-a1', name: 'Old', status: 'archived', createdAt: STAMP, updatedAt: STAMP }
    ] });
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listAssignments(null, {})).toThrow('Tenant context is required');
    expect(() => service.getAssignment(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createAssignment(null, {})).toThrow('Tenant context is required');
    expect(() => service.updateAssignment(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveAssignment(null, 'x')).toThrow('Tenant context is required');
  });

  test('create requires classId and title, stamps the trusted tenant', () => {
    const created = service.createAssignment(A, { classId: 'cls-a1', title: 'Homework 1', description: 'Page 10', dueDate: '2026-03-01' });
    expect(created.tenantId).toBe('asg-a');
    expect(created.classId).toBe('cls-a1');
    expect(created.status).toBe('active');
    expect(() => service.createAssignment(A, { title: 'No class' }))
      .toThrow('classId is required');
    expect(() => service.createAssignment(A, { classId: 'cls-a1' }))
      .toThrow('title is required');
  });

  test('server-owned fields are never writable from client input', () => {
    for (const field of ['tenantId', 'status', 'id']) {
      expect(() => service.createAssignment(A, { classId: 'cls-a1', title: 'T', [field]: 'x' }))
        .toThrow(field + ' is not writable');
    }
  });

  test('a foreign or archived class is refused identically to a missing one', () => {
    // cls-a1 lives in asg-a: from tenant B it must look exactly like noise.
    expect(() => service.createAssignment(B, { classId: 'cls-a1', title: 'Hijack' }))
      .toThrow('classId does not reference a Class in this tenant');
    expect(() => service.createAssignment(A, { classId: 'cls-nope', title: 'Ghost' }))
      .toThrow('classId does not reference a Class in this tenant');
    expect(() => service.createAssignment(A, { classId: 'cls-arch', title: 'Old' }))
      .toThrow('classId must reference a non-archived Class');
  });

  test('due dates must be real calendar dates; update keeps parent and status', () => {
    const created = service.createAssignment(A, { classId: 'cls-a1', title: 'T' });
    expect(() => service.createAssignment(A, { classId: 'cls-a1', title: 'T', dueDate: 'tomorrow' }))
      .toThrow('dueDate must be a real calendar date in YYYY-MM-DD format');
    expect(() => service.createAssignment(A, { classId: 'cls-a1', title: 'T', dueDate: '2026-02-30' }))
      .toThrow('dueDate must be a real calendar date in YYYY-MM-DD format');
    expect(() => service.updateAssignment(A, created.id, { classId: 'cls-a1' }))
      .toThrow('classId cannot be changed');
    const updated = service.updateAssignment(A, created.id, { title: 'T2', dueDate: '2026-04-01' });
    expect(updated.title).toBe('T2');
    expect(updated.classId).toBe('cls-a1');
    expect(updated.status).toBe('active');
    // Cross-tenant reads and writes answer null, never the row.
    expect(service.getAssignment(B, created.id)).toBeNull();
    expect(service.updateAssignment(B, created.id, { title: 'Hijack' })).toBeNull();
    expect(service.archiveAssignment(B, created.id)).toBeNull();
    const archived = service.archiveAssignment(A, created.id);
    expect(archived.status).toBe('archived');
  });
});

// ---------------------------------------------------------------------------
// Route layer: real server, real middleware, real authorization
// ---------------------------------------------------------------------------
describe('assignment routes — ownership matrix over the real stack', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('asg-rt');
    seedAll(dir, bcrypt.hashSync('Pass#123', 10));
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  });

  afterAll(() => {
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
    process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  const token = (id, username, role, tenantId) =>
    jwt.signAccessToken({ id, username, role, tenantId });

  const ownerA = () => token('u-owner', 'asgOwner', 'Owner', 'asg-a');
  const t1 = () => token('u-t1', 'asgTeacher1', 'Viewer', 'asg-a');
  const t2 = () => token('u-t2', 'asgTeacher2', 'Viewer', 'asg-a');
  const ca1 = () => token('u-ca1', 'asgCenter1', 'Manager', 'asg-a');
  const s1 = () => token('u-s1', 'asgStudent1', 'Viewer', 'asg-a');
  const s2 = () => token('u-s2', 'asgStudent2', 'Viewer', 'asg-a');
  const sg = () => token('u-sg', 'asgStudentGrants', 'Viewer', 'asg-a');
  const unlinked = () => token('u-unlinked', 'asgUnlinked', 'Viewer', 'asg-a');
  const ownerB = () => token('u-ob', 'asgOwnerB', 'Owner', 'asg-b');

  const get = (p, tok) => {
    const req = request(app).get(`${BASE}${p}`);
    return tok ? req.set('Authorization', `Bearer ${tok}`) : req;
  };
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const patch = (p, tok, body) =>
    request(app).patch(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const ids = (res) => (res.body.data || []).map((r) => r.id).sort();
  const denied403 = (res) => {
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
  };

  test('anonymous is 401 everywhere; unlinked grant-less reads are 403', async () => {
    expect((await get('/assignments', null)).statusCode).toBe(401);
    expect((await get('/assignments', unlinked())).statusCode).toBe(403);
    expect((await post('/assignments', unlinked(), { classId: 'cls-a1', title: 'X' })).statusCode).toBe(403);
  });

  test('operator creates, reads, updates and archives in its own tenant', async () => {
    const created = await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'Homework 1', dueDate: '2026-03-01' });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('asg-a');
    const id = created.body.data.id;
    expect((await get(`/assignments/${id}`, ownerA())).statusCode).toBe(200);
    const updated = await put(`/assignments/${id}`, ownerA(), { title: 'Homework 1b' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.title).toBe('Homework 1b');
    const archived = await patch(`/assignments/${id}/archive`, ownerA());
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  test('client tenantId is ignored, never stamped', async () => {
    const created = await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'T', tenantId: 'asg-b' });
    expect(created.statusCode).toBe(400);
    expect(String(created.body.message)).toMatch(/not writable/i);
  });

  test('linked teacher manages own classes only', async () => {
    const own = await post('/assignments', t1(), { classId: 'cls-a1', title: 'Own Work' });
    expect(own.statusCode).toBe(201);
    expect(ids(await get('/assignments', t1()))).toEqual([own.body.data.id]);
    // A known class of the other teacher is refused, never created.
    const foreign = await post('/assignments', t1(), { classId: 'cls-a2', title: 'Hijack' });
    expect(foreign.statusCode).toBe(403);
    expect(ids(await get('/assignments', t1()))).toEqual([own.body.data.id]);
    denied403(await get(`/assignments/${own.body.data.id}`, t2()));
    denied403(await put(`/assignments/${own.body.data.id}`, t2(), { title: 'Hijack' }));
    denied403(await patch(`/assignments/${own.body.data.id}/archive`, t2()));
  });

  test('linked center sees only its own center classes', async () => {
    const own = await post('/assignments', ca1(), { classId: 'cls-a1', title: 'Center Work' });
    expect(own.statusCode).toBe(201);
    expect(ids(await get('/assignments', ca1()))).toEqual([own.body.data.id]);
    expect((await post('/assignments', ca1(), { classId: 'cls-a2', title: 'Hijack' })).statusCode).toBe(403);
  });

  test('linked students read only their enrolled classes, even with grants', async () => {
    const a1 = await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'For A1' });
    const a2 = await post('/assignments', ownerA(), { classId: 'cls-a2', title: 'For A2' });
    expect(ids(await get('/assignments', s1()))).toEqual([a1.body.data.id]);
    expect(ids(await get('/assignments', s2()))).toEqual([a2.body.data.id]);
    expect(ids(await get('/assignments', sg()))).toEqual([a1.body.data.id]);
    expect((await get(`/assignments/${a1.body.data.id}`, s1())).statusCode).toBe(200);
    denied403(await get(`/assignments/${a2.body.data.id}`, s1()));
    // Students never write, grants or not.
    expect((await post('/assignments', s1(), { classId: 'cls-a1', title: 'X' })).statusCode).toBe(403);
    expect((await put(`/assignments/${a1.body.data.id}`, sg(), { title: 'X' })).statusCode).toBe(403);
  });

  test('cross-tenant rows are 404 and tenant B is fully separate', async () => {
    const a1 = await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'For A1' });
    const b1 = await post('/assignments', ownerB(), { classId: 'cls-b', title: 'For B' });
    expect((await get(`/assignments/${a1.body.data.id}`, ownerB())).statusCode).toBe(404);
    expect((await get(`/assignments/${b1.body.data.id}`, ownerA())).statusCode).toBe(404);
    expect(ids(await get('/assignments', ownerB()))).toEqual([b1.body.data.id]);
    expect((await put(`/assignments/${a1.body.data.id}`, ownerB(), { title: 'Hijack' })).statusCode).toBe(404);
  });

  test('assignments expose no link-user surface', async () => {
    const a1 = await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'For A1' });
    expect((await post(`/assignments/${a1.body.data.id}/link-user`, ownerA(), { userId: 'u-s1' })).statusCode).toBe(404);
  });
});
