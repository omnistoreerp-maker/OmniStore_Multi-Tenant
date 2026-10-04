'use strict';

// Authenticated HTTP-level E2E + tenant-isolation proof for the Education
// module. Modeled on tests/phaseG.tenantUserIsolation.test.js: tenant identity
// comes ONLY from the signed JWT claim carried by tenantCarry, never from a
// header/body/query vector.
//
// The mounted surface is the real one: center/teacher/student/program/course/
// class/enrollment routers under /api/v1/tenant/education (see server.js).
// List endpoints answer with a plain array in `data`, not a pagination object.
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
    const read = await request(server.app).get(EDU + '/centers');
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
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.length).toBeGreaterThanOrEqual(1);
    expect(list.body.data.some((c) => c.name === 'Digi Center')).toBe(true);
  });

  test('tenant B cannot see tenant A centers', async () => {
    const a = await tokenFor('digiOwner', 'digi');
    const b = await tokenFor('nileOwner', 'nile');
    const listB = await request(server.app).get(EDU + '/centers').set(authHeader(b));
    expect(listB.statusCode).toBe(200);
    expect(Array.isArray(listB.body.data)).toBe(true);
    expect(listB.body.data.some((c) => c.name === 'Digi Center')).toBe(false);

    const listA = await request(server.app).get(EDU + '/centers').set(authHeader(a));
    const digiCenterId = listA.body.data[0].id;

    const readB = await request(server.app).get(EDU + '/centers/' + digiCenterId).set(authHeader(b));
    expect(readB.statusCode).toBe(404);
    expect(String(readB.body.message)).toMatch(/Center not found/i);

    const putB = await request(server.app)
      .put(EDU + '/centers/' + digiCenterId)
      .set(authHeader(b))
      .send({ name: 'hijacked' });
    expect(putB.statusCode).toBe(404);
    expect(String(putB.body.message)).toMatch(/Center not found/i);
  });

  test('forged X-Tenant-Id header never reveals another tenant', async () => {
    const b = await tokenFor('nileOwner', 'nile');
    const list = await request(server.app)
      .get(EDU + '/centers')
      .set(authHeader(b))
      .set('X-Tenant-Id', 'digi');
    expect(list.statusCode).toBe(200);
    expect(list.body.data.some((c) => c.name === 'Digi Center')).toBe(false);
    expect(list.body.data.every((c) => c.tenantId === 'nile')).toBe(true);
  });

  test('cross-tenant reference in a payload is denied', async () => {
    const a = await tokenFor('digiOwner', 'digi');
    const b = await tokenFor('nileOwner', 'nile');
    const listA = await request(server.app).get(EDU + '/centers').set(authHeader(a));
    const digiCenterId = listA.body.data[0].id;

    // tenant B points a Program at tenant A's Center: the service resolves the
    // reference inside the TRUSTED tenant only, so it is refused as missing.
    const res = await request(server.app)
      .post(EDU + '/programs')
      .set(authHeader(b))
      .send({ name: 'evil', centerId: digiCenterId });
    expect(res.statusCode).toBe(400);
    expect(String(res.body.message)).toMatch(/centerId does not reference a Center/i);
  });
});

describe('education end-to-end journey (authenticated)', () => {
  test('center → teacher → student → program → course → class → enrollment → withdraw', async () => {
    const token = await tokenFor('digiOwner', 'digi');
    const as = (r) => r.set(authHeader(token));

    const center = (await as(request(server.app).post(EDU + '/centers')).send({ name: 'Journey Center' })).body.data;
    const teacher = (await as(request(server.app).post(EDU + '/teachers'))
      .send({ firstName: 'Sara', lastName: 'Nassef' })).body.data;
    const student = (await as(request(server.app).post(EDU + '/students'))
      .send({ firstName: 'Omar', lastName: 'Hassan' })).body.data;
    const program = (await as(request(server.app).post(EDU + '/programs'))
      .send({ name: 'Math Track', centerId: center.id })).body.data;
    const course = (await as(request(server.app).post(EDU + '/courses'))
      .send({ name: 'Algebra Basics', programId: program.id })).body.data;

    expect(center.tenantId).toBe('digi');
    expect(teacher.tenantId).toBe('digi');
    expect(student.tenantId).toBe('digi');
    expect(program.centerId).toBe(center.id);
    expect(course.tenantId).toBe('digi');

    const klass = (await as(request(server.app).post(EDU + '/classes'))
      .send({ courseId: course.id, teacherId: teacher.id, name: 'A1' })).body.data;
    expect(klass.tenantId).toBe('digi');

    const enrollment = (await as(request(server.app).post(EDU + '/enrollments'))
      .send({ studentId: student.id, classId: klass.id })).body.data;
    expect(enrollment.status).toBe('active');
    expect(enrollment.tenantId).toBe('digi');
    expect(typeof enrollment.enrolledAt).toBe('string');
    expect(enrollment.withdrawnAt).toBeNull();

    // The lists are tenant-scoped arrays; every row belongs to this tenant.
    for (const path of ['/centers', '/teachers', '/students', '/programs', '/courses', '/classes', '/enrollments']) {
      const list = await as(request(server.app).get(EDU + path));
      expect(list.statusCode).toBe(200);
      expect(Array.isArray(list.body.data)).toBe(true);
      expect(list.body.data.length).toBeGreaterThanOrEqual(1);
      expect(list.body.data.every((row) => row.tenantId === 'digi')).toBe(true);
    }

    // Cross-tenant read of the enrollment is refused as absent.
    const bToken = await tokenFor('nileOwner', 'nile');
    const foreign = await request(server.app)
      .get(EDU + '/enrollments/' + enrollment.id)
      .set(authHeader(bToken));
    expect(foreign.statusCode).toBe(404);
    expect(String(foreign.body.message)).toMatch(/Enrollment not found/i);

    // Enrollment lifecycle: withdraw is non-destructive and stamps both
    // withdrawnAt and updatedAt with the same server instant.
    const withdrawn = (await as(request(server.app)
      .patch(EDU + '/enrollments/' + enrollment.id + '/withdraw'))).body.data;
    expect(withdrawn.status).toBe('withdrawn');
    expect(withdrawn.id).toBe(enrollment.id);
    expect(withdrawn.enrolledAt).toBe(enrollment.enrolledAt);
    expect(withdrawn.withdrawnAt).toBe(withdrawn.updatedAt);
    expect(withdrawn.updatedAt).not.toBe(enrollment.updatedAt);

    // The withdrawal is idempotent: a retry never moves the original
    // withdrawnAt.
    const twice = (await as(request(server.app)
      .patch(EDU + '/enrollments/' + enrollment.id + '/withdraw'))).body.data;
    expect(twice.withdrawnAt).toBe(withdrawn.withdrawnAt);
  });
});

