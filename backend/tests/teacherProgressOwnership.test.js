'use strict';

// teacherProgressOwnership.test.js — GET /students/:id/progress scope.
//
// WHAT WAS BROKEN. `getStudentProgress` derived every count from
// `enrollmentService.listEnrollments(ctx, { studentId })` — EVERY enrollment a
// student has in the tenant. For a SHARED student (enrolled in one Class of
// Teacher A and another Class of Teacher B), Teacher A's progress report also
// counted Teacher B's enrollments, Class, Course, Sessions and attendance.
//
// WHAT IS PINNED HERE. The enrollment list is now narrowed by the
// SERVER-RESOLVED teacher id (`req.teacherActor.id`, derived from the signed
// token — never query/body) whenever a teacher actor exists, so a shared
// student's counts cannot include another teacher's rows. Operators
// (Owner/Admin/Manager) keep the full tenant-scoped student view.
//
// The server boots through helpers/testServer with the REAL server.js mount
// order (attachTeacherActor -> requireAuth -> scopedWriteRoleGuard ->
// requirePermission -> controller -> service). Real JWT, real login identity,
// isolated temporary stores, no mocked authorization, no mocked storage.
// Nothing here reads or writes backend/data.

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
  { id: 'tea-a', name: 'Progress Tenant A', code: 'PRGA', active: true },
  { id: 'tea-b', name: 'Progress Tenant B', code: 'PRGB', active: true }
];

// Every account below is either an operator or a linked Teacher holding the
// registered read grants. NO new permission strings are introduced.
const EDU = [
  'education.students.view',
  'education.students.edit',
  'education.attendance.view',
  'education.attendance.edit',
  'education.enrollments.view'
];

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'prgOwner', password, role: 'Owner', fullName: 'Prg Owner', tenantIds: ['tea-a', 'tea-b'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-manager', username: 'prgManager', password, role: 'Manager', fullName: 'Prg Manager', permissions: [...EDU], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked to tch-a1 — Teacher A.
    { id: 'u-t1', username: 'prgTeacher1', password, role: 'Viewer', fullName: 'Teacher One', permissions: [...EDU], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked to tch-a2 — Teacher B (shares stu-shared with Teacher A).
    { id: 'u-t2', username: 'prgTeacher2', password, role: 'Viewer', fullName: 'Teacher Two', permissions: [...EDU], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked to tch-a3 — teaches NO class the shared student is in.
    { id: 'u-t3', username: 'prgTeacher3', password, role: 'Viewer', fullName: 'Teacher Three', permissions: [...EDU], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked teacher of tenant B.
    { id: 'u-tb', username: 'prgTeacherB', password, role: 'Viewer', fullName: 'Teacher B', permissions: [...EDU], tenantIds: ['tea-b'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

const teachers = [
  { id: 'tch-a1', tenantId: 'tea-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', displayName: 'Ann One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a2', tenantId: 'tea-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', displayName: 'Bob Two', status: 'active', userId: 'u-t2', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a3', tenantId: 'tea-a', teacherCode: 'TA3', firstName: 'Cara', lastName: 'Three', displayName: 'Cara Three', status: 'active', userId: 'u-t3', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-b1', tenantId: 'tea-b', teacherCode: 'TB1', firstName: 'Ben', lastName: 'Bee', displayName: 'Ben Bee', status: 'active', userId: 'u-tb', createdAt: STAMP, updatedAt: STAMP }
];

const centers = [
  { id: 'cen-a1', tenantId: 'tea-a', name: 'Center A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-a2', tenantId: 'tea-a', name: 'Center A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-b', tenantId: 'tea-b', name: 'Center B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const programs = [
  { id: 'prg-a', tenantId: 'tea-a', name: 'Track A', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-b', tenantId: 'tea-b', name: 'Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

// Two DIFFERENT courses so a course count cannot accidentally match across
// teachers; they happen to share one program to prove the count follows the
// enrollment, not the program.
const courses = [
  { id: 'crs-a1', tenantId: 'tea-a', programId: 'prg-a', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-a2', tenantId: 'tea-a', programId: 'prg-a', name: 'Course A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-b', tenantId: 'tea-b', programId: 'prg-b', name: 'Course B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const students = [
  { id: 'stu-shared', tenantId: 'tea-a', studentCode: 'SSH', firstName: 'Sharon', lastName: 'Shared', displayName: 'Sharon Shared', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-a1', tenantId: 'tea-a', studentCode: 'SA1', firstName: 'Sara', lastName: 'One', displayName: 'Sara One', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-b1', tenantId: 'tea-b', studentCode: 'SB1', firstName: 'Bea', lastName: 'Bee', displayName: 'Bea Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const classes = [
  { id: 'cls-a1', tenantId: 'tea-a', courseId: 'crs-a1', teacherId: 'tch-a1', centerId: 'cen-a1', classCode: 'CA1', name: 'Algebra A1', displayName: 'Algebra A1', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a2', tenantId: 'tea-a', courseId: 'crs-a2', teacherId: 'tch-a2', centerId: 'cen-a2', classCode: 'CA2', name: 'Geometry A2', displayName: 'Geometry A2', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a3', tenantId: 'tea-a', courseId: 'crs-a1', teacherId: 'tch-a3', centerId: 'cen-a1', classCode: 'CA3', name: 'History A3', displayName: 'History A3', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-b', tenantId: 'tea-b', courseId: 'crs-b', teacherId: 'tch-b1', centerId: 'cen-b', classCode: 'CB', name: 'Algebra B', displayName: 'Algebra B', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const enrolledAgo30 = dayOffset(-30) + 'T09:00:00.000Z';

// THE SHARED STUDENT: stu-shared has one enrollment under Teacher A (cls-a1)
// and one under Teacher B (cls-a2).
const enrollments = [
  { id: 'enr-shared-a1', tenantId: 'tea-a', studentId: 'stu-shared', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-shared-a2', tenantId: 'tea-a', studentId: 'stu-shared', classId: 'cls-a2', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-a1', tenantId: 'tea-a', studentId: 'stu-a1', classId: 'cls-a1', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-b', tenantId: 'tea-b', studentId: 'stu-b1', classId: 'cls-b', status: 'active', notes: '', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 }
];

// Attendance exists on BOTH of the shared student's enrollments.
const attendance = [
  { id: 'att-shared-a1', tenantId: 'tea-a', enrollmentId: 'enr-shared-a1', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-shared-a2', tenantId: 'tea-a', enrollmentId: 'enr-shared-a2', attendanceDate: dayOffset(-10), status: 'absent', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-a1', tenantId: 'tea-a', enrollmentId: 'enr-a1', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-b', tenantId: 'tea-b', enrollmentId: 'enr-b', attendanceDate: dayOffset(-10), status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const sessions = [
  { id: 'ses-a1', tenantId: 'tea-a', classId: 'cls-a1', scheduledDate: dayOffset(-9), startTime: '09:00', durationMinutes: 60, status: 'scheduled', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-a2', tenantId: 'tea-a', classId: 'cls-a2', scheduledDate: dayOffset(-9), startTime: '10:00', durationMinutes: 60, status: 'scheduled', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-b', tenantId: 'tea-b', classId: 'cls-b', scheduledDate: dayOffset(-9), startTime: '11:00', durationMinutes: 60, status: 'scheduled', createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationCenters', { centers });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationEnrollments', { enrollments });
  seed(dir, 'educationAttendance', { attendance });
  seed(dir, 'educationScheduling', { sessions });
}

describe('Teacher progress ownership — /students/:id/progress scoped to linked teacher enrollments', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('prog-own');
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

  const ownerTok = () => token('u-owner', 'prgOwner', 'Owner', 'tea-a');
  const managerTok = () => token('u-manager', 'prgManager', 'Manager', 'tea-a');
  const tA = () => token('u-t1', 'prgTeacher1', 'Viewer', 'tea-a');
  const tB = () => token('u-t2', 'prgTeacher2', 'Viewer', 'tea-a');
  const tNoEnroll = () => token('u-t3', 'prgTeacher3', 'Viewer', 'tea-a');
  const tForeign = () => token('u-tb', 'prgTeacherB', 'Viewer', 'tea-b');

  const get = (p, tok) => {
    const req = request(app).get(`${BASE}${p}`);
    return tok ? req.set('Authorization', `Bearer ${tok}`) : req;
  };
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});

  const progress = (studentId, tok, query) =>
    get(`/students/${studentId}/progress${query || ''}`, tok);

  const data = (res) => res.body.data;

  // -------------------------------------------------------------------------
  // 1. LINKED TEACHER SEES ONLY THEIR OWN PROGRESS COUNTS
  // -------------------------------------------------------------------------
  test('1. a linked teacher sees only their own enrollment/class/course/session/attendance counts for a SHARED student', async () => {
    const resA = await progress('stu-shared', tA());
    expect(resA.statusCode).toBe(200);
    const a = data(resA);

    expect(a.enrollments).toEqual({ total: 1, active: 1, withdrawn: 0 });
    expect(a.classes.enrolled).toBe(1);
    expect(a.courses.enrolled).toBe(1);
    expect(a.sessions.scheduled).toBe(1);
    expect(a.attendance).toEqual({ total: 1, present: 1, absent: 0, late: 0, excused: 0 });
    // The canonical model has no lesson entity: always zero, never invented.
    expect(a.lessons.total).toBe(0);

    // Teacher B sees the mirror image — its own single enrollment.
    const resB = await progress('stu-shared', tB());
    expect(resB.statusCode).toBe(200);
    const b = data(resB);
    expect(b.enrollments).toEqual({ total: 1, active: 1, withdrawn: 0 });
    expect(b.classes.enrolled).toBe(1);
    expect(b.courses.enrolled).toBe(1);
    expect(b.sessions.scheduled).toBe(1);
    expect(b.attendance).toEqual({ total: 1, present: 0, absent: 1, late: 0, excused: 0 });

    // The two teachers' scopes are disjoint: neither equals the union.
    expect(a.courses.enrolled + b.courses.enrolled).toBe(2);
    expect(a.attendance.total + b.attendance.total).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 2. ANOTHER TEACHER'S RECORDS CANNOT CHANGE VISIBLE COUNTS
  // -------------------------------------------------------------------------
  test('2. another teacher\'s records cannot change what a teacher sees', async () => {
    const before = data(await progress('stu-shared', tA()));
    expect(before.attendance.total).toBe(1);

    // Teacher B writes MORE attendance into their OWN enrollment. seed has 4
    // rows; this adds a fifth for enr-shared-a2.
    const write = await post('/attendance', tB(), {
      enrollmentId: 'enr-shared-a2', attendanceDate: dayOffset(-7), status: 'late'
    });
    expect(write.statusCode).toBe(201);

    // Teacher A's view is untouched by Teacher B's new row.
    const after = data(await progress('stu-shared', tA()));
    expect(after.attendance.total).toBe(1);
    expect(after.attendance.late).toBe(0);
    expect(after.enrollments.total).toBe(1);

    // Teacher B's own view reflects its extra row — proving the write landed.
    const b = data(await progress('stu-shared', tB()));
    expect(b.attendance.total).toBe(2);
    expect(b.attendance.late).toBe(1);

    // The Owner still sees the whole, tenant-scoped picture.
    const owner = data(await progress('stu-shared', ownerTok()));
    expect(owner.attendance.total).toBe(3);
  });

  // -------------------------------------------------------------------------
  // 3. QUERY PARAMETERS CANNOT WIDEN (OR NARROW) THE AUTHORIZATION SCOPE
  // -------------------------------------------------------------------------
  test('3. query parameters cannot widen or spoof the teacher scope', async () => {
    const spoofed = await progress('stu-shared', tA(),
      '?teacherId=tch-a2&studentId=stu-a1&tenantId=tea-b&classId=cls-a2');
    expect(spoofed.statusCode).toBe(200);
    const s = data(spoofed);
    // Still Teacher A's own single enrollment — none of the params changed it.
    expect(s.enrollments.total).toBe(1);
    expect(s.classes.enrolled).toBe(1);
    expect(s.attendance.total).toBe(1);

    // For an operator the same params are ignored too: no narrowing.
    const owner = data(await progress('stu-shared', ownerTok(),
      '?teacherId=tch-a1&studentId=stu-b1&tenantId=tea-b'));
    expect(owner.enrollments.total).toBe(2);
    expect(owner.attendance.total).toBe(2);
    expect(owner.classes.enrolled).toBe(2);
  });

  // -------------------------------------------------------------------------
  // 4. A TEACHER WITHOUT AN ENROLLMENT FOR THE STUDENT IS REFUSED
  // -------------------------------------------------------------------------
  test('4. a teacher with no enrollment for the student gets 403 OWNERSHIP_DENIED', async () => {
    const res = await progress('stu-shared', tNoEnroll());
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
  });

  // -------------------------------------------------------------------------
  // 5. FOREIGN TENANT / UNKNOWN STUDENT — EXISTENCE NEVER LEAKS
  // -------------------------------------------------------------------------
  test('5. a foreign-tenant or unknown student is a 404 for a linked teacher', async () => {
    // Teacher A asks about a tenant-B student -> 404 (not 403, not 200).
    expect((await progress('stu-b1', tA())).statusCode).toBe(404);
    // A tenant-B teacher asks about the tenant-A shared student -> 404.
    expect((await progress('stu-shared', tForeign())).statusCode).toBe(404);
    // An id that does not exist anywhere -> 404.
    expect((await progress('stu-nope', tA())).statusCode).toBe(404);
    // ...and the same holds for an operator in the wrong tenant.
    expect((await progress('stu-a1', tForeign())).statusCode).toBe(404);
  });

  // -------------------------------------------------------------------------
  // 6. OWNER / MANAGER RETAIN THE FULL TENANT-SCOPED PROGRESS
  // -------------------------------------------------------------------------
  test('6. Owner and Manager keep the complete tenant-scoped progress (unchanged)', async () => {
    const owner = data(await progress('stu-shared', ownerTok()));
    expect(owner.enrollments).toEqual({ total: 2, active: 2, withdrawn: 0 });
    expect(owner.classes.enrolled).toBe(2);
    expect(owner.courses.enrolled).toBe(2);
    expect(owner.sessions.scheduled).toBe(2);
    expect(owner.attendance).toEqual({ total: 2, present: 1, absent: 1, late: 0, excused: 0 });

    const manager = data(await progress('stu-shared', managerTok()));
    expect(manager.enrollments.total).toBe(2);
    expect(manager.attendance.total).toBe(2);
    expect(manager.classes.enrolled).toBe(2);

    // A non-shared, single-enrollment student is unchanged for operators too.
    const ownerSingle = data(await progress('stu-a1', ownerTok()));
    expect(ownerSingle.enrollments.total).toBe(1);
    expect(ownerSingle.attendance.total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. ANONYMOUS ACCESS REMAINS UNAUTHORIZED
  // -------------------------------------------------------------------------
  test('7. anonymous access remains unauthorized', async () => {
    const res = await get('/students/stu-shared/progress');
    expect(res.statusCode).toBe(401);
    expect(res.body.data).toBeUndefined();
  });
});
