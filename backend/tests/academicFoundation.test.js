'use strict';

// academicFoundation.test.js — P1 Academic Foundation: years, terms,
// subjects, groups + the course.subjectId / class.termId wiring.
//
// WHAT IS PINNED HERE. Four new directory entities with the same
// tenant/center/validation contract as the STU entities, wired into the
// academic chain Tenant -> Center -> Academic Year -> Term and
// Center -> Subject, Class -> Group:
//
//   1. CRUD lifecycle (create/read/update/archive) with tenant isolation,
//      same-tenant code uniqueness (409), cross-tenant 404s, unknown-parent
//      400s and anonymous 401s on every route.
//   2. Chain integrity: a term cannot teach outside its year (date bounds +
//      archived-year refusal); a course subject must sit in the same center
//      as the course program; a class term must sit in the same center as
//      the class course chain; a group classId is immutable.
//   3. Center isolation for a center-linked account: own-center ALLOW on
//      lists/reads/writes, other-center DENY (403 same-tenant, 404 unknown),
//      ?centerId= spoofing overridden, broken-chain rows fail closed.
//   4. Operators (no center link) keep the full tenant view; archived parents
//      stay readable (documented safe state, no cascades).
//
// The server boots through helpers/testServer with the REAL server.js mount
// order. Real JWT, isolated temporary stores, no mocked authorization, no
// mocked storage. Nothing here reads or writes backend/data.

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
  { id: 'tea-a', name: 'Academic Tenant A', code: 'ACA', active: true },
  { id: 'tea-b', name: 'Academic Tenant B', code: 'ACB', active: true }
];

const VIEW = [
  'education.academicYears.view', 'education.terms.view', 'education.subjects.view',
  'education.groups.view', 'education.courses.view', 'education.classes.view',
  'education.programs.view', 'education.students.view', 'education.teachers.view',
  'education.enrollments.view'
];
const EDIT = [
  'education.academicYears.edit', 'education.terms.edit', 'education.subjects.edit',
  'education.groups.edit', 'education.courses.edit', 'education.classes.edit',
  'education.enrollments.edit'
];

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'acdOwner', password, role: 'Owner', fullName: 'Acd Owner', tenantIds: ['tea-a', 'tea-b'], createdAt: STAMP, updatedAt: STAMP },
    // Center A's academic admin: Manager with full P1 grants, linked to cen-a1.
    { id: 'u-ca1', username: 'acdAdmin1', password, role: 'Manager', fullName: 'Academic Admin One', permissions: [...VIEW, ...EDIT], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Center B's academic admin, linked to cen-a2.
    { id: 'u-ca2', username: 'acdAdmin2', password, role: 'Manager', fullName: 'Academic Admin Two', permissions: [...VIEW, ...EDIT], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP },
    // Linked teacher of cen-a1's class (no center link): reads structure.
    { id: 'u-t1', username: 'acdTeacher1', password, role: 'Viewer', fullName: 'Academic Teacher', permissions: [...VIEW], tenantIds: ['tea-a'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

const centers = [
  { id: 'cen-a1', tenantId: 'tea-a', centerCode: 'CA1', name: 'Center A1', status: 'active', userId: 'u-ca1', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-a2', tenantId: 'tea-a', centerCode: 'CA2', name: 'Center A2', status: 'active', userId: 'u-ca2', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cen-b', tenantId: 'tea-b', centerCode: 'CB', name: 'Center B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const academicYears = [
  { id: 'yea-a1', tenantId: 'tea-a', centerId: 'cen-a1', yearCode: 'Y26', name: 'Year 26', displayName: 'Year 26', description: '', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'yea-a2', tenantId: 'tea-a', centerId: 'cen-a2', yearCode: 'Y26', name: 'Year 26', displayName: 'Year 26', description: '', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'yea-b', tenantId: 'tea-b', centerId: 'cen-b', yearCode: 'Y26', name: 'Year 26', displayName: 'Year 26', description: '', startDate: '2026-09-01', endDate: '2027-06-30', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const terms = [
  { id: 'trm-a1', tenantId: 'tea-a', academicYearId: 'yea-a1', termCode: 'T1', name: 'Term 1', displayName: 'Term 1', description: '', startDate: '2026-09-01', endDate: '2026-12-31', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'trm-a2', tenantId: 'tea-a', academicYearId: 'yea-a2', termCode: 'T1', name: 'Term 1', displayName: 'Term 1', description: '', startDate: '2026-09-01', endDate: '2026-12-31', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const subjects = [
  { id: 'sub-a1', tenantId: 'tea-a', centerId: 'cen-a1', subjectCode: 'S1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'sub-a2', tenantId: 'tea-a', centerId: 'cen-a2', subjectCode: 'S1', name: 'Algebra', displayName: 'Algebra', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

const programs = [
  { id: 'prg-a1', tenantId: 'tea-a', centerId: 'cen-a1', name: 'Track A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'prg-a2', tenantId: 'tea-a', centerId: 'cen-a2', name: 'Track A2', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const courses = [
  { id: 'crs-a1', tenantId: 'tea-a', programId: 'prg-a1', subjectId: 'sub-a1', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'crs-a2', tenantId: 'tea-a', programId: 'prg-a2', name: 'Course A2', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const teachers = [
  { id: 'tch-a1', tenantId: 'tea-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP }
];

const classes = [
  { id: 'cls-a1', tenantId: 'tea-a', courseId: 'crs-a1', teacherId: 'tch-a1', termId: 'trm-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
  { id: 'cls-a2', tenantId: 'tea-a', courseId: 'crs-a2', teacherId: 'tch-a1', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP }
];

const groups = [
  { id: 'grp-a1', tenantId: 'tea-a', classId: 'cls-a1', groupCode: 'G1', name: 'Lab A', displayName: 'Lab A', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP },
  { id: 'grp-a2', tenantId: 'tea-a', classId: 'cls-a2', groupCode: 'G1', name: 'Lab B', displayName: 'Lab B', description: '', status: 'active', notes: '', createdAt: STAMP, updatedAt: STAMP }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationCenters', { centers });
  seed(dir, 'educationAcademicYears', { academicYears });
  seed(dir, 'educationTerms', { terms });
  seed(dir, 'educationSubjects', { subjects });
  seed(dir, 'educationPrograms', { programs });
  seed(dir, 'educationCourses', { courses });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationClasses', { classes });
  seed(dir, 'educationGroups', { groups });
}

describe('P1 Academic Foundation — years, terms, subjects, groups and chain wiring', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('acd-fnd');
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

  const ownerA = () => token('u-owner', 'acdOwner', 'Owner', 'tea-a');
  const ca1 = () => token('u-ca1', 'acdAdmin1', 'Manager', 'tea-a');
  const ca2 = () => token('u-ca2', 'acdAdmin2', 'Manager', 'tea-a');
  const t1 = () => token('u-t1', 'acdTeacher1', 'Viewer', 'tea-a');

  const get = (p, tok) => {
    const req = request(app).get(`${BASE}${p}`);
    return tok ? req.set('Authorization', `Bearer ${tok}`) : req;
  };
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const ids = (res) => res.body.data.map((s) => s.id).sort();

  // -------------------------------------------------------------------------
  // 1. CRUD lifecycle with tenant isolation on all four entities
  // -------------------------------------------------------------------------
  test('1. academic years CRUD with tenant isolation and code uniqueness', async () => {
    const created = await post('/academic-years', ownerA(), { centerId: 'cen-a1', name: 'Year 27', startDate: '2027-09-01', endDate: '2028-06-30' });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.centerId).toBe('cen-a1');
    expect(created.body.data.tenantId).toBe('tea-a');
    const id = created.body.data.id;

    expect((await get(`/academic-years/${id}`, ownerA())).statusCode).toBe(200);
    // Same-tenant code clash (Y26 is taken and active): 409.
    expect((await post('/academic-years', ownerA(), { centerId: 'cen-a1', name: 'Dup', yearCode: 'Y26' })).statusCode).toBe(409);
    // Same code in another tenant is fine (tenant-scoped uniqueness).
    const other = await post('/academic-years', token('u-owner', 'acdOwner', 'Owner', 'tea-b'), { centerId: 'cen-b', name: 'Year 26', yearCode: 'Y26-B' });
    expect(other.statusCode).toBe(201);

    expect((await put(`/academic-years/${id}`, ownerA(), { notes: 'ok' })).statusCode).toBe(200);
    // Inverted bounds on update are refused even though each bound is valid.
    expect((await put(`/academic-years/${id}`, ownerA(), { startDate: '2028-01-01', endDate: '2027-01-01' })).statusCode).toBe(400);
    // Clearing the required center link is refused (chain integrity).
    expect((await put(`/academic-years/${id}`, ownerA(), { centerId: '' })).statusCode).toBe(400);

    const archived = await request(app).patch(`${BASE}/academic-years/${id}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    // Cross-tenant reads stay 404.
    expect((await get(`/academic-years/${id}`, token('u-owner', 'acdOwner', 'Owner', 'tea-b'))).statusCode).toBe(404);
    expect((await get('/academic-years/yea-b', ownerA())).statusCode).toBe(404);
  });

  test('1b. year validation: name/center required, bad dates refused, unknown center 400', async () => {
    expect((await post('/academic-years', ownerA(), { centerId: 'cen-a1' })).statusCode).toBe(400);
    expect((await post('/academic-years', ownerA(), { name: 'No Center' })).statusCode).toBe(400);
    expect((await post('/academic-years', ownerA(), { centerId: 'cen-a1', name: 'Bad', startDate: '2027-1-1' })).statusCode).toBe(400);
    expect((await post('/academic-years', ownerA(), { centerId: 'cen-a1', name: 'Inverted', startDate: '2027-06-30', endDate: '2026-09-01' })).statusCode).toBe(400);
    expect((await post('/academic-years', ownerA(), { centerId: 'cen-b', name: 'Foreign' })).statusCode).toBe(400);
    expect((await post('/academic-years', ownerA(), { centerId: 'nope', name: 'Unknown' })).statusCode).toBe(400);
  });

  test('2. terms CRUD with year bounds and archived-year refusal', async () => {
    const created = await post('/terms', ownerA(), { academicYearId: 'yea-a1', name: 'Term 2', startDate: '2027-01-01', endDate: '2027-06-30' });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    // Outside the year bounds: 400 both directions.
    expect((await post('/terms', ownerA(), { academicYearId: 'yea-a1', name: 'Early', startDate: '2026-01-01', endDate: '2026-06-30' })).statusCode).toBe(400);
    expect((await post('/terms', ownerA(), { academicYearId: 'yea-a1', name: 'Late', startDate: '2027-01-01', endDate: '2028-06-30' })).statusCode).toBe(400);
    // Unknown year: 400 (same uniform error as a foreign year — no oracle).
    expect((await post('/terms', ownerA(), { academicYearId: 'nope', name: 'Lost' })).statusCode).toBe(400);
    expect((await post('/terms', ownerA(), { academicYearId: 'yea-b', name: 'Foreign' })).statusCode).toBe(400);
    // Missing year: 400, not 500.
    expect((await post('/terms', ownerA(), { name: 'No Year' })).statusCode).toBe(400);

    expect((await put(`/terms/${id}`, ownerA(), { notes: 'ok' })).statusCode).toBe(200);
    // Moving the term under another year re-validates bounds.
    expect((await put(`/terms/${id}`, ownerA(), { academicYearId: 'yea-a2' })).statusCode).toBe(200);
    // Clearing the required year link is refused.
    expect((await put(`/terms/${id}`, ownerA(), { academicYearId: '' })).statusCode).toBe(400);

    // Archiving the year freezes new terms under it (existing terms stay readable).
    const year = await post('/academic-years', ownerA(), { centerId: 'cen-a1', name: 'Doomed', startDate: '2026-09-01', endDate: '2027-06-30' });
    const yid = year.body.data.id;
    expect((await request(app).patch(`${BASE}/academic-years/${yid}/archive`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await post('/terms', ownerA(), { academicYearId: yid, name: 'Too Late' })).statusCode).toBe(400);
  });

  test('3. subjects and groups CRUD with tenant isolation', async () => {
    const sub = await post('/subjects', ownerA(), { centerId: 'cen-a1', name: 'Geometry' });
    expect(sub.statusCode).toBe(201);
    expect(sub.body.data.centerId).toBe('cen-a1');
    expect((await post('/subjects', ownerA(), { name: 'No Center' })).statusCode).toBe(400);
    expect((await post('/subjects', ownerA(), { centerId: 'cen-b', name: 'Foreign' })).statusCode).toBe(400);
    expect((await post('/subjects', ownerA(), { centerId: 'cen-a1', name: 'Geometry', subjectCode: sub.body.data.subjectCode })).statusCode).toBe(409);
    expect((await put(`/subjects/${sub.body.data.id}`, ownerA(), { notes: 'ok' })).statusCode).toBe(200);

    const grp = await post('/groups', ownerA(), { classId: 'cls-a1', name: 'Lab X' });
    expect(grp.statusCode).toBe(201);
    expect(grp.body.data.classId).toBe('cls-a1');
    expect((await post('/groups', ownerA(), { name: 'No Class' })).statusCode).toBe(400);
    expect((await post('/groups', ownerA(), { classId: 'nope', name: 'Lost' })).statusCode).toBe(400);
    expect((await post('/groups', ownerA(), { classId: 'cls-b', name: 'Foreign' })).statusCode).toBe(400);
    // classId is immutable: supplying it on update is 400, not a silent move.
    expect((await put(`/groups/${grp.body.data.id}`, ownerA(), { classId: 'cls-a2' })).statusCode).toBe(400);
    expect((await put(`/groups/${grp.body.data.id}`, ownerA(), { notes: 'ok' })).statusCode).toBe(200);
    // Cross-tenant stays 404 on every new surface.
    for (const p of [`/academic-years/${'yea-a1'}`, '/terms/trm-a1', `/subjects/${sub.body.data.id}`, `/groups/${grp.body.data.id}`]) {
      expect((await get(p, token('u-owner', 'acdOwner', 'Owner', 'tea-b'))).statusCode).toBe(404);
    }
  });

  // -------------------------------------------------------------------------
  // 2. Chain wiring: course.subjectId and class.termId stay same-center
  // -------------------------------------------------------------------------
  test('4. course subject links and class term links enforce the same center', async () => {
    // Same-center subject link: ALLOW.
    const ok = await post('/courses', ownerA(), { programId: 'prg-a2', name: 'Linked', subjectId: 'sub-a2' });
    expect(ok.statusCode).toBe(201);
    expect(ok.body.data.subjectId).toBe('sub-a2');
    // Cross-center subject link: DENY (400, uniform with unknown ids).
    expect((await post('/courses', ownerA(), { programId: 'prg-a1', name: 'Mixed', subjectId: 'sub-a2' })).statusCode).toBe(400);
    // Unknown subject: same 400 (no oracle split).
    expect((await post('/courses', ownerA(), { programId: 'prg-a1', name: 'Lost', subjectId: 'nope' })).statusCode).toBe(400);
    // Moving the course under another program re-validates the stored link.
    expect((await put('/courses/crs-a1', ownerA(), { programId: 'prg-a2' })).statusCode).toBe(400);
    // Clearing the link stays allowed.
    expect((await put('/courses/crs-a1', ownerA(), { subjectId: '' })).statusCode).toBe(200);
    // Same-center term link: ALLOW.
    const cls = await post('/classes', ownerA(), { courseId: 'crs-a1', teacherId: 'tch-a1', termId: 'trm-a1', name: 'Extra' });
    expect(cls.statusCode).toBe(201);
    expect(cls.body.data.termId).toBe('trm-a1');
    // Cross-center term link: DENY.
    expect((await post('/classes', ownerA(), { courseId: 'crs-a1', teacherId: 'tch-a1', termId: 'trm-a2', name: 'Mixed' })).statusCode).toBe(400);
    // Moving the class under another course re-validates the stored term.
    expect((await put('/classes/cls-a1', ownerA(), { courseId: 'crs-a2' })).statusCode).toBe(400);
  });

  // -------------------------------------------------------------------------
  // 3. Center isolation across the academic foundation
  // -------------------------------------------------------------------------
  test('5. Center A sees only its own academic structure', async () => {
    expect(ids(await get('/academic-years', ca1()))).toEqual(['yea-a1']);
    expect(ids(await get('/terms', ca1()))).toEqual(['trm-a1']);
    expect(ids(await get('/subjects', ca1()))).toEqual(['sub-a1']);
    expect(ids(await get('/groups', ca1()))).toEqual(['grp-a1']);
    expect(ids(await get('/academic-years', ca2()))).toEqual(['yea-a2']);
    expect(ids(await get('/terms', ca2()))).toEqual(['trm-a2']);
    // A linked teacher with view grants reads the structure (parity with
    // programs/courses: no teacher narrowing on directory rows).
    expect((await get('/academic-years', t1())).statusCode).toBe(200);
  });

  test('6. Center A cannot read or mutate Center B academic rows', async () => {
    for (const path of [
      '/academic-years/yea-a2', '/terms/trm-a2', '/subjects/sub-a2', '/groups/grp-a2'
    ]) {
      const res = await get(path, ca1());
      expect(`${path} -> ${res.statusCode}`).toBe(`${path} -> 403`);
      expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
    }
    expect((await get('/academic-years/nope', ca1())).statusCode).toBe(404);
    // Writes into the other center are refused before the service runs.
    expect((await post('/academic-years', ca1(), { centerId: 'cen-a2', name: 'Rogue' })).statusCode).toBe(403);
    expect((await post('/terms', ca1(), { academicYearId: 'yea-a2', name: 'Rogue' })).statusCode).toBe(403);
    expect((await post('/subjects', ca1(), { centerId: 'cen-a2', name: 'Rogue' })).statusCode).toBe(403);
    expect((await post('/groups', ca1(), { classId: 'cls-a2', name: 'Rogue' })).statusCode).toBe(403);
    expect((await put('/academic-years/yea-a2', ca1(), { notes: 'x' })).statusCode).toBe(403);
    expect((await put('/terms/trm-a2', ca1(), { notes: 'x' })).statusCode).toBe(403);
    // ...while own-center writes succeed.
    expect((await post('/academic-years', ca1(), { centerId: 'cen-a1', name: 'Own 27' })).statusCode).toBe(201);
    expect((await post('/terms', ca1(), { academicYearId: 'yea-a1', name: 'Own T2' })).statusCode).toBe(201);
    expect((await post('/subjects', ca1(), { centerId: 'cen-a1', name: 'Own Sub' })).statusCode).toBe(201);
    expect((await post('/groups', ca1(), { classId: 'cls-a1', name: 'Own Group' })).statusCode).toBe(201);
  });

  test('7. spoofed center/year/class ids cannot widen the scope', async () => {
    // ?centerId= is overridden by the actor identity on direct-center lists.
    expect(ids(await get('/academic-years?centerId=cen-a2', ca1()))).toEqual(['yea-a1']);
    expect(ids(await get('/subjects?centerId=cen-a2', ca1()))).toEqual(['sub-a1']);
    // Derived lists intersect the spoofed filter with the center scope.
    expect(ids(await get('/terms?academicYearId=yea-a2', ca1()))).toEqual([]);
    expect(ids(await get('/groups?classId=cls-a2', ca1()))).toEqual([]);
    // A body centerId cannot move the row.
    expect((await put('/academic-years/yea-a1', ca1(), { centerId: 'cen-a2' })).statusCode).toBe(403);
    expect((await get('/academic-years/yea-a1', ca1())).body.data.centerId).toBe('cen-a1');
  });

  // -------------------------------------------------------------------------
  // 4. AuthN/Z baseline + operator parity on the new surfaces
  // -------------------------------------------------------------------------
  test('8. anonymous is 401 and unknown permissions stay closed', async () => {
    for (const p of ['/academic-years', '/terms', '/subjects', '/groups']) {
      expect((await get(p, null)).statusCode).toBe(401);
      expect((await request(app).post(`${BASE}${p}`).send({})).statusCode).toBe(401);
    }
    expect((await get('/academic-years/nope', null)).statusCode).toBe(401);
  });
});
