'use strict';

// studentSelfScope.test.js — Phase 2A Student authorization foundation.
//
// Pins the learner portal contract: ANONYMOUS -> 401; UNLINKED -> 404/403;
// LINKED -> SELF scope ONLY with NO operator grant; horizontal reads -> 403
// same-tenant / 404 cross-tenant (404-before-403); query tampering narrows,
// never widens; writes refused by the role gate even with every .edit grant;
// link-user stays Owner/Admin; attachStudentActor ignores client identity.
// Boots the REAL server.js mount order; never touches backend/data.

const fs = require('fs');
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
const dayOffset = (n) =>
  new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

const companies = [
  { id: 'sps-a', name: 'Self Tenant A', code: 'SPSA', active: true },
  { id: 'sps-b', name: 'Self Tenant B', code: 'SPSB', active: true }
];

// P1-registered grants ONLY — no new permission strings are introduced.
const EDU_VIEW = [
  'education.students.view', 'education.enrollments.view',
  'education.attendance.view', 'education.grading.view',
  'education.scheduling.view', 'education.classes.view'
];
const EDU_WRITE = [
  'education.students.edit', 'education.enrollments.edit',
  'education.attendance.edit', 'education.grading.edit',
  'education.scheduling.edit', 'education.classes.edit'
];

function userRecords(password) {
  const stamp = STAMP;
  return [
    {
      id: 'u-owner', username: 'spsOwner', password, role: 'Owner',
      fullName: 'Sps Owner', tenantIds: ['sps-a', 'sps-b'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to sps-stu1, NO grants: only SELF scope can ever allow reads.
      id: 'u-s1', username: 'spsStudent1', password, role: 'Viewer',
      fullName: 'Student One', permissions: [], tenantIds: ['sps-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to sps-stu2 — horizontal counterpart in the SAME tenant.
      id: 'u-s2', username: 'spsStudent2', password, role: 'Viewer',
      fullName: 'Student Two', permissions: [], tenantIds: ['sps-a'],
      createdAt: stamp, updatedAt: stamp
    }
  ];
}

// Tail of the account list (kept separate so no single edit is too large).
function userTail(password) {
  const stamp = STAMP;
  return [
    {
      // LINKED to sps-stuB in tenant B — cross-tenant counterpart.
      id: 'u-s1b', username: 'spsStudentB', password, role: 'Viewer',
      fullName: 'Student B', permissions: [], tenantIds: ['sps-b'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // AUTHENTICATED but UNLINKED and grant-less: must fail closed.
      id: 'u-unlinked', username: 'spsUnlinked', password, role: 'Viewer',
      fullName: 'Unlinked User', permissions: [], tenantIds: ['sps-a'],
      createdAt: stamp, updatedAt: stamp
    },
    {
      // UNLINKED but holding every READ grant: the operator permission path
      // must stay tenant-wide — the self scope must not leak into it.
      id: 'u-op', username: 'spsOperator', password, role: 'Viewer',
      fullName: 'Sps Operator', permissions: EDU_VIEW.slice(),
      tenantIds: ['sps-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // LINKED to sps-stu3 AND holding every view+edit grant: reads stay
      // narrowed to SELF despite grants; writes still refused by role gate.
      id: 'u-edit', username: 'spsStudentEdit', password, role: 'Viewer',
      fullName: 'Student Three', permissions: EDU_VIEW.concat(EDU_WRITE),
      tenantIds: ['sps-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const teachers = [
  { id: 'tch-a1', tenantId: 'sps-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a2', tenantId: 'sps-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-b1', tenantId: 'sps-b', teacherCode: 'TB1', firstName: 'Ben', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const programs = [
  { id: 'prg-a', tenantId: 'sps-a', name: 'Track A', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-b', tenantId: 'sps-b', name: 'Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const courses = [
  { id: 'crs-a', tenantId: 'sps-a', programId: 'prg-a', name: 'Grammar A', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-b', tenantId: 'sps-b', programId: 'prg-b', name: 'Grammar B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

// __NEXT__

const students = [
  { id: 'sps-stu1', tenantId: 'sps-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-s1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'sps-stu2', tenantId: 'sps-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', userId: 'u-s2', createdAt: STAMP, updatedAt: STAMP },
  // Shares cls-a1 with sps-stu1: same-class, different-student rows stay
  // refused (ownership is the STUDENT, not the class).
  { id: 'sps-stu3', tenantId: 'sps-a', studentCode: 'S3', firstName: 'Syd', lastName: 'Three', status: 'active', userId: 'u-edit', createdAt: STAMP, updatedAt: STAMP },
  { id: 'sps-stu4', tenantId: 'sps-a', studentCode: 'S4', firstName: 'Ung', lastName: 'Four', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'sps-stuB', tenantId: 'sps-b', studentCode: 'SB', firstName: 'Bea', lastName: 'Bee', status: 'active', userId: 'u-s1b', createdAt: STAMP, updatedAt: STAMP }
];

const classes = [
  { id: 'cls-a1', tenantId: 'sps-a', courseId: 'crs-a', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a2', tenantId: 'sps-a', courseId: 'crs-a', teacherId: 'tch-a2', classCode: 'CA2', name: 'Geometry', displayName: 'Geometry', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-b', tenantId: 'sps-b', courseId: 'crs-b', teacherId: 'tch-b1', classCode: 'CB', name: 'Algebra B', displayName: 'Algebra B', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

// __NEXT2__

const enrolledAgo30 = dayOffset(-30) + 'T09:00:00.000Z';

const enrollments = [
  { id: 'enr-1', tenantId: 'sps-a', studentId: 'sps-stu1', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-2', tenantId: 'sps-a', studentId: 'sps-stu2', classId: 'cls-a2', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-3', tenantId: 'sps-a', studentId: 'sps-stu3', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-b', tenantId: 'sps-b', studentId: 'sps-stuB', classId: 'cls-b', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 }
];

const attendance = [
  { id: 'att-1', tenantId: 'sps-a', enrollmentId: 'enr-1', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-2', tenantId: 'sps-a', enrollmentId: 'enr-2', attendanceDate: dayOffset(-10), status: 'absent', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-3', tenantId: 'sps-a', enrollmentId: 'enr-3', attendanceDate: dayOffset(-9), status: 'late', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-b', tenantId: 'sps-b', enrollmentId: 'enr-b', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

// __NEXT3__

const grades = [
  { id: 'grd-1', tenantId: 'sps-a', enrollmentId: 'enr-1', gradingDate: dayOffset(-9), grade: 'B+', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grd-2', tenantId: 'sps-a', enrollmentId: 'enr-2', gradingDate: dayOffset(-9), grade: 'C', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grd-3', tenantId: 'sps-a', enrollmentId: 'enr-3', gradingDate: dayOffset(-8), grade: 'A', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grd-b', tenantId: 'sps-b', enrollmentId: 'enr-b', gradingDate: dayOffset(-9), grade: 'A', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

// Distinct slots per class/teacher so no conflict rule trips while seeding.
const sessions = [
  { id: 'ses-1', tenantId: 'sps-a', classId: 'cls-a1', scheduledDate: dayOffset(1), startTime: '09:00', endTime: '10:00', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-2', tenantId: 'sps-a', classId: 'cls-a2', scheduledDate: dayOffset(1), startTime: '11:00', endTime: '12:00', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-b', tenantId: 'sps-b', classId: 'cls-b', scheduledDate: dayOffset(1), startTime: '09:00', endTime: '10:00', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir, password) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(password).concat(userTail(password)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationEnrollments', { enrollments });
  seed(dir, 'educationAttendance', { attendance });
  seed(dir, 'educationGrading', { grades });
  seed(dir, 'educationScheduling', { sessions });
}

// __NEXT4__

describe('Phase 2A Student authorization — SELF scope, isolation, read-only', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('sps-p2a');
    seedAll(dir, bcrypt.hashSync('Pass#123', 10));
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

  const owner = () => token('u-owner', 'spsOwner', 'Owner', 'sps-a');
  const s1 = () => token('u-s1', 'spsStudent1', 'Viewer', 'sps-a');
  const s2 = () => token('u-s2', 'spsStudent2', 'Viewer', 'sps-a');
  const s1b = () => token('u-s1b', 'spsStudentB', 'Viewer', 'sps-b');
  const unlinked = () => token('u-unlinked', 'spsUnlinked', 'Viewer', 'sps-a');
  const operator = () => token('u-op', 'spsOperator', 'Viewer', 'sps-a');
  const editor = () => token('u-edit', 'spsStudentEdit', 'Viewer', 'sps-a');

  const get = (p, tok) =>
    (tok === undefined
      ? request(app).get(BASE + p)
      : request(app).get(BASE + p).set('Authorization', 'Bearer ' + tok));
  const post = (p, tok, body) =>
    request(app).post(BASE + p).set('Authorization', 'Bearer ' + tok).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(BASE + p).set('Authorization', 'Bearer ' + tok).send(body || {});
  const patch = (p, tok, body) =>
    request(app).patch(BASE + p).set('Authorization', 'Bearer ' + tok).send(body || {});

  const ids = (res) => (res.body.data || []).map((r) => r.id);
  const denied403 = (res) => {
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
  };

  test('A1. anonymous /students/me is 401', async () => {
    expect((await get('/students/me')).statusCode).toBe(401);
  });

  test('A2. anonymous reads are 401 on every student surface', async () => {
    const paths = [
      '/students', '/students/sps-stu1', '/students/sps-stu1/progress',
      '/enrollments', '/enrollments/enr-1',
      '/attendance', '/attendance/att-1',
      '/grading', '/grading/grd-1',
      '/scheduling', '/scheduling/ses-1',
      '/classes', '/classes/cls-a1'
    ];
    for (const p of paths) {
      const res = await get(p);
      expect([p, res.statusCode]).toEqual([p, 401]);
    }
  });

  test('B1. authenticated-but-unlinked /students/me is 404', async () => {
    const res = await get('/students/me', unlinked());
    expect(res.statusCode).toBe(404);
    expect(res.body.details.code).toBe('STUDENT_NOT_LINKED');
  });

  test('B2. grant-less unlinked reads are 403 PERMISSION_DENIED', async () => {
    const paths = [
      '/students', '/students/sps-stu1', '/students/sps-stu1/progress',
      '/enrollments', '/enrollments/enr-1',
      '/attendance', '/grading', '/scheduling', '/classes'
    ];
    for (const p of paths) {
      const res = await get(p, unlinked());
      expect([p, res.statusCode]).toEqual([p, 403]);
      expect([p, res.body.details.code]).toEqual([p, 'PERMISSION_DENIED']);
    }
  });

// __NEXT5__

  test('B3. an unlinked grant-holder keeps tenant-wide operator reads', async () => {
    // The self scope must not leak INTO the permission path: without a link
    // the operator grant still opens the whole tenant.
    expect(ids(await get('/students', operator())).sort())
      .toEqual(['sps-stu1', 'sps-stu2', 'sps-stu3', 'sps-stu4']);
    expect(ids(await get('/enrollments', operator())).sort())
      .toEqual(['enr-1', 'enr-2', 'enr-3']);
    expect(ids(await get('/attendance', operator()))).toHaveLength(3);
    expect(ids(await get('/grading', operator()))).toHaveLength(3);
    expect(ids(await get('/classes', operator())).sort()).toEqual(['cls-a1', 'cls-a2']);
    expect(ids(await get('/scheduling', operator())).sort()).toEqual(['ses-1', 'ses-2']);
    expect((await get('/students/sps-stu2', operator())).statusCode).toBe(200);
  });

  test('C1. linked student /students/me resolves their own record', async () => {
    const res = await get('/students/me', s1());
    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe('sps-stu1');
  });

  test('C2. linked student list has ONLY their own row, no grant needed', async () => {
    const res = await get('/students', s1());
    expect(res.statusCode).toBe(200);
    expect(ids(res)).toEqual(['sps-stu1']);
    expect(ids(res)).not.toContain('sps-stu2');
    expect(ids(res)).not.toContain('sps-stu3');
    expect(ids(res)).not.toContain('sps-stu4');
  });

  test('C3. linked student reads own profile and progress', async () => {
    expect((await get('/students/sps-stu1', s1())).statusCode).toBe(200);
    const progress = await get('/students/sps-stu1/progress', s1());
    expect(progress.statusCode).toBe(200);
    expect(progress.body.data.student.id).toBe('sps-stu1');
    expect(progress.body.data.enrollments.total).toBe(1);
  });

  test('C4. linked student reads own enrollments only', async () => {
    expect(ids(await get('/enrollments', s1()))).toEqual(['enr-1']);
    expect((await get('/enrollments/enr-1', s1())).statusCode).toBe(200);
  });

// __NEXT6__

  test('C5. linked student reads own attendance only', async () => {
    expect(ids(await get('/attendance', s1()))).toEqual(['att-1']);
    const row = await get('/attendance/att-1', s1());
    expect(row.statusCode).toBe(200);
    expect(row.body.data.status).toBe('present');
  });

  test('C6. linked student reads own grades only', async () => {
    expect(ids(await get('/grading', s1()))).toEqual(['grd-1']);
    const row = await get('/grading/grd-1', s1());
    expect(row.statusCode).toBe(200);
    expect(row.body.data.grade).toBe('B+');
  });

  test('C7. linked student reads own timetable only', async () => {
    expect(ids(await get('/scheduling', s1()))).toEqual(['ses-1']);
    const row = await get('/scheduling/ses-1', s1());
    expect(row.statusCode).toBe(200);
    expect(row.body.data.classId).toBe('cls-a1');
  });

  test('C8. linked student reads own classes only', async () => {
    expect(ids(await get('/classes', s1()))).toEqual(['cls-a1']);
    expect((await get('/classes/cls-a1', s1())).statusCode).toBe(200);
  });

  test('C9. the second student gets the mirror-image scope', async () => {
    expect(ids(await get('/students', s2()))).toEqual(['sps-stu2']);
    expect(ids(await get('/enrollments', s2()))).toEqual(['enr-2']);
    expect(ids(await get('/attendance', s2()))).toEqual(['att-2']);
    expect(ids(await get('/grading', s2()))).toEqual(['grd-2']);
    expect(ids(await get('/classes', s2()))).toEqual(['cls-a2']);
    expect(ids(await get('/scheduling', s2()))).toEqual(['ses-2']);
    expect((await get('/students/sps-stu2/progress', s2())).statusCode).toBe(200);
  });

  test('D1. another student profile is 403 OWNERSHIP_DENIED', async () => {
    denied403(await get('/students/sps-stu2', s1()));
    denied403(await get('/students/sps-stu4', s1()));
    denied403(await get('/students/sps-stu1', s2()));
  });

  test('D2. another student progress is 403', async () => {
    denied403(await get('/students/sps-stu2/progress', s1()));
    denied403(await get('/students/sps-stu1/progress', s2()));
  });

// __NEXT7__

  test('D3. another enrollment is 403, even in a shared class', async () => {
    denied403(await get('/enrollments/enr-2', s1()));
    // enr-3 is sps-stu3 in cls-a1: SAME class as s1, DIFFERENT student.
    denied403(await get('/enrollments/enr-3', s1()));
  });

  test('D4. another student attendance is 403', async () => {
    denied403(await get('/attendance/att-2', s1()));
    denied403(await get('/attendance/att-3', s1()));
  });

  test('D5. another student grades are 403', async () => {
    denied403(await get('/grading/grd-2', s1()));
    denied403(await get('/grading/grd-3', s1()));
  });

  test('D6. another student classes and sessions are 403', async () => {
    denied403(await get('/classes/cls-a2', s1()));
    denied403(await get('/scheduling/ses-2', s1()));
  });

  test('E1. studentId in the query answers empty, never other rows', async () => {
    expect(ids(await get('/enrollments?studentId=sps-stu2', s1()))).toEqual([]);
    expect(ids(await get('/enrollments?studentId=sps-stu1', s1()))).toEqual(['enr-1']);
  });

  test('E2. attendance filters cannot escape the self scope', async () => {
    expect(ids(await get('/attendance?studentId=sps-stu2', s1()))).toEqual([]);
    expect(ids(await get('/attendance?enrollmentId=enr-2', s1()))).toEqual([]);
    expect(ids(await get('/attendance?enrollmentId=enr-1', s1()))).toEqual(['att-1']);
  });

// __NEXT8__

  test('E3. grading filters cannot escape the self scope', async () => {
    expect(ids(await get('/grading?studentId=sps-stu2', s1()))).toEqual([]);
    expect(ids(await get('/grading?studentId=sps-stu3', s1()))).toEqual([]);
  });

  test('E4. free-text search runs inside the self scope only', async () => {
    expect(ids(await get('/students?search=Sam', s1()))).toEqual([]);
    expect(ids(await get('/students?search=Sara', s1()))).toEqual(['sps-stu1']);
  });

  test('E5. class and schedule filters cannot escape the self scope', async () => {
    expect(ids(await get('/classes?teacherId=tch-a2', s1()))).toEqual([]);
    expect(ids(await get('/scheduling?classId=cls-a2', s1()))).toEqual([]);
    expect(ids(await get('/scheduling?classId=cls-a1', s1()))).toEqual(['ses-1']);
  });

  test('E6. a grant-holding student is narrowed BEFORE their query runs', async () => {
    // u-edit HOLDS education.students.view: their search for another
    // student's name (Sara) still intersects the self scope (sps-stu3).
    expect(ids(await get('/students?search=Sara', editor()))).toEqual([]);
  });

  test('F1. a foreign student id is 404, not 403', async () => {
    expect((await get('/students/sps-stuB', s1())).statusCode).toBe(404);
    expect((await get('/students/sps-stuB/progress', s1())).statusCode).toBe(404);
  });

  test('F2. foreign academic rows are 404', async () => {
    expect((await get('/enrollments/enr-b', s1())).statusCode).toBe(404);
    expect((await get('/attendance/att-b', s1())).statusCode).toBe(404);
    expect((await get('/grading/grd-b', s1())).statusCode).toBe(404);
    expect((await get('/classes/cls-b', s1())).statusCode).toBe(404);
    expect((await get('/scheduling/ses-b', s1())).statusCode).toBe(404);
  });

// __NEXT9__

  test('F3. the tenant B student is the mirror-image, both directions', async () => {
    const me = await get('/students/me', s1b());
    expect(me.statusCode).toBe(200);
    expect(me.body.data.id).toBe('sps-stuB');
    expect(ids(await get('/students', s1b()))).toEqual(['sps-stuB']);
    expect(ids(await get('/enrollments', s1b()))).toEqual(['enr-b']);
    expect((await get('/students/sps-stu1', s1b())).statusCode).toBe(404);
    expect((await get('/enrollments/enr-1', s1b())).statusCode).toBe(404);
  });

  test('G1. a grant-less linked student cannot write: 403 everywhere', async () => {
    expect((await post('/students', s1(), { firstName: 'X', lastName: 'Y' })).statusCode).toBe(403);
    expect((await post('/enrollments', s1(), { studentId: 'sps-stu1', classId: 'cls-a1' })).statusCode).toBe(403);
    expect((await post('/attendance', s1(), { enrollmentId: 'enr-1', attendanceDate: '2026-02-01', status: 'present' })).statusCode).toBe(403);
    expect((await post('/grading', s1(), { enrollmentId: 'enr-1', gradingDate: '2026-02-01', grade: 'A' })).statusCode).toBe(403);
    expect((await post('/scheduling', s1(), { classId: 'cls-a1', scheduledDate: '2026-03-01', startTime: '09:00', endTime: '10:00' })).statusCode).toBe(403);
    expect((await post('/classes', s1(), { courseId: 'crs-a', name: 'Z' })).statusCode).toBe(403);
  });

// __NEXT10__

  test('G2. edit grants never substitute for the role gate', async () => {
    const t = editor();
    expect((await post('/students', t, { firstName: 'X', lastName: 'Y' })).statusCode).toBe(403);
    expect((await put('/students/sps-stu3', t, { notes: 'x' })).statusCode).toBe(403);
    expect((await patch('/students/sps-stu3/archive', t)).statusCode).toBe(403);
    expect((await post('/enrollments', t, { studentId: 'sps-stu3', classId: 'cls-a1' })).statusCode).toBe(403);
    expect((await put('/enrollments/enr-3', t, { notes: 'x' })).statusCode).toBe(403);
    expect((await patch('/enrollments/enr-3/withdraw', t)).statusCode).toBe(403);
    expect((await post('/attendance', t, { enrollmentId: 'enr-3', attendanceDate: '2026-02-01', status: 'present' })).statusCode).toBe(403);
    expect((await post('/attendance/bulk', t, { attendanceDate: '2026-02-01', entries: [] })).statusCode).toBe(403);
    expect((await put('/attendance/att-3', t, { status: 'present' })).statusCode).toBe(403);
    expect((await post('/grading', t, { enrollmentId: 'enr-3', gradingDate: '2026-02-01', grade: 'A' })).statusCode).toBe(403);
    expect((await put('/grading/grd-3', t, { grade: 'A' })).statusCode).toBe(403);
    expect((await post('/scheduling', t, { classId: 'cls-a1', scheduledDate: '2026-03-01', startTime: '09:00', endTime: '10:00' })).statusCode).toBe(403);
    expect((await put('/scheduling/ses-1', t, { notes: 'x' })).statusCode).toBe(403);
    expect((await post('/classes', t, { courseId: 'crs-a', name: 'Z' })).statusCode).toBe(403);
    expect((await put('/classes/cls-a1', t, { notes: 'x' })).statusCode).toBe(403);
    expect((await patch('/classes/cls-a1/archive', t)).statusCode).toBe(403);
  });

  test('G3. link-user stays Owner/Admin — students cannot link', async () => {
    expect((await post('/students/sps-stu4/link-user', s1(), { userId: 'u-s1' })).statusCode).toBe(403);
    expect((await post('/students/sps-stu4/link-user', editor(), { userId: 'u-edit' })).statusCode).toBe(403);
    expect((await request(app).delete(BASE + '/students/sps-stu1/link-user')
      .set('Authorization', 'Bearer ' + s1())).statusCode).toBe(403);
  });

// __NEXT11__

  test('H1. an Owner still reads the tenant wide', async () => {
    const list = ids(await get('/students', owner()));
    expect(list).toContain('sps-stu1');
    expect(list).toContain('sps-stu4');
    expect((await get('/students/sps-stu2/progress', owner())).statusCode).toBe(200);
    expect((await get('/enrollments/enr-3', owner())).statusCode).toBe(200);
  });

  test('H2. a grant-holding LINKED student is still narrowed to SELF', async () => {
    // The self scope is ownership, not absence of grants: even holding the
    // full operator grant set, u-edit reads ONLY sps-stu3's rows.
    expect(ids(await get('/students', editor()))).toEqual(['sps-stu3']);
    expect(ids(await get('/enrollments', editor()))).toEqual(['enr-3']);
    expect(ids(await get('/attendance', editor()))).toEqual(['att-3']);
    expect(ids(await get('/grading', editor()))).toEqual(['grd-3']);
    expect(ids(await get('/classes', editor()))).toEqual(['cls-a1']);
  });

  test('I1. attachStudentActor ignores every client-supplied studentId', async () => {
    const { attachStudentActor } = require('../middleware/studentActor');
    const req = {
      user: { id: 'u-s1', username: 'spsStudent1', role: 'Viewer' },
      tenantContext: { tenantId: 'sps-a' },
      query: { studentId: 'sps-stu2' },
      body: { studentId: 'sps-stu3', id: 'sps-stu3' },
      params: { id: 'sps-stu4' },
      headers: { 'x-student-id': 'sps-stu4' }
    };
    await new Promise((resolve) => attachStudentActor(req, {}, resolve));
    expect(req.educationStudent).not.toBeNull();
    expect(req.educationStudent.id).toBe('sps-stu1');
  });

  test('I2. no user, no link, or wrong tenant resolves to null', async () => {
    const { attachStudentActor } = require('../middleware/studentActor');
    const run = (req) =>
      new Promise((resolve) => attachStudentActor(req, {}, resolve));

    const anon = {};
    await run(anon);
    expect(anon.educationStudent).toBeNull();

    const unlink = {
      user: { id: 'u-unlinked', username: 'spsUnlinked', role: 'Viewer' },
      tenantContext: { tenantId: 'sps-a' }
    };
    await run(unlink);
    expect(unlink.educationStudent).toBeNull();

    // Same linked user, DIFFERENT tenant: the link never crosses tenants.
    const cross = {
      user: { id: 'u-s1', username: 'spsStudent1', role: 'Viewer' },
      tenantContext: { tenantId: 'sps-b' }
    };
    await run(cross);
    expect(cross.educationStudent).toBeNull();
  });
});

