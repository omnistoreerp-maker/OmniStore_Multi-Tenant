'use strict';

// teacherScope.test — P2 ownership scoping for the THREE surfaces the linked-
// teacher identity exception unlocks beyond bookings and ratings: Classes,
// Scheduling and Enrollments.
//
// WHAT IS PINNED HERE.
//   A. The identity exception covers EXACTLY five education surfaces (bookings,
//      ratings, classes, scheduling, enrollments). A linked teacher holding
//      education.students.edit is still refused by the role gate on /students:
//      the bypass never widens to the operator-owned surfaces.
//   B. The exception is for LINKED accounts only: an unlinked Viewer holding
//      the explicit grants is refused every write by the global role gate.
//   C. An unlinked Operator (Manager with the grants) keeps the tenant-wide
//      behaviour: rows of ANY teacher can be edited — the operator path is
//      unchanged by the teacher-actor work.
//   D-Q. On the five... (three here) surfaces the linked teacher is confined
//      to their OWN rows: lists are force-scoped (the query `teacherId` can
//      never widen them), reads/writes of another teacher's row answer 403
//      OWNERSHIP_DENIED, unknown ids answer 404 (existence never leaks across
//      tenants: 404 wins over 403), create stamps/schedules ONLY into the
//      linked teacher's own classes, and an unresolvable classId still falls
//      through to the service's 400 — the ownership check is not an existence
//      oracle.
//
// The server is booted through helpers/testServer with the REAL server.js
// mount order (attachTeacherActor -> requireAuth -> scopedWriteRoleGuard ->
// requirePermission -> controller -> service). Nothing here reads or writes
// backend/data.

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

const DAY = '2026-06-15';
const STAMP = '2026-01-01T00:00:00.000Z';

const companies = [
  { id: 'sc-a', name: 'Scope Tenant A', code: 'SCA', active: true },
  { id: 'sc-b', name: 'Scope Tenant B', code: 'SCB', active: true }
];

const GRANTS = [
  'education.classes.view', 'education.classes.edit',
  'education.scheduling.view', 'education.scheduling.edit',
  'education.enrollments.view', 'education.enrollments.edit'
];

function userRecords(password) {
  const stamp = STAMP;
  return [
    {
      id: 'u-owner', username: 'scOwner', password, role: 'Owner', fullName: 'Scope Owner',
      tenantIds: ['sc-a', 'sc-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Linked-teacher account (tch-1): normal Viewer role. Holds the three
      // surface grants PLUS education.students.edit — the students grant must
      // still be refused by the role gate (test A): the identity exception
      // never widens beyond the five surfaces.
      id: 'u-actor', username: 'scActor', password, role: 'Viewer', fullName: 'Teacher Actor',
      permissions: [...GRANTS, 'education.students.edit'],
      tenantIds: ['sc-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Linked to the SECOND teacher (tch-2): proves cross-teacher 403s.
      id: 'u-actor2', username: 'scActor2', password, role: 'Viewer', fullName: 'Teacher Actor Two',
      permissions: [...GRANTS],
      tenantIds: ['sc-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // UNLINKED Viewer holding the explicit grants: the role gate must still
      // refuse every write (the exception is identity-based, not grant-based).
      id: 'u-clerk', username: 'scClerk', password, role: 'Viewer', fullName: 'Scope Clerk',
      permissions: [...GRANTS],
      tenantIds: ['sc-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // UNLINKED Operator: passes the role gate, holds the grants — and keeps
      // the tenant-wide write behaviour operators have always had.
      id: 'u-manager', username: 'scManager', password, role: 'Manager', fullName: 'Scope Manager',
      permissions: [...GRANTS],
      tenantIds: ['sc-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Linked-teacher account in tenant B (tch-b1): the link is tenant-scoped.
      id: 'u-actorB', username: 'scActorB', password, role: 'Viewer', fullName: 'Teacher Actor B',
      permissions: [...GRANTS],
      tenantIds: ['sc-b'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const teachers = [
  { id: 'tch-1', tenantId: 'sc-a', teacherCode: 'SC1', firstName: 'Ann', lastName: 'One', displayName: 'Ann One', status: 'active', userId: 'u-actor', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-2', tenantId: 'sc-a', teacherCode: 'SC2', firstName: 'Bob', lastName: 'Two', displayName: 'Bob Two', status: 'active', userId: 'u-actor2', createdAt: STAMP, updatedAt: STAMP },
  { id: 'tch-b1', tenantId: 'sc-b', teacherCode: 'SCB1', firstName: 'Ben', lastName: 'B', displayName: 'Ben B', status: 'active', userId: 'u-actorB', createdAt: STAMP, updatedAt: STAMP }
];

const programs = [
  { id: 'prg-1', tenantId: 'sc-a', name: 'English Track', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-b', tenantId: 'sc-b', name: 'English Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const courses = [
  { id: 'crs-1', tenantId: 'sc-a', programId: 'prg-1', name: 'Grammar 101', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-b', tenantId: 'sc-b', programId: 'prg-b', name: 'Grammar B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const students = [
  { id: 'stu-1', tenantId: 'sc-a', studentCode: 'SS1', firstName: 'Sara', lastName: 'One', displayName: 'Sara One', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-2', tenantId: 'sc-a', studentCode: 'SS2', firstName: 'Sam', lastName: 'Two', displayName: 'Sam Two', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-3', tenantId: 'sc-a', studentCode: 'SS3', firstName: 'Syd', lastName: 'Three', displayName: 'Syd Three', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'stu-b1', tenantId: 'sc-b', studentCode: 'SSB', firstName: 'Bea', lastName: 'B', displayName: 'Bea B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const classes = [
  { id: 'cls-1', tenantId: 'sc-a', courseId: 'crs-1', teacherId: 'tch-1', classCode: 'C1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-2', tenantId: 'sc-a', courseId: 'crs-1', teacherId: 'tch-2', classCode: 'C2', name: 'Geometry', displayName: 'Geometry', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-b', tenantId: 'sc-b', courseId: 'crs-b', teacherId: 'tch-b1', classCode: 'CB', name: 'Algebra B', displayName: 'Algebra B', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const sessions = [
  { id: 'ses-1', tenantId: 'sc-a', classId: 'cls-1', scheduledDate: DAY, startTime: '10:00', endTime: '11:00', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-2', tenantId: 'sc-a', classId: 'cls-2', scheduledDate: DAY, startTime: '13:00', endTime: '14:00', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'ses-b', tenantId: 'sc-b', classId: 'cls-b', scheduledDate: DAY, startTime: '09:00', endTime: '10:00', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const enrollments = [
  { id: 'enr-1', tenantId: 'sc-a', studentId: 'stu-1', classId: 'cls-1', status: 'active', notes: '', enrolledAt: STAMP, createdAt: STAMP, updatedAt: STAMP },
  { id: 'enr-2', tenantId: 'sc-a', studentId: 'stu-2', classId: 'cls-2', status: 'active', notes: '', enrolledAt: STAMP, createdAt: STAMP, updatedAt: STAMP },
  { id: 'enr-b', tenantId: 'sc-b', studentId: 'stu-b1', classId: 'cls-b', status: 'active', notes: '', enrolledAt: STAMP, createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationScheduling', { sessions });
  seed(dir, 'educationEnrollments', { enrollments });
}

describe('P2 teacher-actor scope — the five-surface identity exception and ownership confinement', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('sc-http');
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

  const ownerA = () => token('u-owner', 'scOwner', 'Owner', 'sc-a');
  const actorA = () => token('u-actor', 'scActor', 'Viewer', 'sc-a');
  const actor2A = () => token('u-actor2', 'scActor2', 'Viewer', 'sc-a');
  const clerkA = () => token('u-clerk', 'scClerk', 'Viewer', 'sc-a');
  const managerA = () => token('u-manager', 'scManager', 'Manager', 'sc-a');
  const actorB = () => token('u-actorB', 'scActorB', 'Viewer', 'sc-b');

  const post = (path, tok, body) =>
    request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const put = (path, tok, body) =>
    request(app).put(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const patch = (path, tok, body) =>
    request(app).patch(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const get = (path, tok) =>
    request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);

  const ids = res => res.body.data.map(r => r.id);

  // --- A. the exception is exactly five surfaces ------------------------------

  test('A. a linked teacher is still role-gated OUTSIDE the five surfaces', async () => {
    // u-actor holds education.students.edit explicitly and is linked — the
    // students surface must still answer 'Insufficient role': the identity
    // exception never widens to operator-owned surfaces.
    const write = await post('/students', actorA(), { firstName: 'Nope', lastName: 'Way' });
    expect(write.statusCode).toBe(403);
    expect(write.body.message).toBe('Insufficient role');
    expect(readStore(dir, 'educationStudents').students).toHaveLength(4);
  });

  // --- B/C. identity vs role gate --------------------------------------------

  test('B. an UNLINKED permission-holding Viewer is refused every write', async () => {
    const cls = await post('/classes', clerkA(), { courseId: 'crs-1', teacherId: 'tch-1', classCode: 'NEW1', name: 'X' });
    expect(cls.statusCode).toBe(403);
    expect(cls.body.message).toBe('Insufficient role');

    const ses = await post('/scheduling', clerkA(), { classId: 'cls-1', scheduledDate: DAY, startTime: '15:00', endTime: '16:00' });
    expect(ses.statusCode).toBe(403);
    expect(ses.body.message).toBe('Insufficient role');

    const enr = await post('/enrollments', clerkA(), { studentId: 'stu-3', classId: 'cls-1' });
    expect(enr.statusCode).toBe(403);
    expect(enr.body.message).toBe('Insufficient role');

    // Nothing was persisted anywhere.
    expect(readStore(dir, 'educationClasses').classes).toHaveLength(3);
    expect(readStore(dir, 'educationScheduling').sessions).toHaveLength(3);
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(3);
  });

  test('C. an unlinked Operator (Manager with the grants) still writes tenant-wide', async () => {
    const cls = await put('/classes/cls-2', managerA(), { name: 'Renamed by operator' });
    expect(cls.statusCode).toBe(200);
    expect(readStore(dir, 'educationClasses').classes.find(c => c.id === 'cls-2').name)
      .toBe('Renamed by operator');

    const ses = await post('/scheduling', managerA(), {
      classId: 'cls-2', scheduledDate: DAY, startTime: '15:00', endTime: '16:00'
    });
    expect(ses.statusCode).toBe(201);
    expect(readStore(dir, 'educationScheduling').sessions).toHaveLength(4);
  });

  // --- D-H. classes -----------------------------------------------------------

  test('D. the linked teacher class list is force-scoped to their own rows', async () => {
    expect(ids(await get('/classes', actorA()))).toEqual(['cls-1']);
    // The query `teacherId` can never widen (or redirect) a linked list.
    expect(ids(await get('/classes?teacherId=tch-2', actorA()))).toEqual(['cls-1']);
    // The same link in tenant B is a different teacher, a different scope.
    expect(ids(await get('/classes', actorB()))).toEqual(['cls-b']);
    // An unlinked Operator still sees everything in the tenant.
    const all = ids(await get('/classes', ownerA()));
    expect(all).toEqual(expect.arrayContaining(['cls-1', 'cls-2']));
  });

  test('E. class reads: own 200, other-teacher 403 OWNERSHIP_DENIED, cross-tenant 404', async () => {
    expect((await get('/classes/cls-1', actorA())).statusCode).toBe(200);

    const other = await get('/classes/cls-2', actorA());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    // Existence never leaks across tenants: 404 wins over 403.
    expect((await get('/classes/cls-b', actorA())).statusCode).toBe(404);
  });

  test('F. class create stamps the linked teacher — the body never picks the teacher', async () => {
    const created = await post('/classes', actorA(), {
      courseId: 'crs-1', teacherId: 'tch-2', classCode: 'NEW1', name: 'New Group'
    });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.teacherId).toBe('tch-1');
    expect(created.body.data.tenantId).toBe('sc-a');

    // The second linked teacher is confined the same way.
    const mirror = await post('/classes', actor2A(), {
      courseId: 'crs-1', teacherId: 'tch-1', classCode: 'NEW2', name: 'Mirror Group'
    });
    expect(mirror.statusCode).toBe(201);
    expect(mirror.body.data.teacherId).toBe('tch-2');
  });

  test('G. class update: own 200, other 403 unchanged, unknown 404', async () => {
    const own = await put('/classes/cls-1', actorA(), { name: 'Algebra II' });
    expect(own.statusCode).toBe(200);
    expect(own.body.data.name).toBe('Algebra II');

    const other = await put('/classes/cls-2', actorA(), { name: 'Hijacked' });
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationClasses').classes.find(c => c.id === 'cls-2').name)
      .toBe('Geometry');

    expect((await put('/classes/cls-404', actorA(), { name: 'Ghost' })).statusCode).toBe(404);
  });

  test('H. class archive: other 403 unchanged, own 200 archived', async () => {
    const other = await patch('/classes/cls-2/archive', actorA());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationClasses').classes.find(c => c.id === 'cls-2').status)
      .toBe('active');

    const own = await patch('/classes/cls-1/archive', actorA());
    expect(own.statusCode).toBe(200);
    expect(own.body.data.status).toBe('archived');
  });

  // --- I-L. scheduling --------------------------------------------------------

  test('I. the linked teacher timetable is force-scoped to their own classes', async () => {
    expect(ids(await get('/scheduling', actorA()))).toEqual(['ses-1']);
    expect(ids(await get('/scheduling?teacherId=tch-2', actorA()))).toEqual(['ses-1']);
    // Even a direct foreign classId cannot widen the force-scoped list.
    expect(ids(await get('/scheduling?classId=cls-2', actorA()))).toEqual([]);
    expect(ids(await get('/scheduling', actorB()))).toEqual(['ses-b']);
  });

  test('J. scheduling reads: own 200, other-teacher 403 OWNERSHIP_DENIED, cross-tenant 404', async () => {
    expect((await get('/scheduling/ses-1', actorA())).statusCode).toBe(200);

    const other = await get('/scheduling/ses-2', actorA());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    expect((await get('/scheduling/ses-b', actorA())).statusCode).toBe(404);
  });

  test('K. scheduling create: own class 201, known foreign 403, unknown class 400', async () => {
    const foreign = await post('/scheduling', actorA(), {
      classId: 'cls-2', scheduledDate: DAY, startTime: '15:00', endTime: '16:00'
    });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationScheduling').sessions).toHaveLength(3);

    // An unresolvable classId falls through to the service's 400: the
    // ownership check is not an existence oracle.
    const unknown = await post('/scheduling', actorA(), {
      classId: 'cls-404', scheduledDate: DAY, startTime: '15:00', endTime: '16:00'
    });
    expect(unknown.statusCode).toBe(400);
    expect(readStore(dir, 'educationScheduling').sessions).toHaveLength(3);

    const own = await post('/scheduling', actorA(), {
      classId: 'cls-1', scheduledDate: DAY, startTime: '15:00', endTime: '16:00'
    });
    expect(own.statusCode).toBe(201);
    expect(own.body.data.classId).toBe('cls-1');
    expect(readStore(dir, 'educationScheduling').sessions).toHaveLength(4);
  });

  test('L. scheduling update: own 200, other 403 unchanged, unknown 404', async () => {
    const own = await put('/scheduling/ses-1', actorA(), { notes: 'Bring books' });
    expect(own.statusCode).toBe(200);
    expect(own.body.data.notes).toBe('Bring books');

    const other = await put('/scheduling/ses-2', actorA(), { notes: 'Hijacked' });
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationScheduling').sessions.find(s => s.id === 'ses-2').notes)
      .toBe('');

    expect((await put('/scheduling/ses-404', actorA(), { notes: 'Ghost' })).statusCode).toBe(404);
  });

  // --- M-R. enrollments -------------------------------------------------------

  test('M. the linked teacher roster list is force-scoped to their own classes', async () => {
    expect(ids(await get('/enrollments', actorA()))).toEqual(['enr-1']);
    expect(ids(await get('/enrollments?teacherId=tch-2', actorA()))).toEqual(['enr-1']);
    // A direct foreign classId cannot widen the force-scoped list either.
    expect(ids(await get('/enrollments?classId=cls-2', actorA()))).toEqual([]);
    expect(ids(await get('/enrollments', actorB()))).toEqual(['enr-b']);
  });

  test('N. enrollment reads: own 200, other-teacher 403 OWNERSHIP_DENIED, cross-tenant 404', async () => {
    expect((await get('/enrollments/enr-1', actorA())).statusCode).toBe(200);

    const other = await get('/enrollments/enr-2', actorA());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');

    expect((await get('/enrollments/enr-b', actorA())).statusCode).toBe(404);
  });

  test('O. enrollment create: own class 201, known foreign 403, unknown class 400', async () => {
    const foreign = await post('/enrollments', actorA(), { studentId: 'stu-1', classId: 'cls-2' });
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(3);

    const unknown = await post('/enrollments', actorA(), { studentId: 'stu-1', classId: 'cls-404' });
    expect(unknown.statusCode).toBe(400);
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(3);

    const own = await post('/enrollments', actorA(), { studentId: 'stu-3', classId: 'cls-1' });
    expect(own.statusCode).toBe(201);
    expect(own.body.data.classId).toBe('cls-1');
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(4);
  });

  test('P. enrollment update (notes): own 200, other 403 unchanged, unknown 404', async () => {
    const own = await put('/enrollments/enr-1', actorA(), { notes: 'Strong participation' });
    expect(own.statusCode).toBe(200);
    expect(own.body.data.notes).toBe('Strong participation');

    const other = await put('/enrollments/enr-2', actorA(), { notes: 'Hijacked' });
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationEnrollments').enrollments.find(e => e.id === 'enr-2').notes)
      .toBe('');

    expect((await put('/enrollments/enr-404', actorA(), { notes: 'Ghost' })).statusCode).toBe(404);
  });

  test('Q. enrollment withdraw: own 200 withdrawn, other 403 unchanged, cross-tenant 404', async () => {
    const other = await patch('/enrollments/enr-2/withdraw', actorA());
    expect(other.statusCode).toBe(403);
    expect(other.body.details.code).toBe('OWNERSHIP_DENIED');
    expect(readStore(dir, 'educationEnrollments').enrollments.find(e => e.id === 'enr-2').status)
      .toBe('active');

    const foreignTenant = await patch('/enrollments/enr-b/withdraw', actorA());
    expect(foreignTenant.statusCode).toBe(404);

    const own = await patch('/enrollments/enr-1/withdraw', actorA());
    expect(own.statusCode).toBe(200);
    expect(own.body.data.status).toBe('withdrawn');
    expect(readStore(dir, 'educationEnrollments').enrollments.find(e => e.id === 'enr-2').status)
      .toBe('active');
  });

  test('R. unknown ids on the ownership paths answer 404 for a linked teacher', async () => {
    expect((await get('/classes/cls-404', actorA())).statusCode).toBe(404);
    expect((await put('/classes/cls-404', actorA(), { name: 'x' })).statusCode).toBe(404);
    expect((await get('/scheduling/ses-404', actorA())).statusCode).toBe(404);
    expect((await put('/scheduling/ses-404', actorA(), { notes: 'x' })).statusCode).toBe(404);
    expect((await get('/enrollments/enr-404', actorA())).statusCode).toBe(404);
    expect((await put('/enrollments/enr-404', actorA(), { notes: 'x' })).statusCode).toBe(404);
    expect((await patch('/enrollments/enr-404/withdraw', actorA())).statusCode).toBe(404);
  });

  test('S. the ownership refusal is same-tenant only — the tenant still decides 404 first', async () => {
    // actorA's link lives in tenant A. Their OWN rows answer 403 only when
    // the record actually belongs to another teacher INSIDE the trusted
    // tenant — foreign-tenant records stay absent.
    const foreignClass = await get('/classes/cls-b', actorA());
    expect(foreignClass.statusCode).toBe(404);
    const foreignSession = await get('/scheduling/ses-b', actorA());
    expect(foreignSession.statusCode).toBe(404);
    const foreignEnrollment = await get('/enrollments/enr-b', actorA());
    expect(foreignEnrollment.statusCode).toBe(404);

    // And the SAME account inside tenant B has no link there: plain operator.
    expect((await get('/classes/cls-1', actorB())).statusCode).toBe(404);
  });
});
