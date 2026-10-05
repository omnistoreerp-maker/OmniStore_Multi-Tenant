'use strict';

// teacherEducationAuthorization.test.js — P0 Teacher education workflow.
//
// WHAT WAS BROKEN. `TEACHER_OWNED_EDUCATION_SURFACES` covered bookings,
// ratings, classes, scheduling and enrollments but NOT attendance and grading,
// and the student/attendance/grading controllers carried no `teacherActor`
// enforcement at all. Every attendance/grading write therefore died on the
// global scopedWriteRoleGuard ('Owner','Admin','Manager') with 403, so a linked
// Teacher could never record a register or a mark — while a Teacher who DID
// get through would have seen every Student, attendance row and grade in the
// tenant.
//
// WHAT IS PINNED HERE.
//   A. TEACHER ALLOW — a linked teacher holding the registered
//      education.* grants reads/writes their OWN attendance, their OWN grades
//      and their OWN students.
//   B. OWNERSHIP — the same teacher is refused (403 OWNERSHIP_DENIED) on every
//      row, enrollment and student belonging to ANOTHER teacher, and every
//      list is force-scoped so a query filter can narrow but never widen it.
//   C. TENANT ISOLATION — a row, enrollment or student of another tenant is
//      absent (404) for reads and refused (403) for writes, and a foreign
//      tenant's data never appears in a scoped list. 404 still wins over 403 so
//      existence never leaks across tenants.
//   D. NEGATIVE RBAC — a linked Student account holding the .edit grants is
//      refused every attendance/grading mutation by the role gate; a linked
//      teacher with NO grants is refused by the permission gate; an UNLINKED
//      permission-holder is refused by the role gate.
//   E. REGRESSION — Owner, Admin and Manager keep exactly the tenant-wide
//      behaviour they had. `students` stays OFF the teacher write bypass, so a
//      linked teacher still cannot create or archive a student.
//   F. /tenant — tenant add-ons and custom domains are Owner/Admin only; a
//      linked Teacher and a linked Student are refused 403.
//
// The server boots through helpers/testServer with the REAL server.js mount
// order (authMiddleware -> attachTeacherActor -> requireAuth ->
// scopedWriteRoleGuard -> requirePermission -> controller -> service).
// Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const STAMP = '2026-01-01T00:00:00.000Z';
const BASE = '/api/v1/tenant/education';

const dayOffset = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);

const companies = [
  { id: 'tea-a', name: 'Tea Tenant A', code: 'TEAA', active: true },
  { id: 'tea-b', name: 'Tea Tenant B', code: 'TEAB', active: true }
];

// The registered education grants used by every operator/teacher account below.
// NO new permission strings are introduced: these are all P1-registered in
// backend/permissions/registry.js.
const EDU = [
  'education.attendance.view', 'education.attendance.edit',
  'education.grading.view', 'education.grading.edit',
  'education.students.view', 'education.students.edit'
];

function userRecords(password) {
  const stamp = STAMP;
  return [
    {
      id: 'u-owner', username: 'teaOwner', password, role: 'Owner',
      fullName: 'Tea Owner', tenantIds: ['tea-a', 'tea-b'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-admin', username: 'teaAdmin', password, role: 'Admin',
      fullName: 'Tea Admin', tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'teaManager', password, role: 'Manager',
      fullName: 'Tea Manager', permissions: [...EDU], tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to tch-a1 — a Teacher identity, Viewer role, holding the
      // registered grants. Not Owner/Admin/Manager: everything it is allowed
      // to do must come from the teacher bypass + ownership rules.
      id: 'u-t1', username: 'teaTeacher1', password, role: 'Viewer',
      fullName: 'Teacher One', permissions: [...EDU], tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to tch-a2 — proves cross-teacher 403s inside the same tenant.
      id: 'u-t2', username: 'teaTeacher2', password, role: 'Viewer',
      fullName: 'Teacher Two', permissions: [...EDU], tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to tch-a3 but holding NO education grant: the identity bypass
      // must never substitute for the route permission.
      id: 'u-t3', username: 'teaTeacher3', password, role: 'Viewer',
      fullName: 'Teacher Three', permissions: [], tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // UNLINKED but holding every grant: the role gate must still refuse.
      id: 'u-clerk', username: 'teaClerk', password, role: 'Viewer',
      fullName: 'Tea Clerk', permissions: [...EDU], tenantIds: ['tea-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED as a STUDENT (stu-a1.userId). It holds the .edit grants so a
      // refusal can only come from the role gate, never from a missing grant.
      id: 'u-student', username: 'teaStudent', password, role: 'Viewer',
      fullName: 'Tea Student',
      permissions: ['education.attendance.edit', 'education.grading.edit'],
      tenantIds: ['tea-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED teacher of tenant B — the cross-tenant counterpart.
      id: 'u-tb', username: 'teaTeacherB', password, role: 'Viewer',
      fullName: 'Teacher B', permissions: [...EDU], tenantIds: ['tea-b'],
      createdAt: stamp, updatedAt: stamp
    }
  ];
}

const teachers = [
  { id: 'tch-a1', tenantId: 'tea-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', displayName: 'Ann One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a2', tenantId: 'tea-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', displayName: 'Bob Two', status: 'active', userId: 'u-t2', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a3', tenantId: 'tea-a', teacherCode: 'TA3', firstName: 'Cara', lastName: 'Three', displayName: 'Cara Three', status: 'active', userId: 'u-t3', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-b1', tenantId: 'tea-b', teacherCode: 'TB1', firstName: 'Ben', lastName: 'Bee', displayName: 'Ben Bee', status: 'active', userId: 'u-tb', createdAt: STAMP, updatedAt: STAMP }
];

const programs = [
  { id: 'prg-a', tenantId: 'tea-a', name: 'English Track', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-b', tenantId: 'tea-b', name: 'English Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const courses = [
  { id: 'crs-a', tenantId: 'tea-a', programId: 'prg-a', name: 'Grammar 101', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-b', tenantId: 'tea-b', programId: 'prg-b', name: 'Grammar B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const students = [
  { id: 'stu-a1', tenantId: 'tea-a', studentCode: 'SA1', firstName: 'Sara', lastName: 'One', displayName: 'Sara One', status: 'active', userId: 'u-student', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-a4', tenantId: 'tea-a', studentCode: 'SA4', firstName: 'Nour', lastName: 'Four', displayName: 'Nour Four', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-a2', tenantId: 'tea-a', studentCode: 'SA2', firstName: 'Sam', lastName: 'Two', displayName: 'Sam Two', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-a3', tenantId: 'tea-a', studentCode: 'SA3', firstName: 'Syd', lastName: 'Three', displayName: 'Syd Three', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  // Enrolled in NO class at all: reachable by operators, by no teacher.
  { id: 'stu-a5', tenantId: 'tea-a', studentCode: 'SA5', firstName: 'Ung', lastName: 'Five', displayName: 'Ung Five', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-b1', tenantId: 'tea-b', studentCode: 'SB1', firstName: 'Bea', lastName: 'Bee', displayName: 'Bea Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const classes = [
  { id: 'cls-a1', tenantId: 'tea-a', courseId: 'crs-a', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a2', tenantId: 'tea-a', courseId: 'crs-a', teacherId: 'tch-a2', classCode: 'CA2', name: 'Geometry', displayName: 'Geometry', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a3', tenantId: 'tea-a', courseId: 'crs-a', teacherId: 'tch-a3', classCode: 'CA3', name: 'History', displayName: 'History', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-b', tenantId: 'tea-b', courseId: 'crs-b', teacherId: 'tch-b1', classCode: 'CB', name: 'Algebra B', displayName: 'Algebra B', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const enrolledAgo30 = dayOffset(-30) + 'T09:00:00.000Z';

const enrollments = [
  { id: 'enr-a1', tenantId: 'tea-a', studentId: 'stu-a1', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-a1b', tenantId: 'tea-a', studentId: 'stu-a4', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-a2', tenantId: 'tea-a', studentId: 'stu-a2', classId: 'cls-a2', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-a3', tenantId: 'tea-a', studentId: 'stu-a3', classId: 'cls-a3', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-b', tenantId: 'tea-b', studentId: 'stu-b1', classId: 'cls-b', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 }
];

const attendance = [
  { id: 'att-a1', tenantId: 'tea-a', enrollmentId: 'enr-a1', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-a1b', tenantId: 'tea-a', enrollmentId: 'enr-a1b', attendanceDate: dayOffset(-8), status: 'absent', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-a2', tenantId: 'tea-a', enrollmentId: 'enr-a2', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-a3', tenantId: 'tea-a', enrollmentId: 'enr-a3', attendanceDate: dayOffset(-10), status: 'late', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-b', tenantId: 'tea-b', enrollmentId: 'enr-b', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

// enr-a1b deliberately carries NO grade: it is the row through which a teacher,
// the Owner, the Admin and the Manager exercise a grading CREATE.
const grades = [
  { id: 'grd-a1', tenantId: 'tea-a', enrollmentId: 'enr-a1', gradingDate: dayOffset(-9), grade: 'B', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grd-a2', tenantId: 'tea-a', enrollmentId: 'enr-a2', gradingDate: dayOffset(-9), grade: 'C', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grd-b', tenantId: 'tea-b', enrollmentId: 'enr-b', gradingDate: dayOffset(-9), grade: 'A', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationEnrollments', { enrollments });
  seed(dir, 'educationAttendance', { attendance });
  seed(dir, 'educationGrading', { grades });
}

describe('P0 Teacher education authorization — attendance, grading and student read scope', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('tea-p0');
    seedAll(dir);
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  });

  afterAll(() => {
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
    process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  const token = (id, username, role, tenantId) =>
    jwt.signAccessToken({ id, username, role, tenantId });

  const ownerTok = () => token('u-owner', 'teaOwner', 'Owner', 'tea-a');
  const adminTok = () => token('u-admin', 'teaAdmin', 'Admin', 'tea-a');
  const managerTok = () => token('u-manager', 'teaManager', 'Manager', 'tea-a');
  const t1 = () => token('u-t1', 'teaTeacher1', 'Viewer', 'tea-a');
  const t2 = () => token('u-t2', 'teaTeacher2', 'Viewer', 'tea-a');
  const t3 = () => token('u-t3', 'teaTeacher3', 'Viewer', 'tea-a');
  const clerk = () => token('u-clerk', 'teaClerk', 'Viewer', 'tea-a');
  const student = () => token('u-student', 'teaStudent', 'Viewer', 'tea-a');
  const tB = () => token('u-tb', 'teaTeacherB', 'Viewer', 'tea-b');

  const get = (p, tok) => request(app).get(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`);
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const patch = (p, tok) =>
    request(app).patch(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`);

  const ids = (res) => (res.body.data || []).map((r) => r.id);
  const attendanceStore = () => (readStore(dir, 'educationAttendance') || { attendance: [] }).attendance;
  const gradesStore = () => (readStore(dir, 'educationGrading') || { grades: [] }).grades;

  // ---------------------------------------------------------------------------
  // A. TEACHER ALLOW — own attendance, own grading, own student read
  // ---------------------------------------------------------------------------

  test('A1. a linked teacher reads and writes their OWN attendance', async () => {
    const list = await get('/attendance', t1());
    expect(list.statusCode).toBe(200);
    expect(ids(list)).toEqual(['att-a1', 'att-a1b']);

    expect((await get('/attendance/att-a1', t1())).statusCode).toBe(200);

    const created = await post('/attendance', t1(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'late'
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('tea-a');
    expect(created.body.data.enrollmentId).toBe('enr-a1');

    const updated = await put('/attendance/att-a1', t1(), { status: 'absent', notes: 'doctor note' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.status).toBe('absent');

    const bulk = await post('/attendance/bulk', t1(), {
      attendanceDate: dayOffset(-6),
      entries: [
        { enrollmentId: 'enr-a1', status: 'present' },
        { enrollmentId: 'enr-a1b', status: 'absent' }
      ]
    });
    expect(bulk.statusCode).toBe(201);
    // 5 seeded + 1 single create + 2 bulk entries.
    expect(attendanceStore()).toHaveLength(8);
  });

  test('A2. a linked teacher reads and writes their OWN grading', async () => {
    const list = await get('/grading', t1());
    expect(list.statusCode).toBe(200);
    expect(ids(list)).toEqual(['grd-a1']);

    expect((await get('/grading/grd-a1', t1())).statusCode).toBe(200);

    const created = await post('/grading', t1(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'A'
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('tea-a');
    expect(created.body.data.enrollmentId).toBe('enr-a1b');

    const updated = await put('/grading/grd-a1', t1(), { grade: 'A', notes: 're-marked' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.grade).toBe('A');
    expect(gradesStore()).toHaveLength(4);
  });

  test('A3. a linked teacher reads ONLY their own students', async () => {
    const list = await get('/students', t1());
    expect(list.statusCode).toBe(200);
    expect(ids(list).sort()).toEqual(['stu-a1', 'stu-a4']);

    expect((await get('/students/stu-a1', t1())).statusCode).toBe(200);
    expect((await get('/students/stu-a4/progress', t1())).statusCode).toBe(200);

    // The second linked teacher has the mirror-image scope.
    const theirs = await get('/students', t2());
    expect(ids(theirs)).toEqual(['stu-a2']);
    expect((await get('/students/stu-a2', t2())).statusCode).toBe(200);
  });

  test('A4. a query filter narrows a linked teacher list but never widens it', async () => {
    // Another teacher's class / student answers an EMPTY list, not their rows.
    expect(ids(await get('/attendance?classId=cls-a2', t1()))).toEqual([]);
    expect(ids(await get('/attendance?studentId=stu-a2', t1()))).toEqual([]);
    expect(ids(await get('/grading?classId=cls-a2', t1()))).toEqual([]);
    // Free-text search runs BEFORE the force-scope, so it can only narrow.
    expect(ids(await get('/students?search=Sam', t1()))).toEqual([]);
    // ...and it still finds their own students.
    expect(ids(await get('/students?search=Sara', t1()))).toEqual(['stu-a1']);
  });

  // ---------------------------------------------------------------------------
  // B. OWNERSHIP — another teacher's rows are refused
  // ---------------------------------------------------------------------------

  test('B1. attendance: another teacher is 403, unknown/cross-tenant is 404', async () => {
    const other = await get('/attendance/att-a2', t1());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    expect((await get('/attendance/att-b', t1())).statusCode).toBe(404);
    expect((await get('/attendance/att-nope', t1())).statusCode).toBe(404);
    expect((await put('/attendance/att-b', t1(), { status: 'absent' })).statusCode).toBe(404);
    expect((await put('/attendance/att-nope', t1(), { status: 'absent' })).statusCode).toBe(404);

    const foreign = await put('/attendance/att-a2', t1(), { status: 'absent', notes: 'hijack' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.details.code).toBe('OWNERSHIP_DENIED');
    const untouched = attendanceStore().find((r) => r.id === 'att-a2');
    expect(untouched.status).toBe('present');
    expect(untouched.notes).toBe('');
  });

  test('B2. grading: another teacher is 403, unknown/cross-tenant is 404', async () => {
    const other = await get('/grading/grd-a2', t1());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    expect((await get('/grading/grd-b', t1())).statusCode).toBe(404);
    expect((await get('/grading/grd-nope', t1())).statusCode).toBe(404);
    expect((await put('/grading/grd-b', t1(), { grade: 'Z' })).statusCode).toBe(404);

    const foreign = await put('/grading/grd-a2', t1(), { grade: 'Z' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(gradesStore().find((r) => r.id === 'grd-a2').grade).toBe('C');
  });

  test('B3. a teacher cannot WRITE into another teacher class', async () => {
    const att = await post('/attendance', t1(), {
      enrollmentId: 'enr-a2', attendanceDate: dayOffset(-5), status: 'present'
    });
    expect(att.statusCode).toBe(403);
    expect(att.body.details.code).toBe('OWNERSHIP_DENIED');

    const grd = await post('/grading', t1(), {
      enrollmentId: 'enr-a2', gradingDate: TODAY, grade: 'A'
    });
    expect(grd.statusCode).toBe(403);
    expect(grd.body.details.code).toBe('OWNERSHIP_DENIED');

    // A third teacher's class is refused identically.
    expect((await post('/attendance', t1(), {
      enrollmentId: 'enr-a3', attendanceDate: dayOffset(-5), status: 'present'
    })).statusCode).toBe(403);
    expect((await post('/grading', t1(), {
      enrollmentId: 'enr-a3', gradingDate: TODAY, grade: 'A'
    })).statusCode).toBe(403);

    // Nothing was persisted in either tenant.
    expect(attendanceStore()).toHaveLength(5);
    expect(gradesStore()).toHaveLength(3);
  });

  test('B4. a bulk register containing one foreign entry is refused whole', async () => {
    const before = JSON.stringify(attendanceStore());
    const res = await post('/attendance/bulk', t1(), {
      attendanceDate: dayOffset(-6),
      entries: [
        { enrollmentId: 'enr-a1', status: 'present' },
        { enrollmentId: 'enr-a2', status: 'absent' }
      ]
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(JSON.stringify(attendanceStore())).toBe(before);
  });

  test('B5. student reads: another teacher student and a foreign tenant are refused', async () => {
    const other = await get('/students/stu-a2', t1());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    // Enrolled in a class taught by nobody the caller teaches.
    expect((await get('/students/stu-a3', t1())).statusCode).toBe(403);
    // Not enrolled anywhere: reachable by operators, by no teacher.
    expect((await get('/students/stu-a5', t1())).statusCode).toBe(403);
    expect((await get('/students/stu-a2/progress', t1())).statusCode).toBe(403);

    // Cross-tenant stays a 404 — existence never leaks.
    expect((await get('/students/stu-b1', t1())).statusCode).toBe(404);
    expect((await get('/students/stu-nope', t1())).statusCode).toBe(404);
  });

  test('B6. `students` is still NOT on the teacher write bypass', async () => {
    // u-t1 HOLDS education.students.edit, so only the role gate can refuse.
    const created = await post('/students', t1(), { firstName: 'Nope', lastName: 'Way' });
    expect(created.statusCode).toBe(403);
    expect(created.body.message).toBe('Insufficient role');

    const archived = await patch('/students/stu-a1/archive', t1());
    expect(archived.statusCode).toBe(403);
    expect(archived.body.message).toBe('Insufficient role');

    expect(readStore(dir, 'educationStudents').students).toHaveLength(6);
    expect(readStore(dir, 'educationStudents').students.find((s) => s.id === 'stu-a1').status)
      .toBe('active');
  });

  // ---------------------------------------------------------------------------
  // C. TENANT ISOLATION
  // ---------------------------------------------------------------------------

  test('C1. a teacher never sees another tenant rows, in lists or by id', async () => {
    expect(ids(await get('/attendance', t1()))).not.toContain('att-b');
    expect(ids(await get('/grading', t1()))).not.toContain('grd-b');
    expect(ids(await get('/students', t1()))).not.toContain('stu-b1');

    // The tenant-B teacher sees exactly the mirror image.
    const bList = await get('/attendance', tB());
    expect(ids(bList)).toEqual(['att-b']);
    expect(ids(await get('/students', tB()))).toEqual(['stu-b1']);
    expect((await get('/students/stu-a1', tB())).statusCode).toBe(404);
    expect((await get('/attendance/att-a1', tB())).statusCode).toBe(404);
    expect((await get('/grading/grd-a1', tB())).statusCode).toBe(404);
  });

  test('C2. a teacher cannot WRITE a foreign tenant enrollment or row', async () => {
    const att = await post('/attendance', t1(), {
      enrollmentId: 'enr-b', attendanceDate: dayOffset(-5), status: 'present'
    });
    expect(att.statusCode).toBe(403);
    expect(att.body.details.code).toBe('OWNERSHIP_DENIED');

    const grd = await post('/grading', t1(), {
      enrollmentId: 'enr-b', gradingDate: TODAY, grade: 'A'
    });
    expect(grd.statusCode).toBe(403);
    expect(grd.body.details.code).toBe('OWNERSHIP_DENIED');

    // Reads of the foreign rows are absent, not forbidden.
    expect((await get('/attendance/att-b', t1())).statusCode).toBe(404);
    expect((await put('/attendance/att-b', t1(), { status: 'absent' })).statusCode).toBe(404);
    expect((await put('/grading/grd-b', t1(), { grade: 'Z' })).statusCode).toBe(404);

    // Neither tenant gained a row.
    expect(attendanceStore()).toHaveLength(5);
    expect(gradesStore()).toHaveLength(3);
    expect(attendanceStore().find((r) => r.id === 'att-b').status).toBe('present');
    expect(gradesStore().find((r) => r.id === 'grd-b').grade).toBe('A');
  });

  // ---------------------------------------------------------------------------
  // D. NEGATIVE RBAC
  // ---------------------------------------------------------------------------

  test('D1. a linked STUDENT is refused every attendance mutation', async () => {
    // The account HOLDS education.attendance.edit, so the only thing that can
    // refuse it is the Owner/Admin/Manager role gate.
    const create = await post('/attendance', student(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'present'
    });
    expect(create.statusCode).toBe(403);
    expect(create.body.message).toBe('Insufficient role');

    const update = await put('/attendance/att-a1', student(), { status: 'absent' });
    expect(update.statusCode).toBe(403);
    expect(update.body.message).toBe('Insufficient role');

    const bulk = await post('/attendance/bulk', student(), {
      attendanceDate: dayOffset(-6),
      entries: [{ enrollmentId: 'enr-a1', status: 'present' }]
    });
    expect(bulk.statusCode).toBe(403);
    expect(bulk.body.message).toBe('Insufficient role');

    expect(attendanceStore()).toHaveLength(5);
    expect(attendanceStore().find((r) => r.id === 'att-a1').status).toBe('present');
  });

  test('D2. a linked STUDENT is refused every grading mutation', async () => {
    const create = await post('/grading', student(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'A'
    });
    expect(create.statusCode).toBe(403);
    expect(create.body.message).toBe('Insufficient role');

    const update = await put('/grading/grd-a1', student(), { grade: 'Z' });
    expect(update.statusCode).toBe(403);
    expect(update.body.message).toBe('Insufficient role');

    expect(gradesStore()).toHaveLength(3);
    expect(gradesStore().find((r) => r.id === 'grd-a1').grade).toBe('B');
  });

  test('D3. a linked teacher WITHOUT the grants is refused by the permission gate', async () => {
    // The identity bypass gets u-t3 past the role gate; the route permission
    // then refuses it. The bypass never substitutes for a grant.
    const read = await get('/attendance', t3());
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const write = await post('/attendance', t3(), {
      enrollmentId: 'enr-a3', attendanceDate: dayOffset(-5), status: 'present'
    });
    expect(write.statusCode).toBe(403);
    expect(write.body.details.code).toBe('PERMISSION_DENIED');

    expect((await get('/grading', t3())).statusCode).toBe(403);
    expect((await post('/grading', t3(), {
      enrollmentId: 'enr-a3', gradingDate: TODAY, grade: 'A'
    })).statusCode).toBe(403);
    expect((await get('/students', t3())).statusCode).toBe(403);

    expect(attendanceStore()).toHaveLength(5);
    expect(gradesStore()).toHaveLength(3);
  });

  test('D4. an UNLINKED permission-holder is refused every write by the role gate', async () => {
    const att = await post('/attendance', clerk(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'present'
    });
    expect(att.statusCode).toBe(403);
    expect(att.body.message).toBe('Insufficient role');

    const grd = await post('/grading', clerk(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'A'
    });
    expect(grd.statusCode).toBe(403);
    expect(grd.body.message).toBe('Insufficient role');

    const upd = await put('/attendance/att-a1', clerk(), { status: 'absent' });
    expect(upd.statusCode).toBe(403);
    expect(upd.body.message).toBe('Insufficient role');

    expect(attendanceStore()).toHaveLength(5);
    expect(gradesStore()).toHaveLength(3);
  });

  test('D5. anonymous traffic is refused on all three surfaces', async () => {
    expect((await request(app).get(`${BASE}/attendance`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/attendance`).send({})).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/grading`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/grading`).send({})).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/students`)).statusCode).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // E. REGRESSION — Owner / Admin / Manager are unchanged
  // ---------------------------------------------------------------------------

  test('E1. Owner keeps full tenant-wide read and write', async () => {
    const list = await get('/attendance', ownerTok());
    expect(list.statusCode).toBe(200);
    expect(ids(list).sort()).toEqual(['att-a1', 'att-a1b', 'att-a2', 'att-a3']);

    // Unscoped: another teacher's rows stay readable.
    expect((await get('/attendance/att-a2', ownerTok())).statusCode).toBe(200);
    expect((await get('/grading/grd-a2', ownerTok())).statusCode).toBe(200);
    expect((await get('/students/stu-a2', ownerTok())).statusCode).toBe(200);
    expect(ids(await get('/students', ownerTok())).sort())
      .toEqual(['stu-a1', 'stu-a2', 'stu-a3', 'stu-a4', 'stu-a5']);

    expect((await post('/attendance', ownerTok(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'present'
    })).statusCode).toBe(201);
    expect((await post('/grading', ownerTok(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'B'
    })).statusCode).toBe(201);
    expect((await post('/students', ownerTok(), { firstName: 'New', lastName: 'Kid' })).statusCode).toBe(201);
  });

  test('E2. Admin keeps full tenant-wide read and write', async () => {
    expect((await get('/attendance', adminTok())).statusCode).toBe(200);
    expect((await get('/attendance/att-a2', adminTok())).statusCode).toBe(200);
    expect((await get('/grading/grd-a2', adminTok())).statusCode).toBe(200);
    expect((await get('/students/stu-a2', adminTok())).statusCode).toBe(200);

    expect((await post('/attendance', adminTok(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'absent'
    })).statusCode).toBe(201);
    expect((await post('/grading', adminTok(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'C'
    })).statusCode).toBe(201);
    expect((await post('/students', adminTok(), { firstName: 'New', lastName: 'Kid' })).statusCode).toBe(201);
    expect((await patch('/students/stu-a5/archive', adminTok())).statusCode).toBe(200);
  });

  test('E3. Manager keeps its existing education behaviour', async () => {
    // Manager passes the role gate and holds the grants: reads AND writes work
    // exactly as they did before the teacher work.
    expect((await get('/attendance', managerTok())).statusCode).toBe(200);
    expect((await get('/grading', managerTok())).statusCode).toBe(200);
    expect((await get('/students', managerTok())).statusCode).toBe(200);
    expect((await get('/attendance/att-a2', managerTok())).statusCode).toBe(200);

    expect((await post('/attendance', managerTok(), {
      enrollmentId: 'enr-a1', attendanceDate: dayOffset(-5), status: 'present'
    })).statusCode).toBe(201);
    expect((await post('/grading', managerTok(), {
      enrollmentId: 'enr-a1b', gradingDate: TODAY, grade: 'B'
    })).statusCode).toBe(201);
    expect((await post('/students', managerTok(), { firstName: 'New', lastName: 'Kid' })).statusCode).toBe(201);
  });
});

describe('P0 /tenant — add-ons and custom domains are Owner/Admin only', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('tea-p0-tenant');
    seedAll(dir);
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  });

  afterAll(() => {
    process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
  });

  const token = (id, username, role, tenantId) =>
    jwt.signAccessToken({ id, username, role, tenantId });

  const owner = () => token('u-owner', 'teaOwner', 'Owner', 'tea-a');
  const admin = () => token('u-admin', 'teaAdmin', 'Admin', 'tea-a');
  const teacher = () => token('u-t1', 'teaTeacher1', 'Viewer', 'tea-a');
  const linkedStudent = () => token('u-student', 'teaStudent', 'Viewer', 'tea-a');
  const viewer = () => token('u-clerk', 'teaClerk', 'Viewer', 'tea-a');

  const call = (method, p, tok, body) => {
    const req = request(app)[method](`/api/v1/tenant${p}`);
    if (tok) req.set('Authorization', `Bearer ${tok}`);
    return body === undefined ? req : req.send(body);
  };

  test('anonymous is still refused with 401', async () => {
    expect((await call('get', '/addons')).statusCode).toBe(401);
    expect((await call('post', '/addons', null, { addon_key: 'starter' })).statusCode).toBe(401);
    expect((await call('get', '/custom-domains')).statusCode).toBe(401);
  });

  test('a linked Teacher cannot read or modify tenant add-ons / domains', async () => {
    expect((await call('get', '/addons', teacher())).statusCode).toBe(403);
    expect((await call('post', '/addons', teacher(), { addon_key: 'starter', status: 'active' })).statusCode).toBe(403);
    expect((await call('delete', '/addons/starter', teacher())).statusCode).toBe(403);
    expect((await call('get', '/custom-domains', teacher())).statusCode).toBe(403);
    expect((await call('post', '/custom-domains', teacher(), { custom_domain: 'x.example' })).statusCode).toBe(403);
  });

  test('a linked Student and a plain Viewer are refused too', async () => {
    expect((await call('post', '/addons', linkedStudent(), { addon_key: 'starter' })).statusCode).toBe(403);
    expect((await call('post', '/addons', viewer(), { addon_key: 'starter' })).statusCode).toBe(403);
    expect((await call('post', '/custom-domains', viewer(), { custom_domain: 'x.example' })).statusCode).toBe(403);
  });

  test('Owner and Admin keep the surface', async () => {
    const up = await call('post', '/addons', owner(), { addon_key: 'starter', status: 'active' });
    expect(up.statusCode).toBe(200);
    expect(up.body.data.tenantId).toBe('tea-a');

    expect((await call('get', '/addons', admin())).statusCode).toBe(200);
    expect((await call('delete', '/addons/starter', owner())).statusCode).toBe(200);

    const reg = await call('post', '/custom-domains', admin(), { custom_domain: 'shop.tea-a.example' });
    expect(reg.statusCode).toBe(200);
    expect(reg.body.data.tenantId).toBe('tea-a');
  });
});
