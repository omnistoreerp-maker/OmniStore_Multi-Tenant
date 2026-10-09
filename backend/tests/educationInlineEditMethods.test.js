'use strict';

// educationInlineEditMethods.test.js — Phase 2B Task 1.
//
// The ERP-inline Education client in index.html must call the update endpoints
// with the HTTP verb the backend actually declares. The backend education
// routers declare PUT /:id for updates (PATCH exists only on /archive and
// /withdraw sub-paths), so a PATCH to the resource path answers 404.
//
// This suite pins both halves of that contract:
//   1. Static: the four inline update helpers use PUT with the exact paths.
//   2. Runtime: PATCH to those paths is 404 while PUT succeeds, and the
//      existing authorization/tenant rules still apply (invalid payloads 400,
//      cross-tenant 404).

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const EXPECTED = [
  ['updateCenter', '/tenant/education/centers/'],
  ['updateTeacher', '/tenant/education/teachers/'],
  ['updateStudent', '/tenant/education/students/'],
  ['updateEnrollment', '/tenant/education/enrollments/']
];

describe('ERP-inline education update helpers use the declared PUT contract', () => {
  test.each(EXPECTED)('%s issues PUT to %s:id', (helper, prefix) => {
    const re = new RegExp(helper + ":\\s*\\(id,\\s*data\\)\\s*=>[^\\n]*backendApi\\._fetch\\('([A-Z]+)',\\s*'([^']+)'");
    const match = HTML.match(re);
    expect(match).not.toBeNull();
    expect(match[1]).toBe('PUT');
    expect(match[2]).toBe(prefix);
  });

  test('no inline education update helper still uses PATCH on a resource path', () => {
    for (const [helper] of EXPECTED) {
      const line = HTML.split('\n').find((l) => l.includes(helper + ':'));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/_fetch\('PATCH'/);
    }
  });

  test('backend declares PUT (not PATCH) on the four update paths', () => {
    const routes = {
      centers: fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'center.routes.js'), 'utf8'),
      teachers: fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'teacher.routes.js'), 'utf8'),
      students: fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'student.routes.js'), 'utf8'),
      enrollments: fs.readFileSync(path.join(ROOT, 'backend', 'routes', 'enrollment.routes.js'), 'utf8')
    };
    expect(routes.centers).toMatch(/router\.put\('\/centers\/:id'/);
    expect(routes.teachers).toMatch(/router\.put\('\/teachers\/:id'/);
    expect(routes.students).toMatch(/router\.put\('\/students\/:id'/);
    expect(routes.enrollments).toMatch(/router\.put\('\/enrollments\/:id'/);
    expect(routes.centers).not.toMatch(/router\.patch\('\/centers\/:id'/);
    expect(routes.teachers).not.toMatch(/router\.patch\('\/teachers\/:id'/);
    expect(routes.students).not.toMatch(/router\.patch\('\/students\/:id'/);
    expect(routes.enrollments).not.toMatch(/router\.patch\('\/enrollments\/:id'/);
  });
});

describe('ERP-inline education updates reach the backend routes', () => {
  const ORIGINAL_ENV = {
    CARRY: process.env.ENABLE_TENANT_CARRY,
    MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
    MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
    ROLES: process.env.ENABLE_TENANT_ROLES,
    AUTH: process.env.AUTH_REQUIRED,
    DATA: process.env.DIGITRONICS_DATA_DIR
  };
  const STAMP = '2026-01-01T00:00:00.000Z';
  const BASE = '/api/v1/tenant/education';
  const HASH = bcrypt.hashSync('Pass#123', 10);
  let app;
  let dir;

  beforeEach(() => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    dir = makeTempDataDir('inline-edit');
    seed(dir, 'companies', [
      { id: 't1', name: 'Team One', active: true },
      { id: 't2', name: 'Team Two', active: true }
    ]);
    seed(dir, 'users', { users: [
      { id: 'u-a', username: 'ownerA', password: HASH, role: 'Owner', fullName: 'Owner A', tenantIds: ['t1'], createdAt: STAMP, updatedAt: STAMP },
      { id: 'u-b', username: 'ownerB', password: HASH, role: 'Owner', fullName: 'Owner B', tenantIds: ['t2'], createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationCenters', { centers: [] });
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  afterAll(() => {
    if (ORIGINAL_ENV.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
    if (ORIGINAL_ENV.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_ENV.MC;
    if (ORIGINAL_ENV.MEM === undefined) delete process.env.ENABLE_TENANT_USER_MEMBERSHIP; else process.env.ENABLE_TENANT_USER_MEMBERSHIP = ORIGINAL_ENV.MEM;
    if (ORIGINAL_ENV.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_ENV.ROLES;
    if (ORIGINAL_ENV.AUTH === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    if (ORIGINAL_ENV.DATA === undefined) delete process.env.DIGITRONICS_DATA_DIR; else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  async function loginAs(username) {
    const company = username === 'ownerA' ? 't1' : 't2';
    const res = await request(app).post('/api/v1/auth/login').send({ username, password: 'Pass#123', company });
    expect(res.statusCode).toBe(200);
    return res.body.data.accessToken;
  }

  test('PATCH to an update path is 404 while PUT succeeds', async () => {
    const token = await loginAs('ownerA');
    const created = await request(app).post(`${BASE}/centers`).set('Authorization', `Bearer ${token}`).send({ name: 'Inline Center', centerCode: 'IC1' });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    const patched = await request(app).patch(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Patched' });
    expect(patched.statusCode).toBe(404);
    const updated = await request(app).put(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${token}`).send({ name: 'Inline Center Renamed' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.name).toBe('Inline Center Renamed');
  });

  test('invalid payloads and cross-tenant edits stay rejected on PUT', async () => {
    const tokenA = await loginAs('ownerA');
    const tokenB = await loginAs('ownerB');
    const created = await request(app).post(`${BASE}/centers`).set('Authorization', `Bearer ${tokenA}`).send({ name: 'Tenant One', centerCode: 'TO1' });
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    const forged = await request(app).put(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${tokenA}`).send({ name: 'X', tenantId: 't2' });
    expect(forged.statusCode).toBe(400);
    const foreign = await request(app).put(`${BASE}/centers/${id}`).set('Authorization', `Bearer ${tokenB}`).send({ name: 'Hijack' });
    expect(foreign.statusCode).toBe(404);
  });
});

describe('ERP-inline PUT runtime for teachers, students and enrollments', () => {
  const ORIGINAL_ENV = {
    CARRY: process.env.ENABLE_TENANT_CARRY,
    MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
    MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
    ROLES: process.env.ENABLE_TENANT_ROLES,
    AUTH: process.env.AUTH_REQUIRED,
    DATA: process.env.DIGITRONICS_DATA_DIR
  };
  const STAMP = '2026-01-01T00:00:00.000Z';
  const BASE = '/api/v1/tenant/education';
  const HASH = bcrypt.hashSync('Pass#123', 10);
  let app;
  let dir;

  beforeEach(() => {
    process.env.ENABLE_TENANT_CARRY = 'true';
    process.env.ENABLE_MULTI_COMPANY_LOGIN = 'true';
    process.env.ENABLE_TENANT_USER_MEMBERSHIP = 'true';
    process.env.ENABLE_TENANT_ROLES = 'true';
    dir = makeTempDataDir('inline-edit-4');
    seed(dir, 'companies', [
      { id: 't1', name: 'Team One', active: true },
      { id: 't2', name: 'Team Two', active: true }
    ]);
    seed(dir, 'users', { users: [
      { id: 'u-a', username: 'ownerA', password: HASH, role: 'Owner', fullName: 'Owner A', tenantIds: ['t1'], createdAt: STAMP, updatedAt: STAMP },
      { id: 'u-b', username: 'ownerB', password: HASH, role: 'Owner', fullName: 'Owner B', tenantIds: ['t2'], createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationPrograms', { programs: [
      { id: 'prg-1', tenantId: 't1', name: 'Track 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationCourses', { courses: [
      { id: 'crs-1', tenantId: 't1', programId: 'prg-1', name: 'Course 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationTeachers', { teachers: [
      { id: 'tch-1', tenantId: 't1', teacherCode: 'T1', firstName: 'Ann', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationClasses', { classes: [
      { id: 'cls-1', tenantId: 't1', courseId: 'crs-1', teacherId: 'tch-1', classCode: 'C1', name: 'Class 1', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationStudents', { students: [
      { id: 'stu-1', tenantId: 't1', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', createdAt: STAMP, updatedAt: STAMP }
    ] });
    seed(dir, 'educationEnrollments', { enrollments: [
      { id: 'enr-1', tenantId: 't1', studentId: 'stu-1', classId: 'cls-1', status: 'active', notes: '', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP }
    ] });
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  afterAll(() => {
    if (ORIGINAL_ENV.CARRY === undefined) delete process.env.ENABLE_TENANT_CARRY; else process.env.ENABLE_TENANT_CARRY = ORIGINAL_ENV.CARRY;
    if (ORIGINAL_ENV.MC === undefined) delete process.env.ENABLE_MULTI_COMPANY_LOGIN; else process.env.ENABLE_MULTI_COMPANY_LOGIN = ORIGINAL_ENV.MC;
    if (ORIGINAL_ENV.MEM === undefined) delete process.env.ENABLE_TENANT_USER_MEMBERSHIP; else process.env.ENABLE_TENANT_USER_MEMBERSHIP = ORIGINAL_ENV.MEM;
    if (ORIGINAL_ENV.ROLES === undefined) delete process.env.ENABLE_TENANT_ROLES; else process.env.ENABLE_TENANT_ROLES = ORIGINAL_ENV.ROLES;
    if (ORIGINAL_ENV.AUTH === undefined) delete process.env.AUTH_REQUIRED; else process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    if (ORIGINAL_ENV.DATA === undefined) delete process.env.DIGITRONICS_DATA_DIR; else process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  async function loginAs(username) {
    const company = username === 'ownerA' ? 't1' : 't2';
    const res = await request(app).post('/api/v1/auth/login').send({ username, password: 'Pass#123', company });
    expect(res.statusCode).toBe(200);
    return res.body.data.accessToken;
  }

  test('teachers: same-tenant PUT succeeds, forged and cross-tenant fail', async () => {
    const tokenA = await loginAs('ownerA');
    const tokenB = await loginAs('ownerB');
    const updated = await request(app).put(`${BASE}/teachers/tch-1`).set('Authorization', `Bearer ${tokenA}`).send({ lastName: 'Two' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.lastName).toBe('Two');
    const forged = await request(app).put(`${BASE}/teachers/tch-1`).set('Authorization', `Bearer ${tokenA}`).send({ lastName: 'X', tenantId: 't2' });
    expect(forged.statusCode).toBe(400);
    const foreign = await request(app).put(`${BASE}/teachers/tch-1`).set('Authorization', `Bearer ${tokenB}`).send({ lastName: 'Hijack' });
    expect(foreign.statusCode).toBe(404);
  });

  test('students: same-tenant PUT succeeds, forged and cross-tenant fail', async () => {
    const tokenA = await loginAs('ownerA');
    const tokenB = await loginAs('ownerB');
    const updated = await request(app).put(`${BASE}/students/stu-1`).set('Authorization', `Bearer ${tokenA}`).send({ lastName: 'Two' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.lastName).toBe('Two');
    const forged = await request(app).put(`${BASE}/students/stu-1`).set('Authorization', `Bearer ${tokenA}`).send({ lastName: 'X', tenantId: 't2' });
    expect(forged.statusCode).toBe(400);
    const foreign = await request(app).put(`${BASE}/students/stu-1`).set('Authorization', `Bearer ${tokenB}`).send({ lastName: 'Hijack' });
    expect(foreign.statusCode).toBe(404);
  });

  test('enrollments: notes-only PUT succeeds, relationship edits and cross-tenant fail', async () => {
    const tokenA = await loginAs('ownerA');
    const tokenB = await loginAs('ownerB');
    const updated = await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${tokenA}`).send({ notes: 'moved to room 4' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.notes).toBe('moved to room 4');
    const relink = await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${tokenA}`).send({ studentId: 'stu-1', classId: 'cls-1' });
    expect(relink.statusCode).toBe(400);
    const foreign = await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${tokenB}`).send({ notes: 'hijack' });
    expect(foreign.statusCode).toBe(404);
  });
});
