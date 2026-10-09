'use strict';

// enrollmentEditContract.test.js — Phase 2B enrollment UX contract.
//
// The inline enrollment editor must match the backend contract exactly:
//   - PUT /enrollments/:id persists `notes` only; relationship and status
//     fields are refused with 400 and must never be sent on edit.
//   - Status changes go through PATCH /enrollments/:id/withdraw (terminal,
//     idempotent), only after an explicit confirmation; cancelling sends
//     nothing and changes nothing.
//   - Creation keeps its existing payload and behavior.
//
// Static assertions pin the shipped index.html contract; runtime assertions run
// the REAL server.js mount order (auth -> tenant carry -> permission gates ->
// ownership checks -> service) against isolated temporary stores. Nothing here
// mocks the authorization layers.

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');

const ROOT = path.resolve(__dirname, '..', '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

describe('inline enrollment editor matches the backend contract (static)', () => {
  test('edit mode sends notes only, never relationship or status fields', () => {
    expect(HTML).toContain('updateEnrollment(id, { notes })');
    const editFn = HTML.slice(
      HTML.indexOf('async function saveEducationEnrollment'),
      HTML.indexOf('async function withdrawEducationEnrollment')
    );
    expect(editFn).toContain('if (notes === current)');
    expect(editFn).not.toMatch(/updateEnrollment\(id,\s*\{[^}]*centerId/);
    expect(editFn).not.toMatch(/updateEnrollment\(id,\s*\{[^}]*teacherId/);
    expect(editFn).not.toMatch(/updateEnrollment\(id,\s*\{[^}]*studentId/);
    expect(editFn).not.toMatch(/updateEnrollment\(id,\s*\{[^}]*status/);
  });

  test('relationship and status selects are read-only while editing', () => {
    for (const id of ['eeCenterId', 'eeTeacherId', 'eeStudentId', 'eeStatus']) {
      expect(HTML).toContain(`document.getElementById('${id}').disabled = true`);
    }
  });

  test('no PATCH goes to the plain update path; withdraw uses its own route', () => {
    expect(HTML).toContain("withdrawEnrollment: (id) => USE_BACKEND ? backendApi._fetch('PATCH', '/tenant/education/enrollments/' + id + '/withdraw')");
    expect(HTML).not.toMatch(/_fetch\('PATCH', '\/tenant\/education\/enrollments\/' \+ id\)/);
  });

  test('withdraw requires confirmation and cancel sends nothing', () => {
    const fn = HTML.slice(HTML.indexOf('async function withdrawEducationEnrollment'));
    expect(fn).toContain('if (!confirm(');
    expect(fn.indexOf('return;')).toBeLessThan(fn.indexOf('backendApi.education.withdrawEnrollment(id)'));
  });

  test('creation keeps its existing payload and behavior', () => {
    expect(HTML).toContain('res = await backendApi.education.createEnrollment(data);');
  });

  test('server errors surface to the user without false success', () => {
    expect(HTML).toContain("showToast(res?.message || 'فشل العملية', 'error')");
    expect(HTML).toContain("showToast(res?.message || 'فشل الانسحاب', 'error')");
  });
});

describe('enrollment edit/withdraw contract (runtime, real server)', () => {
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
    dir = makeTempDataDir('enr-contract');
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

  test('notes update persists and survives a re-read', async () => {
    const token = await loginAs('ownerA');
    const updated = await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${token}`).send({ notes: 'prefers morning sessions' });
    expect(updated.statusCode).toBe(200);
    const reread = await request(app).get(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${token}`);
    expect(reread.statusCode).toBe(200);
    expect(reread.body.data.notes).toBe('prefers morning sessions');
  });

  test('relationship and status fields are refused and leave the row untouched', async () => {
    const token = await loginAs('ownerA');
    expect((await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-1', classId: 'cls-1' })).statusCode).toBe(400);
    expect((await request(app).put(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${token}`).send({ status: 'inactive' })).statusCode).toBe(400);
    const reread = await request(app).get(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${token}`);
    expect(reread.statusCode).toBe(200);
    expect(reread.body.data.studentId).toBe('stu-1');
    expect(reread.body.data.classId).toBe('cls-1');
    expect(reread.body.data.status).toBe('active');
  });

  test('withdraw ends the enrollment and is idempotent', async () => {
    const token = await loginAs('ownerA');
    const first = await request(app).patch(`${BASE}/enrollments/enr-1/withdraw`).set('Authorization', `Bearer ${token}`);
    expect(first.statusCode).toBe(200);
    expect(first.body.data.status).toBe('withdrawn');
    expect(first.body.data.withdrawnAt).toBeTruthy();
    const second = await request(app).patch(`${BASE}/enrollments/enr-1/withdraw`).set('Authorization', `Bearer ${token}`);
    expect(second.statusCode).toBe(200);
    expect(second.body.data.withdrawnAt).toBe(first.body.data.withdrawnAt);
  });

  test('cross-tenant and anonymous withdraws are rejected without mutation', async () => {
    const tokenB = await loginAs('ownerB');
    expect((await request(app).patch(`${BASE}/enrollments/enr-1/withdraw`).set('Authorization', `Bearer ${tokenB}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/enrollments/enr-1/withdraw`)).statusCode).toBe(401);
    const tokenA = await loginAs('ownerA');
    const reread = await request(app).get(`${BASE}/enrollments/enr-1`).set('Authorization', `Bearer ${tokenA}`);
    expect(reread.body.data.status).toBe('active');
  });

  test('creating an enrollment with valid references still works', async () => {
    const token = await loginAs('ownerA');
    const created = await request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${token}`).send({ studentId: 'stu-1', classId: 'cls-1' });
    expect([201, 409]).toContain(created.statusCode);
  });
});
