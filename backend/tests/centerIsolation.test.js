'use strict';

// centerIsolation.test.js — P0 Center isolation + spoofing + escalation matrix.
//
// WHAT IS PINNED HERE. A user linked to a Center (POST /centers/:id/link-user,
// Owner/Admin only) resolves server-side to `req.centerActor` and is narrowed
// to that center's rows on every education surface:
//
//   Center A -> own-center rows                    = ALLOW (reads AND writes)
//   Center A -> other-center rows                   = DENY (404 wins across
//       tenants; same-tenant foreign rows answer 403 OWNERSHIP_DENIED)
//   ?centerId= / ?teacherId= / ?studentId= / :id    = cannot widen the scope
//       (forced, overridden or post-filtered by the server identity)
//   anonymous                                       = 401
//   center-linked account without grants            = 403 (permission gate)
//   center-linked account calling link-user         = 403 (Owner/Admin only)
//   Owner / operator (no center link)               = unchanged full view
//   cross-tenant                                    = 404 (never leaked)
//
// Center derivation is the canonical chain Program.centerId <- Course <- 
// Class <- Enrollment <- Attendance/Grade, Session <- Class. Rows whose chain
// carries no center (e.g. a Program created without one) resolve to NO center
// and are invisible to every center actor (fail closed); operators still see
// them.
//
// The server boots through helpers/testServer with the REAL server.js mount
// order (attachTeacherActor + attachCenterActor -> requireAuth ->
// scopedWriteRoleGuard -> requirePermission -> controller -> service). Real
// JWT, isolated temporary stores, no mocked authorization, no mocked storage.
// Nothing here reads or writes backend/data.

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
const DAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const TODAY = new Date().toISOString().slice(0, 10);
const enrolledAgo30 = new Date(Date.now() - 30 * 86400000).toISOString();

const companies = [
  { id: 'tea-a', name: 'Center Tenant A', code: 'CNA', active: true },
  { id: 'tea-b', name: 'Center Tenant B', code: 'CNB', active: true }
];

const VIEW = [
  'education.students.view', 'education.teachers.view', 'education.centers.view',
  'education.programs.view', 'education.courses.view', 'education.classes.view',
  'education.enrollments.view', 'education.attendance.view', 'education.scheduling.view',
  'education.grading.view', 'education.bookings.view', 'education.ratings.view',
  'education.pack.view'
];
const EDIT = VIEW.map((p) => p.replace('.view', '.edit'));

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'cenOwner', password, role: 'Owner', fullName: 'Cen Owner', tenantIds: ['tea-a', 'tea-b'], createdAt: STAMP, updatedAt: STAMP },
    // Center A's admin: Manager with full education grants, linked to cen-a1.
    { id: 'u-ca1', username: 'cenAdmin1', password, role: 'Manager', fullName: 'Center Admin One', permissions: [...VIEW, ...EDIT], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Center B's admin: Manager with full education grants, linked to cen-a2.
    { id: 'u-ca2', username: 'cenAdmin2', password, role: 'Manager', fullName: 'Center Admin Two', permissions: [...VIEW, ...EDIT], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Center-linked Viewer: can read (with view grants) but never write.
    { id: 'u-cav', username: 'cenViewer1', password, role: 'Viewer', fullName: 'Center Viewer', permissions: [...VIEW], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },    // Teacher of cen-a1's class, also used for intersection tests.
    { id: 'u-t1', username: 'cenTeacher1', password, role: 'Viewer', fullName: 'Center Teacher', permissions: [...VIEW], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked to BOTH teacher tch-a1 (cen-a1) and the EMPTY center cen-a3:
    // teacher scope allows, center scope denies -> must be 403 everywhere.
    { id: 'u-both', username: 'cenBoth', password, role: 'Viewer', fullName: 'Both Linked', permissions: [...VIEW], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Student-linked account: no education grants at all.
    { id: 'u-stu', username: 'cenStudent', password, role: 'Viewer', fullName: 'Center Student', tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Tenant B center admin.
    { id: 'u-cb', username: 'cenAdminB', password, role: 'Manager', fullName: 'Center Admin B', permissions: [...VIEW, ...EDIT], tenantIds: ['tea-b'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

// cen-a3 is intentionally EMPTY (no programs/classes): the intersection actor.
// cen-a4 is intentionally EMPTY and holds the Viewer link: a center-linked
// Viewer reads its (empty) own slice and can never write.
const centers = [
  { id: 'cen-a1', tenantId: 'tea-a', centerCode: 'CA1', name: 'Center A1', status: 'active', userId: 'u-ca1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-a2', tenantId: 'tea-a', centerCode: 'CA2', name: 'Center A2', status: 'active', userId: 'u-ca2', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-a3', tenantId: 'tea-a', centerCode: 'CA3', name: 'Center A3', status: 'active', userId: 'u-both', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-a4', tenantId: 'tea-a', centerCode: 'CA4', name: 'Center A4', status: 'active', userId: 'u-cav', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-b', tenantId: 'tea-b', centerCode: 'CB', name: 'Center B', status: 'active', userId: 'u-cb', createdAt: STAMP, updatedAt: STAMP }
];

// prg-a0 has NO centerId: its whole subtree must fail closed for center actors.
const programs = [
  { id: 'prg-a1', tenantId: 'tea-a', centerId: 'cen-a1', name: 'Track A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-a2', tenantId: 'tea-a', centerId: 'cen-a2', name: 'Track A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-a0', tenantId: 'tea-a', name: 'Track A0', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-b', tenantId: 'tea-b', centerId: 'cen-b', name: 'Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const courses = [
  { id: 'crs-a1', tenantId: 'tea-a', programId: 'prg-a1', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-a2', tenantId: 'tea-a', programId: 'prg-a2', name: 'Course A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-a0', tenantId: 'tea-a', programId: 'prg-a0', name: 'Course A0', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-b', tenantId: 'tea-b', programId: 'prg-b', name: 'Course B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const teachers = [
  { id: 'tch-a1', tenantId: 'tea-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-a2', tenantId: 'tea-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', status: 'active', userId: 'u-both', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-b1', tenantId: 'tea-b', teacherCode: 'TB1', firstName: 'Ben', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

// NOTE: u-both is linked to tch-a2 (cen-a2) AND cen-a3 (empty). Teacher scope
// allows cen-a2 rows, center scope allows nothing -> intersection must deny.
const classes = [
  { id: 'cls-a1', tenantId: 'tea-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a2', tenantId: 'tea-a', courseId: 'crs-a2', teacherId: 'tch-a2', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a0', tenantId: 'tea-a', courseId: 'crs-a0', teacherId: 'tch-a1', classCode: 'CA0', name: 'Orphan A0', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-b', tenantId: 'tea-b', courseId: 'crs-b', teacherId: 'tch-b1', classCode: 'CB', name: 'Algebra B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const students = [
  { id: 'stu-1', tenantId: 'tea-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-stu', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-2', tenantId: 'tea-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-b', tenantId: 'tea-b', studentCode: 'SB', firstName: 'Bea', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const enrollments = [
  { id: 'enr-1', tenantId: 'tea-a', studentId: 'stu-1', classId: 'cls-a1', status: 'active', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-2', tenantId: 'tea-a', studentId: 'stu-2', classId: 'cls-a2', status: 'active', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 },
  { id: 'enr-b', tenantId: 'tea-b', studentId: 'stu-b', classId: 'cls-b', status: 'active', enrolledAt: enrolledAgo30, withdrawnAt: null, createdAt: enrolledAgo30, updatedAt: enrolledAgo30 }
];

const attendance = [
  { id: 'att-1', tenantId: 'tea-a', enrollmentId: 'enr-1', attendanceDate: DAY, status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'att-2', tenantId: 'tea-a', enrollmentId: 'enr-2', attendanceDate: DAY, status: 'present', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const grades = [
  { id: 'grd-2', tenantId: 'tea-a', enrollmentId: 'enr-2', gradingDate: DAY, grade: 'B', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const sessions = [
  { id: 'ses-a1', tenantId: 'tea-a', classId: 'cls-a1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00', status: 'scheduled', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-a2', tenantId: 'tea-a', classId: 'cls-a2', scheduledDate: DAY, startTime: '11:00', endTime: '12:00', status: 'scheduled', createdAt: STAMP, updatedAt: STAMP }
];

const bookings = [
  { id: 'bkg-a1', tenantId: 'tea-a', teacherId: 'tch-a1', studentId: 'stu-1', classId: 'cls-a1', scheduledDate: DAY, startTime: '09:00', endTime: '10:00', status: 'requested', createdAt: STAMP, updatedAt: STAMP },
  { id: 'bkg-a2', tenantId: 'tea-a', teacherId: 'tch-a2', studentId: 'stu-2', classId: 'cls-a2', scheduledDate: DAY, startTime: '11:00', endTime: '12:00', status: 'requested', createdAt: STAMP, updatedAt: STAMP }
];

const ratings = [
  { id: 'rat-a1', tenantId: 'tea-a', teacherId: 'tch-a1', studentId: 'stu-1', classId: 'cls-a1', score: '5', comment: 'Great', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'rat-a2', tenantId: 'tea-a', teacherId: 'tch-a2', studentId: 'stu-2', classId: 'cls-a2', score: '4', comment: 'Good', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationCenters', { centers });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationEnrollments', { enrollments });
  seed(dir, 'educationAttendance', { attendance });
  seed(dir, 'educationGrading', { grades });
  seed(dir, 'educationScheduling', { sessions });
  seed(dir, 'educationBookings', { bookings });
  seed(dir, 'educationRatings', { ratings });
}

describe('P0 Center isolation — allow own, deny foreign, spoofing fails closed', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('ctr-iso');
    seedAll(dir);
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

  const ownerA = () => token('u-owner', 'cenOwner', 'Owner', 'tea-a');
  const ca1 = () => token('u-ca1', 'cenAdmin1', 'Manager', 'tea-a');
  const ca2 = () => token('u-ca2', 'cenAdmin2', 'Manager', 'tea-a');
  const cav = () => token('u-cav', 'cenViewer1', 'Viewer', 'tea-a');
  const t1 = () => token('u-t1', 'cenTeacher1', 'Viewer', 'tea-a');
  const both = () => token('u-both', 'cenBoth', 'Viewer', 'tea-a');
  const stu = () => token('u-stu', 'cenStudent', 'Viewer', 'tea-a');
  const cb = () => token('u-cb', 'cenAdminB', 'Manager', 'tea-b');

  const get = (p, tok) => {
    const req = request(app).get(`${BASE}${p}`);
    return tok ? req.set('Authorization', `Bearer ${tok}`) : req;
  };
  const del = (p, tok) =>
    request(app).delete(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`);
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const ids = (res) => res.body.data.map((s) => s.id).sort();

  // -------------------------------------------------------------------------
  // 1. Center A lists only its own rows on every surface (ALLOW own)
  // -------------------------------------------------------------------------
  test('1. Center A lists only its own rows on every surface', async () => {
    expect(ids(await get('/students', ca1()))).toEqual(['stu-1']);
    expect(ids(await get('/teachers', ca1()))).toEqual(['tch-a1']);
    // cls-a0 has a centerless chain: fail closed, invisible to every center.
    expect(ids(await get('/classes', ca1()))).toEqual(['cls-a1']);
    expect(ids(await get('/enrollments', ca1()))).toEqual(['enr-1']);
    expect(ids(await get('/courses', ca1()))).toEqual(['crs-a1']);
    // prg-a0 has no centerId: fail closed.
    expect(ids(await get('/programs', ca1()))).toEqual(['prg-a1']);
    expect(ids(await get('/attendance', ca1()))).toEqual(['att-1']);
    expect(ids(await get('/grading', ca1()))).toEqual([]);
    expect(ids(await get('/scheduling', ca1()))).toEqual(['ses-a1']);
    expect(ids(await get('/bookings', ca1()))).toEqual(['bkg-a1']);
    expect(ids(await get('/ratings', ca1()))).toEqual(['rat-a1']);
    expect(ids(await get('/centers', ca1()))).toEqual(['cen-a1']);
    // Mirror image for Center B.
    expect(ids(await get('/students', ca2()))).toEqual(['stu-2']);
    expect(ids(await get('/classes', ca2()))).toEqual(['cls-a2']);
    expect(ids(await get('/centers', ca2()))).toEqual(['cen-a2']);
  });

  // -------------------------------------------------------------------------
  // 2. Center A -> Center B rows are DENIED (403 same-tenant, 404 unknown)
  // -------------------------------------------------------------------------
  test('2. Center A cannot read Center B rows (403) and unknown ids stay 404', async () => {
    for (const path of [
      '/students/stu-2', '/teachers/tch-a2', '/classes/cls-a2', '/enrollments/enr-2',
      '/courses/crs-a2', '/programs/prg-a2', '/attendance/att-2', '/grading/grd-2',
      '/scheduling/ses-a2', '/bookings/bkg-a2', '/ratings/rat-a2', '/centers/cen-a2'
    ]) {
      const res = await get(path, ca1());
      expect(`${path} -> ${res.statusCode}`).toBe(`${path} -> 403`);
      expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
    }
    // Centerless-chain rows are foreign to every center.
    expect((await get('/classes/cls-a0', ca1())).statusCode).toBe(403);
    expect((await get('/programs/prg-a0', ca1())).statusCode).toBe(403);
    // Unknown ids are 404, never 403 (no oracle).
    for (const path of ['/students/nope', '/classes/nope', '/centers/nope', '/enrollments/nope']) {
      expect((await get(path, ca1())).statusCode).toBe(404);
    }
  });

  // -------------------------------------------------------------------------
  // 3. Center A writes: own-center ALLOW, other-center DENY
  // -------------------------------------------------------------------------
  test('3. Center A writes inside its own center, never outside it', async () => {
    // Update own student: ALLOW; Center B's: DENY. (Asserted BEFORE the
    // enrollment creates below: creating stu-2/cls-a1 would legitimately
    // bring stu-2 into Center A and flip the second assertion to 200.)
    expect((await put('/students/stu-1', ca1(), { notes: 'ok' })).statusCode).toBe(200);
    expect((await put('/students/stu-2', ca1(), { notes: 'x' })).statusCode).toBe(403);
    // Enroll into own class: ALLOW.
    const enr = await post('/enrollments', ca1(), { studentId: 'stu-2', classId: 'cls-a1' });
    expect(enr.statusCode).toBe(201);
    // Enroll into Center B's class: DENY, nothing written.
    const enrX = await post('/enrollments', ca1(), { studentId: 'stu-1', classId: 'cls-a2' });
    expect(enrX.statusCode).toBe(403);
    // Attendance for own enrollment: ALLOW; for Center B's: DENY.
    const att = await post('/attendance', ca1(), { enrollmentId: 'enr-1', attendanceDate: TODAY, status: 'present' });
    expect(att.statusCode).toBe(201);
    expect((await post('/attendance', ca1(), { enrollmentId: 'enr-2', attendanceDate: TODAY, status: 'present' })).statusCode).toBe(403);
    // Grade for own enrollment: ALLOW; for Center B's: DENY.
    const grd = await post('/grading', ca1(), { enrollmentId: 'enr-1', gradingDate: TODAY, grade: 'A' });
    expect(grd.statusCode).toBe(201);
    expect((await post('/grading', ca1(), { enrollmentId: 'enr-2', gradingDate: TODAY, grade: 'A' })).statusCode).toBe(403);
    // Session in own class: ALLOW; in Center B's: DENY.
    const ses = await post('/scheduling', ca1(), { classId: 'cls-a1', scheduledDate: TODAY, startTime: '14:00', endTime: '15:00' });
    expect(ses.statusCode).toBe(201);
    expect((await post('/scheduling', ca1(), { classId: 'cls-a2', scheduledDate: TODAY, startTime: '14:00', endTime: '15:00' })).statusCode).toBe(403);
    // Class under own course: ALLOW; under Center B's: DENY.
    const cls = await post('/classes', ca1(), { courseId: 'crs-a1', teacherId: 'tch-a1', name: 'Extra A1' });
    expect(cls.statusCode).toBe(201);
    expect((await post('/classes', ca1(), { courseId: 'crs-a2', teacherId: 'tch-a1', name: 'Extra X' })).statusCode).toBe(403);
    // Course under own program: ALLOW; under Center B's: DENY.
    const crs = await post('/courses', ca1(), { programId: 'prg-a1', name: 'Extra Course' });
    expect(crs.statusCode).toBe(201);
    expect((await post('/courses', ca1(), { programId: 'prg-a2', name: 'Extra X' })).statusCode).toBe(403);
    // Program without centerId is stamped to the actor's center; a foreign
    // centerId is refused outright.
    const prg = await post('/programs', ca1(), { name: 'Extra Track' });
    expect(prg.statusCode).toBe(201);
    expect(prg.body.data.centerId).toBe('cen-a1');
    expect((await post('/programs', ca1(), { name: 'Extra X', centerId: 'cen-a2' })).statusCode).toBe(403);
    // Update own class: ALLOW; move it under Center B's course: DENY.
    expect((await put('/classes/cls-a1', ca1(), { notes: 'ok' })).statusCode).toBe(200);
    expect((await put('/classes/cls-a1', ca1(), { courseId: 'crs-a2' })).statusCode).toBe(403);
    // Booking inside own center: ALLOW; cross-center refs: DENY.
    const bkg = await post('/bookings', ca1(), { teacherId: 'tch-a1', studentId: 'stu-1', classId: 'cls-a1', scheduledDate: TODAY, startTime: '16:00', endTime: '17:00' });
    expect(bkg.statusCode).toBe(201);
    expect((await post('/bookings', ca1(), { teacherId: 'tch-a2', studentId: 'stu-1', scheduledDate: TODAY, startTime: '16:00', endTime: '17:00' })).statusCode).toBe(403);
    // Rating inside own center: ALLOW; cross-center refs: DENY.
    const rat = await post('/ratings', ca1(), { teacherId: 'tch-a1', studentId: 'stu-1', classId: 'cls-a1', score: '5' });
    expect(rat.statusCode).toBe(201);
    expect((await post('/ratings', ca1(), { teacherId: 'tch-a2', studentId: 'stu-1', score: '5' })).statusCode).toBe(403);
    // Creating a center is an operator action, even for a center admin.
    expect((await post('/centers', ca1(), { name: 'Rogue' })).statusCode).toBe(403);
    // Own center row edits: ALLOW; the other center: DENY.
    expect((await put('/centers/cen-a1', ca1(), { notes: 'ok' })).statusCode).toBe(200);
    expect((await put('/centers/cen-a2', ca1(), { notes: 'x' })).statusCode).toBe(403);
    // Tenant-wide pack settings are operator-only.
    expect((await put('/pack', ca1(), { academicYear: '2030' })).statusCode).toBe(403);
    expect((await get('/pack', ca1())).statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 4. Query/body spoofing cannot widen the center scope
  // -------------------------------------------------------------------------
  test('4. centerId/teacherId/studentId spoofing is ignored or overridden', async () => {
    expect(ids(await get('/programs?centerId=cen-a2', ca1()))).toEqual(['prg-a1']);
    // A spoofed teacherId is honored as a filter then intersected with the
    // center scope: the foreign row is excluded, so spoofing yields nothing.
    expect(ids(await get('/classes?teacherId=tch-a2', ca1()))).toEqual([]);
    expect(ids(await get('/enrollments?studentId=stu-2', ca1()))).toEqual([]);
    expect(ids(await get('/attendance?studentId=stu-2', ca1()))).toEqual([]);
    // centerId is not even a declared classes filter: ignored, then scoped.
    expect(ids(await get('/classes?centerId=cen-a2', ca1()))).toEqual(['cls-a1']);
    // A body centerId on update cannot move the row: still 403 + unchanged.
    expect((await put('/programs/prg-a1', ca1(), { centerId: 'cen-a2' })).statusCode).toBe(403);
    const kept = await get('/programs/prg-a1', ca1());
    expect(kept.body.data.centerId).toBe('cen-a1');
  });

  // -------------------------------------------------------------------------
  // 5. Teacher x Center intersection (both must allow)
  // -------------------------------------------------------------------------
  test('5. teacher-allow plus center-deny still denies (intersection)', async () => {
    // u-both teaches tch-a2's classes (cen-a2) but is center-linked to the
    // EMPTY cen-a3: teacher scope allows cen-a2 rows, center scope allows
    // nothing -> every row and write is denied.
    expect((await get('/students/stu-2', both())).statusCode).toBe(403);
    expect((await get('/students/stu-2/progress', both())).statusCode).toBe(403);
    expect(ids(await get('/students', both()))).toEqual([]);
    expect(ids(await get('/classes', both()))).toEqual([]);
    // Same-tenant unknown ids stay 404 (no oracle from the intersection).
    expect((await get('/students/nope', both())).statusCode).toBe(404);
  });

  test('5b. teacher-allow plus center-allow grants (link switch is audited)', async () => {
    // Owner moves the cen-a1 link from u-ca1 to the cen-a1 teacher u-t1
    // (unlink first: links are one-to-one, a different pair is 409).
    expect((await del('/centers/cen-a1/link-user', ownerA())).statusCode).toBe(200);
    expect((await post('/centers/cen-a1/link-user', ownerA(), { userId: 'u-t1' })).statusCode).toBe(200);
    // The combined actor then sees exactly its own slice, with counts.
    const list = await get('/students', t1());
    expect(ids(list)).toEqual(['stu-1']);
    const progress = await get('/students/stu-1/progress', t1());
    expect(progress.statusCode).toBe(200);
    expect(progress.body.data.enrollments.total).toBe(1);
    expect(progress.body.data.attendance.total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 6. Progress honors the center boundary (PR29 teacher scope intact)
  // -------------------------------------------------------------------------
  test('6. progress counts only the actor center enrollments', async () => {
    const a = await get('/students/stu-1/progress', ca1());
    expect(a.statusCode).toBe(200);
    expect(a.body.data.enrollments).toEqual({ total: 1, active: 1, withdrawn: 0 });
    expect(a.body.data.classes.enrolled).toBe(1);
    expect(a.body.data.courses.enrolled).toBe(1);
    expect(a.body.data.sessions.scheduled).toBe(1);
    expect(a.body.data.attendance).toEqual({ total: 1, present: 1, absent: 0, late: 0, excused: 0 });
    // Center B's student is forbidden to Center A, not leaked as zeros.
    expect((await get('/students/stu-2/progress', ca1())).statusCode).toBe(403);
    // PR29 teacher scope is untouched: the linked teacher still sees exactly
    // their own single enrollment.
    const t = await get('/students/stu-1/progress', t1());
    expect(t.statusCode).toBe(200);
    expect(t.body.data.enrollments.total).toBe(1);
    expect(t.body.data.attendance.total).toBe(1);
    // Owner keeps the full tenant view.
    const o = await get('/students/stu-1/progress', ownerA());
    expect(o.body.data.enrollments.total).toBe(1);
  });

  // -------------------------------------------------------------------------
  // 7. Anonymous, grants, link-user and master boundary
  // -------------------------------------------------------------------------
  test('7. anonymous is 401, grants are required, linking is Owner/Admin only', async () => {
    expect((await get('/students', null)).statusCode).toBe(401);
    expect((await get('/students/stu-1/progress', null)).statusCode).toBe(401);
    // Center-linked Viewer WITH view grants reads its own (empty) slice...
    const emptyList = await get('/students', cav());
    expect(emptyList.statusCode).toBe(200);
    expect(emptyList.body.data).toEqual([]);
    // ...but cannot write (global role gate: Viewer is not Owner/Admin/Manager
    // and holds no teacher link).
    expect((await post('/students', cav(), { firstName: 'No', lastName: 'Way' })).statusCode).toBe(403);
    // A center admin cannot mint links: link-user stays Owner/Admin only.
    expect((await post('/centers/cen-a1/link-user', ca1(), { userId: 'u-cav' })).statusCode).toBe(403);
    expect((await post('/teachers/tch-a1/link-user', ca1(), { userId: 'u-cav' })).statusCode).toBe(403);
    // The master boundary is untouched: a center admin is not a platform admin.
    // (Absolute path: the get() helper prefixes the education base route.)
    const audit = await request(app).get('/api/v1/platform/audit').set('Authorization', `Bearer ${ca1()}`);
    expect(audit.statusCode).toBe(403);
    // Capabilities still answer inside a trusted tenant.
    expect((await get('/capabilities', ca1())).statusCode).toBe(200);
  });

  // -------------------------------------------------------------------------
  // 8. Cross-tenant stays 404 and the operator view is unchanged
  // -------------------------------------------------------------------------
  test('8. cross-tenant is 404 and operators keep the full view', async () => {
    expect((await get('/students/stu-b', ca1())).statusCode).toBe(404);
    expect((await get('/students/stu-1', cb())).statusCode).toBe(404);
    expect((await get('/classes/cls-a1', cb())).statusCode).toBe(404);
    // Tenant B's own admin sees exactly tenant B.
    expect(ids(await get('/students', cb()))).toEqual(['stu-b']);
    expect(ids(await get('/centers', cb()))).toEqual(['cen-b']);
    // Owner (no center link) keeps the unchanged full tenant view.
    expect(ids(await get('/students', ownerA()))).toEqual(['stu-1', 'stu-2']);
    expect(ids(await get('/classes', ownerA()))).toEqual(['cls-a0', 'cls-a1', 'cls-a2']);
    expect(ids(await get('/centers', ownerA()))).toEqual(['cen-a1', 'cen-a2', 'cen-a3', 'cen-a4']);
    // Student-linked account without grants cannot escalate.
    expect((await get('/students/stu-1', stu())).statusCode).toBe(403);
    expect((await post('/centers/cen-a1/link-user', stu(), { userId: 'u-stu' })).statusCode).toBe(403);
  });
});
