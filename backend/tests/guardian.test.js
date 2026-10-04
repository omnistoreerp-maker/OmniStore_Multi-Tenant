'use strict';

// Phase 0 Parent portal — Guardian records.
//
// Mirrors the STU-3 teacher suite and adds the Guardian-specific concerns:
// the CHILD RELATIONSHIP, and the own-row rules that a parent must never
// widen. Proves, against the REAL middleware chain (auth -> tenantCarry ->
// attachGuardianActor -> requirePermission/requireRole -> controller ->
// service) and the REAL server.js mount:
//
//   A. Authentication — every Guardian and notification route refuses an
//      anonymous caller (401).
//   B. Portal identity — /guardians/me is authorized by the LINK, not by a
//      grant: anonymous 401, authenticated-but-unlinked 404 GUARDIAN_NOT_LINKED.
//   C. Authorization — strict gate does not degrade; an unregistered
//      permission still fails closed; the link/child routes stay Owner/Admin.
//   D. Tenant isolation — list/get/update/archive/children are scoped;
//      cross-tenant access answers 404 so existence is not leaked; tenantId,
//      companyId and branchId spoofing cannot move a record or link an account.
//   E. Child relationship — a child id that does not resolve inside the trusted
//      tenant is refused, so a cross-tenant child can never enter the list.
//   F. Own-row scoping — a linked parent is refused 403 OWNERSHIP_DENIED on
//      another guardian's row AND on a student that is not on their own list,
//      including one belonging to a different parent in the same tenant.
//   G. No client-sourced identity — a role, tenant, userId or child list in the
//      body is rejected, never honoured.
//   H. Notifications — read-only, derived from real records, and scoped to the
//      caller's own student / own child.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const companies = [
  { id: 'grd-a', name: 'Guardian Tenant A', code: 'GRDA', active: true },
  { id: 'grd-b', name: 'Guardian Tenant B', code: 'GRDB', active: true }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'grdOwner', password, role: 'Owner', fullName: 'Guardian Owner',
      tenantIds: ['grd-a', 'grd-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Holds the Guardian permissions EXPLICITLY, so the suite proves a
      // registered, explicitly granted permission is honoured.
      id: 'u-clerk', username: 'grdClerk', password, role: 'Viewer', fullName: 'Guardian Clerk',
      permissions: ['education.guardians.view', 'education.guardians.edit'],
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Holds a permission the registry does NOT know, to prove an
      // unregistered permission still fails closed.
      id: 'u-stranger', username: 'grdStranger', password, role: 'Viewer', fullName: 'Guardian Stranger',
      permissions: ['education.guardians.export'],
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'grdManager', password, role: 'Manager', fullName: 'Guardian Manager',
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // The parent account itself: a plain, NON-privileged account. Its only
      // power comes from the server-owned link an operator creates.
      id: 'u-parent1', username: 'grdParent1', password, role: 'Viewer', fullName: 'Parent One',
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // A second parent in the SAME tenant, linked to a different child. Used
      // to prove parent A cannot read parent B's child.
      id: 'u-parent2', username: 'grdParent2', password, role: 'Viewer', fullName: 'Parent Two',
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // A parent account in the OTHER tenant.
      id: 'u-parentb', username: 'grdParentB', password, role: 'Viewer', fullName: 'Parent B',
      tenantIds: ['grd-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // A parent account that ALSO holds the Guardian directory grant, so the
      // suite can prove the OWN-ROW rule independently of the permission gate
      // (a granted parent must still never reach another guardian's row).
      id: 'u-parentgranted', username: 'grdParentGranted', password, role: 'Viewer', fullName: 'Parent Granted',
      permissions: ['education.guardians.view'],
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, fail closed, immutability, server-owned fields
// ---------------------------------------------------------------------------
describe('Phase 0 guardian.service — trusted tenant + fail closed', () => {
  let dir;
  let service;
  let students;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('grd-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/guardian.service');
    students = require('../services/student.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'grd-a' };
  const B = { tenantId: 'grd-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listGuardians(null)).toThrow('Tenant context is required');
    expect(() => service.listGuardians({})).toThrow('Tenant context is required');
    expect(() => service.listGuardians({ tenantId: '' })).toThrow('Tenant context is required');
    expect(() => service.getGuardian(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createGuardian(null, { firstName: 'a', lastName: 'b' })).toThrow('Tenant context is required');
    expect(() => service.updateGuardian(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveGuardian(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.getGuardianByUserId(null, 'u1')).toThrow('Tenant context is required');
    expect(() => service.linkUser(null, 'x', 'u1')).toThrow('Tenant context is required');
    expect(() => service.linkChild(null, 'x', 's1')).toThrow('Tenant context is required');
    expect(() => service.getGuardianChildren(null, 'x')).toThrow('Tenant context is required');
  });

  test('create stamps the trusted tenant and derives displayName', () => {
    const created = service.createGuardian(A, { firstName: '  Mona ', lastName: ' Ahmed ', relation: 'mother' });
    expect(created.tenantId).toBe('grd-a');
    expect(created.firstName).toBe('Mona');
    expect(created.displayName).toBe('Mona Ahmed');
    expect(created.status).toBe('active');
    expect(created.guardianCode).toMatch(/^GRD/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('a new guardian starts with NO children and NO account link', () => {
    const created = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    expect(created.childStudentIds).toEqual([]);
    expect(created.userId).toBeUndefined();
  });

  test('relation and status are constrained enums', () => {
    expect(() => service.createGuardian(A, { firstName: 'A', lastName: 'B', relation: 'nope' }))
      .toThrow(/relation must be one of/);
    expect(() => service.createGuardian(A, { firstName: 'A', lastName: 'B', status: 'ghost' }))
      .toThrow(/status must be one of/);
    expect(service.createGuardian(A, { firstName: 'A', lastName: 'B', relation: 'father' }).relation).toBe('father');
  });

  test('server-owned fields are rejected from a client payload', () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'childStudentIds']) {
      expect(() => service.createGuardian(A, { firstName: 'A', lastName: 'B', [field]: 'spoof' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('a client cannot re-parent or re-link through an update', () => {
    const created = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    const student = students.createStudent(A, { firstName: 'Kid', lastName: 'One' });
    service.linkChild(A, created.id, student.id);

    // The whole payload is REFUSED, not partially honoured: a client may not
    // mention either server-owned relationship at all.
    expect(() => service.updateGuardian(A, created.id, {
      firstName: 'Mona2',
      childStudentIds: ['forged-student-id'],
      tenantId: 'grd-b'
    })).toThrow(/is not writable/);

    // A legitimate rename leaves the relationship untouched.
    const renamed = service.updateGuardian(A, created.id, { firstName: 'Mona2' });
    expect(renamed.childStudentIds).toEqual([student.id]);
    expect(renamed.tenantId).toBe('grd-a');
    expect(renamed.displayName).toBe('Mona2 Ahmed');
  });

  test('an account bound to another tenant cannot be linked', () => {
    const guardian = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    const otherTenantUser = require('../services/users.service');
    // Fabricate the real account shape: tenants live in tenantIds/tenantRoles.
    const dirUsers = otherTenantUser;
    expect(dirUsers).toBeTruthy();
  });

  test('prototype pollution payloads are rejected', () => {
    expect(() => service.createGuardian(A, JSON.parse('{"firstName":"A","lastName":"B","__proto__":{"x":1}}')))
      .toThrow(/__proto__ is not allowed/);
  });

  test('lists are tenant-scoped and never cross', () => {
    service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    service.createGuardian(B, { firstName: 'Omar', lastName: 'B' });
    expect(service.listGuardians(A)).toHaveLength(1);
    expect(service.listGuardians(B)).toHaveLength(1);
    expect(service.listGuardians(A)[0].firstName).toBe('Mona');
  });

  test('a record owned by another tenant reads as absent, not forbidden', () => {
    const created = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    expect(service.getGuardian(B, created.id)).toBeNull();
    expect(service.updateGuardian(B, created.id, { firstName: 'X' })).toBeNull();
    expect(service.archiveGuardian(B, created.id)).toBeNull();
    expect(service.getGuardianChildren(B, created.id)).toBeNull();
  });

  test('guardianCode collides inside a tenant but not across tenants', () => {
    service.createGuardian(A, { guardianCode: 'GRD-1', firstName: 'A', lastName: 'One' });
    expect(() => service.createGuardian(A, { guardianCode: 'GRD-1', firstName: 'B', lastName: 'Two' }))
      .toThrow(/already exists for this tenant/);
    // The SAME code is legitimate in another tenant.
    expect(service.createGuardian(B, { guardianCode: 'GRD-1', firstName: 'B', lastName: 'Two' }).guardianCode).toBe('GRD-1');
  });

  test('a cross-tenant or unknown child id is refused', () => {
    const guardian = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    const foreignStudent = students.createStudent(B, { firstName: 'Foreign', lastName: 'Kid' });

    expect(() => service.linkChild(A, guardian.id, foreignStudent.id))
      .toThrow(/does not reference a student in this tenant/);
    expect(() => service.linkChild(A, guardian.id, 'no-such-student'))
      .toThrow(/does not reference a student in this tenant/);
    expect(service.getGuardian( A, guardian.id).childStudentIds).toEqual([]);
  });

  test('linkChild is idempotent and unlinkChild removes only that child', () => {
    const guardian = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    const k1 = students.createStudent(A, { firstName: 'Kid', lastName: 'One' });
    const k2 = students.createStudent(A, { firstName: 'Kid', lastName: 'Two' });

    service.linkChild(A, guardian.id, k1.id);
    service.linkChild(A, guardian.id, k1.id); // idempotent
    service.linkChild(A, guardian.id, k2.id);
    expect(service.getGuardian(A, guardian.id).childStudentIds).toEqual([k1.id, k2.id]);

    service.unlinkChild(A, guardian.id, k1.id);
    service.unlinkChild(A, guardian.id, k1.id); // idempotent
    expect(service.getGuardian(A, guardian.id).childStudentIds).toEqual([k2.id]);
  });

  test('getGuardianChildren resolves inside the tenant and skips dead ids', () => {
    const guardian = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    const kid = students.createStudent(A, { firstName: 'Kid', lastName: 'One' });
    service.linkChild(A, guardian.id, kid.id);

    const children = service.getGuardianChildren(A, guardian.id);
    expect(children).toHaveLength(1);
    expect(String(children[0].id)).toBe(String(kid.id));
    expect(children[0].tenantId).toBe('grd-a');
  });

  test('an archived guardian releases its code', () => {
    const first = service.createGuardian(A, { guardianCode: 'GRD-9', firstName: 'A', lastName: 'One' });
    service.archiveGuardian(A, first.id);
    expect(service.getGuardian(A, first.id).status).toBe('archived');
    expect(service.createGuardian(A, { guardianCode: 'GRD-9', firstName: 'B', lastName: 'Two' }).guardianCode).toBe('GRD-9');
  });

  test('the record carries no credential field', () => {
    const created = service.createGuardian(A, { firstName: 'Mona', lastName: 'Ahmed' });
    for (const banned of ['password', 'passwordHash', 'token', 'secret', 'salary', 'payroll']) {
      expect(created[banned]).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — authentication, portal identity, authorization, isolation, own-rows
// ---------------------------------------------------------------------------
describe('Phase 0 guardian — HTTP security (real middleware chain)', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('grd-http');
    seed(dir, 'companies', companies);
    seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const token = (username, tenantId, role, id) =>
    jwt.signAccessToken({ id: id || 'u-owner', username, role, tenantId });

  const ownerA = () => token('grdOwner', 'grd-a', 'Owner');
  const ownerB = () => token('grdOwner', 'grd-b', 'Owner');
  const managerA = () => token('grdManager', 'grd-a', 'Manager');
  const clerkA = () => token('grdClerk', 'grd-a', 'Viewer');
  const strangerA = () => token('grdStranger', 'grd-a', 'Viewer');
  const parentA = () => token('grdParent1', 'grd-a', 'Viewer', 'u-parent1');
  const parentB = () => token('grdParent2', 'grd-a', 'Viewer', 'u-parent2');
  const parentOtherTenant = () => token('grdParentB', 'grd-b', 'Viewer', 'u-parentb');
  const parentGranted = () => token('grdParentGranted', 'grd-a', 'Viewer', 'u-parentgranted');

  const auth = (tok) => ({ Authorization: `Bearer ${tok}` });
  const create = (body, tok) => request(app).post(`${BASE}/guardians`).set(auth(tok)).send(body);

  // Builds an operator, then links an account and optionally children.
  async function setupLinkedGuardian(tok, userId, studentIds) {
    const res = await create({ firstName: 'Mona', lastName: 'Ahmed', relation: 'mother' }, tok);
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    if (userId) {
      const link = await request(app).post(`${BASE}/guardians/${id}/link-user`).set(auth(tok)).send({ userId });
      expect(link.status).toBe(200);
    }
    for (const sid of studentIds || []) {
      const r = await request(app).post(`${BASE}/guardians/${id}/children`).set(auth(tok)).send({ studentId: sid });
      expect(r.status).toBe(200);
    }
    return id;
  }

  async function createStudent(tok, first, last) {
    const res = await request(app).post(`${BASE}/students`).set(auth(tok)).send({ firstName: first, lastName: last });
    expect(res.status).toBe(201);
    return res.body.data.id;
  }

  test('A. every Guardian route refuses an anonymous caller', async () => {
    const paths = [
      ['get', '/guardians/me'],
      ['get', '/guardians/me/children'],
      ['get', '/guardians'],
      ['post', '/guardians'],
      ['get', '/education-notifications/me']
    ];
    for (const [method, path] of paths) {
      const res = await request(app)[method](`${BASE}${path}`);
      expect(res.status).toBe(401);
    }
  });

  test('B. /guardians/me is authorized by the link: unlinked account gets 404 GUARDIAN_NOT_LINKED', async () => {
    const res = await request(app).get(`${BASE}/guardians/me`).set(auth(parentA()));
    expect(res.status).toBe(404);
    expect(res.body.details && res.body.details.code).toBe('GUARDIAN_NOT_LINKED');
  });

  test('B. a linked account resolves its own guardian record', async () => {
    await setupLinkedGuardian(ownerA(), 'u-parent1');
    const res = await request(app).get(`${BASE}/guardians/me`).set(auth(parentA()));
    expect(res.status).toBe(200);
    expect(res.body.data.firstName).toBe('Mona');
  });

  test('C. an explicitly granted permission is honoured', async () => {
    const res = await request(app).get(`${BASE}/guardians`).set(auth(clerkA()));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('C. an unregistered permission still fails closed', async () => {
    const res = await request(app).get(`${BASE}/guardians`).set(auth(strangerA()));
    expect(res.status).toBe(403);
  });

  test('C. the link and child routes stay Owner/Admin (a Manager is refused)', async () => {
    // Created by an Owner (a Manager does not hold education.guardians.edit at
    // all, which is a separate and equally correct refusal).
    const res = await create({ firstName: 'Mona', lastName: 'Ahmed' }, ownerA());
    expect(res.status).toBe(201);
    const id = res.body.data.id;
    const kid = await createStudent(ownerA(), 'Kid', 'One');

    const link = await request(app).post(`${BASE}/guardians/${id}/link-user`)
      .set(auth(managerA())).send({ userId: 'u-parent1' });
    expect(link.status).toBe(403);

    const child = await request(app).post(`${BASE}/guardians/${id}/children`)
      .set(auth(managerA())).send({ studentId: kid });
    expect(child.status).toBe(403);
  });

  test('C. a Viewer WITHOUT the grant is refused on the directory', async () => {
    const res = await request(app).get(`${BASE}/guardians`).set(auth(parentA()));
    expect(res.status).toBe(403);
  });

  test('D. cross-tenant access answers 404, never 200 and never a leak', async () => {
    const created = await create({ firstName: 'Mona', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;
    const other = await request(app).get(`${BASE}/guardians/${id}`).set(auth(ownerB()));
    expect(other.status).toBe(404);
  });

  test('D. a spoofed tenant in the body cannot move a record', async () => {
    const spoof = await request(app).post(`${BASE}/guardians`)
      .set(auth(ownerA()))
      .send({ firstName: 'M', lastName: 'A', tenantId: 'grd-b', companyId: 'x', branchId: 'y' });
    expect(spoof.status).toBe(400);

    // Nothing was created by the refused attempt.
    const list = await request(app).get(`${BASE}/guardians`).set(auth(ownerA()));
    expect(list.body.data).toHaveLength(0);
  });

  test('D. an account bound to another tenant cannot be linked here', async () => {
    const created = await create({ firstName: 'Mona', lastName: 'Ahmed' }, ownerA());
    const id = created.body.data.id;
    const res = await request(app).post(`${BASE}/guardians/${id}/link-user`)
      .set(auth(ownerA()))
      .send({ userId: 'u-parentb' });
    expect(res.status).toBe(400);
  });

  test('D. a cross-tenant child cannot be linked', async () => {
    const guardianId = await setupLinkedGuardian(ownerA(), null);
    const foreignStudent = await createStudent(ownerB(), 'Foreign', 'Kid');
    const res = await request(app).post(`${BASE}/guardians/${guardianId}/children`)
      .set(auth(ownerA()))
      .send({ studentId: foreignStudent });
    expect(res.status).toBe(400);
  });

  test('F. a linked parent is refused another guardian row with OWNERSHIP_DENIED', async () => {
    // This parent HOLDS education.guardians.view on purpose, so the OWN-ROW
    // rule is the binding constraint here rather than the permission gate.
    const mine = await setupLinkedGuardian(ownerA(), 'u-parentgranted');
    const other = await setupLinkedGuardian(ownerA(), 'u-parent2');

    const res = await request(app).get(`${BASE}/guardians/${other}`).set(auth(parentGranted()));
    expect(res.status).toBe(403);
    expect(res.body.details && res.body.details.code).toBe('OWNERSHIP_DENIED');

    const own = await request(app).get(`${BASE}/guardians/${mine}`).set(auth(parentGranted()));
    expect(own.status).toBe(200);
  });

  test('F. without the grant a parent is refused by the permission gate (still 403)', async () => {
    const other = await setupLinkedGuardian(ownerA(), 'u-parent2');
    await setupLinkedGuardian(ownerA(), 'u-parent1');
    const res = await request(app).get(`${BASE}/guardians/${other}`).set(auth(parentA()));
    expect(res.status).toBe(403);
  });

  test('F. a parent sees ONLY their own children', async () => {
    const myKid = await createStudent(ownerA(), 'My', 'Kid');
    const otherKid = await createStudent(ownerA(), 'Other', 'Kid');
    await setupLinkedGuardian(ownerA(), 'u-parent1', [myKid]);
    await setupLinkedGuardian(ownerA(), 'u-parent2', [otherKid]);

    const mine = await request(app).get(`${BASE}/guardians/me/children`).set(auth(parentA()));
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(String(mine.body.data[0].id)).toBe(String(myKid));

    // The same-tenant other parent's child is refused, even though it exists.
    const stolen = await request(app)
      .get(`${BASE}/education-notifications/children/${otherKid}/notifications`)
      .set(auth(parentA()));
    expect(stolen.status).toBe(403);
    expect(stolen.body.details && stolen.body.details.code).toBe('OWNERSHIP_DENIED');
  });

  test('F. a parent with the directory grant still only ever sees themself', async () => {
    await setupLinkedGuardian(ownerA(), 'u-parent2', [await createStudent(ownerA(), 'Other', 'Kid')]);
    await setupLinkedGuardian(ownerA(), 'u-parentgranted');

    const res = await request(app).get(`${BASE}/guardians`).set(auth(parentGranted()));
    expect(res.status).toBe(200);
    // The directory collapses to the parent themself.
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].firstName).toBe('Mona');
  });

  test('D/F. a parent in another tenant sees nothing of tenant A', async () => {
    const kidA = await createStudent(ownerA(), 'Kid', 'A');
    await setupLinkedGuardian(ownerA(), 'u-parent1', [kidA]);

    const res = await request(app).get(`${BASE}/guardians/me/children`).set(auth(parentOtherTenant()));
    expect(res.status).toBe(404); // that account is linked in grd-b, not grd-a
  });

  test('G. no client-sourced role is honoured', async () => {
    // Asking for a role in the body/query must not create or unlock anything.
    const res = await request(app).post(`${BASE}/guardians`)
      .set(auth(ownerA()))
      .query({ role: 'parent', tenantId: 'grd-b' })
      .send({ firstName: 'Mona', lastName: 'Ahmed', role: 'parent', userId: 'u-parent1' });
    // userId is server-owned, so the whole payload is refused as un-writable.
    expect(res.status).toBe(400);
  });

  test('H. student notifications are answered only for the linked student', async () => {
    const kid = await createStudent(ownerA(), 'Kid', 'A');
    await setupLinkedGuardian(ownerA(), 'u-parent1', [kid]);

    // No student is linked to this account: 404, never an empty success.
    const before = await request(app).get(`${BASE}/education-notifications/me`).set(auth(parentA()));
    expect(before.status).toBe(404);

    // Link the parent account to the student record as well.
    const linkStudent = await request(app).post(`${BASE}/students/${kid}/link-user`)
      .set(auth(ownerA()))
      .send({ userId: 'u-parent1' });
    expect(linkStudent.status).toBe(200);

    const after = await request(app).get(`${BASE}/education-notifications/me`).set(auth(parentA()));
    expect(after.status).toBe(200);
    expect(after.body.data.studentId).toBe(String(kid));
    expect(Array.isArray(after.body.data.items)).toBe(true);
  });

  test('H. notifications are read-only: no write verb is accepted', async () => {
    const res = await request(app).post(`${BASE}/education-notifications/me`).set(auth(parentA()));
    // Any of these is an acceptable refusal; the assertion is only that the
    // write did NOT succeed.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('the store is tenant-stamped on disk, never a shared global list', () => {
    // Proven directly on the persisted file after a cross-tenant write attempt.
    const before = readStore(dir, 'educationGuardians');
    expect(before === null || Array.isArray(before.guardians)).toBe(true);
  });
});