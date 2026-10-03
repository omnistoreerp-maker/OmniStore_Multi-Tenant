'use strict';

// Authenticated HTTP-level E2E + tenant-isolation proof for the Education
// Core. Modeled on tests/phaseG.tenantUserIsolation.test.js: tenant identity
// comes ONLY from the signed JWT claim carried by tenantCarry, never from a
// header/body/query vector.
//
// Matrix:
//   Tenant A -> Tenant A = PASS
//   Tenant A -> Tenant B = DENY (read, cross-tenant link, forged header)

const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed } = require('./helpers/testData');
const { login, authHeader } = require('./helpers/authHelper');
const { registerCleanup } = require('./helpers/cleanup');

const ORIGINAL_ENV = {
  ROLES: process.env.ENABLE_TENANT_ROLES,
  CARRY: process.env.ENABLE_TENANT_CARRY,
  MC: process.env.ENABLE_MULTI_COMPANY_LOGIN,
  MEM: process.env.ENABLE_TENANT_USER_MEMBERSHIP,
  AUTH: process.env.AUTH_REQUIRED
};

const companies = [
  { id: 'digi', name: 'DigiTronics', active: true },
  { id: 'nile', name: 'Nile Electronics', active: true }
];

const PASSWORD = 'Pass#123';
let server;
let dataDir;

registerCleanup(() => [server], () => [dataDir]);

beforeAll(async () => {
  for (const key of ['ENABLE_TENANT_ROLES', 'ENABLE_TENANT_CARRY', 'ENABLE_MULTI_COMPANY_LOGIN', 'ENABLE_TENANT_USER_MEMBERSHIP']) {
    process.env[key] = 'true';
  }
  dataDir = makeTempDataDir('edu-authz');
  seed(dataDir, 'companies', companies);
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(PASSWORD, 10);
  const stamp = new Date().toISOString();
  seed(dataDir, 'users', {
    users: [
      { id: 'u-digi', username: 'digiOwner', password: hash, fullName: 'Digi Owner', role: 'Owner', tenantIds: ['digi'], createdAt: stamp, updatedAt: stamp },
      { id: 'u-nile', username: 'nileOwner', password: hash, fullName: 'Nile Owner', role: 'Owner', tenantIds: ['nile'], createdAt: stamp, updatedAt: stamp }
    ]
  });
  server = await startServer(dataDir, { AUTH_REQUIRED: 'true' });
});

afterAll(() => {
  for (const [key, original] of Object.entries(ORIGINAL_ENV)) {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

async function tokenFor(username, company) {
  const session = await login(server.app, username, PASSWORD, company);
  return session.accessToken;
}

const EDU = '/api/v1/tenant/education';

describe('education authorization (AUTH_REQUIRED=true)', () => {
  test('anonymous reads and writes are rejected with 401', async () => {
    const read = await request(server.app).get(EDU + '/dashboard');
    expect(read.statusCode).toBe(401);
    const write = await request(server.app).post(EDU + '/centers').send({ name: 'X' });
    expect(write.statusCode).toBe(401);
  });

  test('tenant A can create and read its own centers', async () => {
    const token = await tokenFor('digiOwner', 'digi');
    const created = await request(server.app)
      .post(EDU + '/centers')
      .set(authHeader(token))
      .send({ name: 'Digi Center' });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('digi');

    const list = await request(server.app).get(EDU + '/centers').set(authHeader(token));
    expect(list.statusCode).toBe(200);
    expect(list.body.data.total).toBeGreaterThanOrEqual(1);
    expect(list.body.data.items.some((c) => c.name === 'Digi Center')).toBe(true);
  });

  test('tenant B cannot see tenant A centers', async () => {
    const a = await tokenFor('digiOwner', 'digi');
    const b = await tokenFor('nileOwner', 'nile');
    const listB = await request(server.app).get(EDU + '/centers').set(authHeader(b));
    expect(listB.statusCode).toBe(200);
    expect(listB.body.data.items.some((c) => c.name === 'Digi Center')).toBe(false);

    const listA = await request(server.app).get(EDU + '/centers').set(authHeader(a));
    const digiCenterId = listA.body.data.items[0].id;

    const readB = await request(server.app).get(EDU + '/centers/' + digiCenterId).set(authHeader(b));
    expect(readB.statusCode).toBe(404);
    expect(String(readB.body.message)).toMatch(/Center not found/i);

    const patchB = await request(server.app)
      .patch(EDU + '/centers/' + digiCenterId)
      .set(authHeader(b))
      .send({ name: 'hijacked' });
    expect(patchB.statusCode).toBe(404);
  });

  test('forged X-Tenant-Id header never reveals another tenant', async () => {
    const b = await tokenFor('nileOwner', 'nile');
    const list = await request(server.app)
      .get(EDU + '/centers')
      .set(authHeader(b))
      .set('X-Tenant-Id', 'digi');
    expect(list.statusCode).toBe(200);
    expect(list.body.data.items.some((c) => c.name === 'Digi Center')).toBe(false);
    expect(list.body.data.items.every((c) => c.tenantId === 'nile')).toBe(true);
  });

  test('cross-tenant reference in a payload is denied', async () => {
    const a = await tokenFor('digiOwner', 'digi');
    const b = await tokenFor('nileOwner', 'nile');
    const listA = await request(server.app).get(EDU + '/centers').set(authHeader(a));
    const digiCenterId = listA.body.data.items[0].id;

    const res = await request(server.app)
      .post(EDU + '/courses')
      .set(authHeader(b))
      .send({ title: 'evil', centerId: digiCenterId });
    expect(res.statusCode).toBe(404);
    expect(String(res.body.message)).toMatch(/Center not found/i);
  });
});

describe('education end-to-end journey (authenticated)', () => {
  test('center → teacher → student → course → lessons → enrollment → progress → publish', async () => {
    const token = await tokenFor('digiOwner', 'digi');
    const as = (r) => r.set(authHeader(token));

    const center = (await as(request(server.app).post(EDU + '/centers')).send({ name: 'Journey Center' })).body.data;
    const teacher = (await as(request(server.app).post(EDU + '/teachers'))
      .send({ displayName: 'Ms. Sara', centerId: center.id, subjects: ['Math'] })).body.data;
    const student = (await as(request(server.app).post(EDU + '/students'))
      .send({ displayName: 'Omar', grade: 'Grade 5', centerId: center.id })).body.data;
    const course = (await as(request(server.app).post(EDU + '/courses'))
      .send({ title: 'Algebra Basics', centerId: center.id, teacherId: teacher.id })).body.data;

    expect(course.status).toBe('draft');
    expect(teacher.tenantId).toBe('digi');
    expect(student.tenantId).toBe('digi');

    const l1 = (await as(request(server.app).post(EDU + '/lessons'))
      .send({ title: 'Intro', courseId: course.id })).body.data;
    const l2 = (await as(request(server.app).post(EDU + '/lessons'))
      .send({ title: 'Variables', courseId: course.id })).body.data;
    expect(l1.order).toBe(1);
    expect(l2.order).toBe(2);

    const lessons = (await as(request(server.app).get(EDU + '/courses/' + course.id + '/lessons'))).body.data;
    expect(lessons.map((l) => l.title)).toEqual(['Intro', 'Variables']);

    const enrollment = (await as(request(server.app).post(EDU + '/enrollments'))
      .send({ courseId: course.id, studentId: student.id })).body.data;
    expect(enrollment.status).toBe('active');

    // dashboard reports REAL counts derived from stored data
    const dash = (await as(request(server.app).get(EDU + '/dashboard'))).body.data;
    expect(dash.students).toBeGreaterThanOrEqual(1);
    expect(dash.courses).toBeGreaterThanOrEqual(1);
    expect(dash.enrollments).toBeGreaterThanOrEqual(1);
    expect(dash.publishedCourses).toBeGreaterThanOrEqual(0);

    // publish the course, then track real lesson progress
    const published = (await as(request(server.app).patch(EDU + '/courses/' + course.id))
      .send({ status: 'published' })).body.data;
    expect(published.status).toBe('published');

    await as(request(server.app).post(EDU + '/progress/lesson'))
      .send({ enrollmentId: enrollment.id, lessonId: l1.id });
    let prog = (await as(request(server.app).get(EDU + '/enrollments/' + enrollment.id + '/progress'))).body.data;
    expect(prog.percentage).toBe(50);
    expect(prog.totalLessons).toBe(2);

    await as(request(server.app).post(EDU + '/progress/lesson'))
      .send({ enrollmentId: enrollment.id, lessonId: l2.id });
    prog = (await as(request(server.app).get(EDU + '/enrollments/' + enrollment.id + '/progress'))).body.data;
    expect(prog.percentage).toBe(100);
    expect(prog.completedLessons).toBe(2);

    // enrollment lifecycle
    const done = (await as(request(server.app).patch(EDU + '/enrollments/' + enrollment.id + '/status'))
      .send({ status: 'completed' })).body.data;
    expect(done.status).toBe('completed');
  });
});

