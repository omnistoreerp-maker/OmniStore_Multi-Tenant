'use strict';

// assignmentReadError.test.js — a corrupt or unreadable Education Assignments
// store must surface as READ_ERROR end to end (service -> HTTP API) and must
// NEVER degrade into an empty assignment list ("No assignments").
//
// WHAT IS PINNED HERE (all data isolated in temp dirs; nothing reads or
// writes backend/data):
//
//   service level (success contract = a bare array of rows; READ_ERROR is the
//   only object shape, which is how every consumer tells them apart)
//     missing store                -> natural empty state []
//     valid { assignments: [] }    -> natural empty state []
//     valid populated store        -> rows returned, get/create unchanged
//     malformed JSON               -> { error: 'READ_ERROR' } for every public
//                                     read AND write entry point
//     scalar JSON ("1")            -> READ_ERROR (valid JSON, invalid store)
//     JSON null                    -> READ_ERROR
//     invalid store shape          -> READ_ERROR ({ "assignments": "x" })
//     unreadable store (EISDIR)    -> READ_ERROR — detected by reading the
//                                     file BEFORE fileStore.read() can swallow
//                                     the failure and hand back {}
//     no silent loss               -> the corrupt file stays byte-identical
//                                     after every call, and no .corrupt/.tmp
//                                     artifact is produced
//
//   API level (real server.js mount order, real JWT, real storage)
//     valid populated / valid empty / missing store -> 200 + array (the
//         natural empty state the UI renders as "No assignments")
//     corrupt store -> 500 { details: { code: 'READ_ERROR' } } for list, get,
//         create, update, archive — for owners AND linked actors — never
//         200 + object, never 201, never a fall-through 403/404
//     corrupt assignments store -> submission load paths answer 500
//         READ_ERROR instead of 400/403/404
//     the store file stays byte-identical after the 500 responses
//
// No mocks anywhere: service tests use the real file-backed store, API tests
// boot the real app through helpers/testServer.

const fs = require('fs');
const path = require('path');
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
const STORE_FILE = 'educationAssignments.json';

const MALFORMED = '{ "assignments": [ { "id": "asg-a1", broken';
const SCALAR = '1';
const JSON_NULL = 'null';
const WRONG_SHAPE = '{ "assignments": "nope" }';

function storePath(dir) {
  return path.join(dir, STORE_FILE);
}

function writeStoreRaw(dir, content) {
  fs.writeFileSync(storePath(dir), content, 'utf-8');
}

function readStoreRaw(dir) {
  return fs.readFileSync(storePath(dir), 'utf-8');
}

// No .corrupt backups, no .tmp leftovers — the integrity check is read-only.
function expectNoArtifacts(dir) {
  const stray = fs.readdirSync(dir).filter((f) => f.includes('corrupt') || f.endsWith('.tmp'));
  expect(stray).toEqual([]);
}

const companies = [
  { id: 'rda-a', name: 'ReadError Tenant A', code: 'RDA', active: true },
  { id: 'rda-b', name: 'ReadError Tenant B', code: 'RDB', active: true }
];

const VIEW = ['education.classes.view'];
const EDIT = ['education.classes.view', 'education.classes.edit'];
const GRADING = ['education.grading.view', 'education.grading.edit'];

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'rdaOwner', password, role: 'Owner', fullName: 'Owner', tenantIds: ['rda-a', 'rda-b'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-t1', username: 'rdaTeacher1', password, role: 'Viewer', fullName: 'Teacher One', permissions: [...VIEW, ...EDIT, ...GRADING], tenantIds: ['rda-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-s1', username: 'rdaStudent1', password, role: 'Viewer', fullName: 'Student One', permissions: [], tenantIds: ['rda-a'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

function seedAll(dir, password) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(password) });
  seed(dir, 'educationTeachers', { teachers: [
    { id: 'tch-a1', tenantId: 'rda-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationClasses', { classes: [
    { id: 'cls-a1', tenantId: 'rda-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-a2', tenantId: 'rda-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationStudents', { students: [
    { id: 'stu-1', tenantId: 'rda-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-s1', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationEnrollments', { enrollments: [
    { id: 'enr-1', tenantId: 'rda-a', studentId: 'stu-1', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationAssignments', { assignments: [
    { id: 'asg-a1', tenantId: 'rda-a', classId: 'cls-a1', title: 'Homework A1', description: 'Answer the questions', dueDate: '2026-12-01', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-a2', tenantId: 'rda-a', classId: 'cls-a2', title: 'Homework A2', description: 'Show your work', dueDate: '2026-12-02', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
}

const A = { tenantId: 'rda-a' };

// ---------------------------------------------------------------------------
// Service level: every public entry point against every store state.
// ---------------------------------------------------------------------------
describe('assignment.service — corrupt store contract (READ_ERROR, never empty)', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('asg-readerr');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/assignment.service');
    seedAll(dir, 'unused');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  afterAll(() => {
    process.env.AUTH_REQUIRED = ORIGINAL_ENV.AUTH;
    process.env.DIGITRONICS_DATA_DIR = ORIGINAL_ENV.DATA;
  });

  // The service's success contract is a bare array of rows; READ_ERROR is the
  // only shape wrapped in an object — that difference is what the controller
  // and every consumer keys on.
  test('missing store is a natural empty state', () => {
    fs.rmSync(storePath(dir));
    expect(fs.existsSync(storePath(dir))).toBe(false);
    const res = service.listAssignments(A, {});
    expect(res).toEqual([]);
    expect(res.error).toBeUndefined();
    expect(service.getAssignment(A, 'asg-a1')).toBeNull();
  });

  test('valid empty store renders the natural empty state', () => {
    writeStoreRaw(dir, JSON.stringify({ assignments: [] }));
    const res = service.listAssignments(A, {});
    expect(res).toEqual([]);
    expect(res.error).toBeUndefined();
  });

  test('valid populated store is unchanged: list, get and create still work', () => {
    const res = service.listAssignments(A, {});
    expect(res.error).toBeUndefined();
    expect(res.map((a) => a.id)).toEqual(['asg-a1', 'asg-a2']);
    const found = service.getAssignment(A, 'asg-a1');
    expect(found.title).toBe('Homework A1');
    const created = service.createAssignment(A, { classId: 'cls-a1', title: 'New Work', dueDate: '2026-03-01' });
    expect(created.id).toMatch(/^asg-/);
    expect(service.listAssignments(A, {})).toHaveLength(3);
  });

  test('malformed JSON -> READ_ERROR on every public entry point, file untouched', () => {
    writeStoreRaw(dir, MALFORMED);

    const list = service.listAssignments(A, {});
    expect(list).toEqual({ error: 'READ_ERROR', assignments: [] });
    expect(service.getAssignment(A, 'asg-a1')).toEqual({ error: 'READ_ERROR' });
    expect(service.createAssignment(A, { classId: 'cls-a1', title: 'X', dueDate: '2026-03-01' }))
      .toEqual({ error: 'READ_ERROR' });
    expect(service.updateAssignment(A, 'asg-a1', { title: 'X' })).toEqual({ error: 'READ_ERROR' });
    expect(service.archiveAssignment(A, 'asg-a1')).toEqual({ error: 'READ_ERROR' });

    // The corrupt bytes are preserved exactly: no silent reset to {},
    // no rewrite, no .corrupt/.tmp artifact.
    expect(readStoreRaw(dir)).toBe(MALFORMED);
    expectNoArtifacts(dir);
  });

  test('scalar JSON "1" -> READ_ERROR, never coerced to an empty list', () => {
    writeStoreRaw(dir, SCALAR);
    expect(service.listAssignments(A, {})).toEqual({ error: 'READ_ERROR', assignments: [] });
    expect(service.getAssignment(A, 'asg-a1')).toEqual({ error: 'READ_ERROR' });
    expect(readStoreRaw(dir)).toBe(SCALAR);
    expectNoArtifacts(dir);
  });

  test('JSON null -> READ_ERROR', () => {
    writeStoreRaw(dir, JSON_NULL);
    expect(service.listAssignments(A, {})).toEqual({ error: 'READ_ERROR', assignments: [] });
    expect(readStoreRaw(dir)).toBe(JSON_NULL);
    expectNoArtifacts(dir);
  });

  test('invalid store shape (assignments not an array) -> READ_ERROR', () => {
    writeStoreRaw(dir, WRONG_SHAPE);
    expect(service.listAssignments(A, {})).toEqual({ error: 'READ_ERROR', assignments: [] });
    expect(service.getAssignment(A, 'asg-a1')).toEqual({ error: 'READ_ERROR' });
    expect(readStoreRaw(dir)).toBe(WRONG_SHAPE);
    expectNoArtifacts(dir);
  });

  test('unreadable store (a directory replaces the file) -> READ_ERROR instead of {}', () => {
    // fileStore.read() swallows this EISDIR and hands back {} — which is
    // exactly how a read failure used to become "No assignments". The
    // integrity check must detect it first.
    fs.rmSync(storePath(dir));
    fs.mkdirSync(storePath(dir));
    expect(service.listAssignments(A, {})).toEqual({ error: 'READ_ERROR', assignments: [] });
    expect(service.getAssignment(A, 'asg-a1')).toEqual({ error: 'READ_ERROR' });
    fs.rmdirSync(storePath(dir));
    expectNoArtifacts(dir);
  });

  test('a store without the assignments key stays backward compatible (empty)', () => {
    writeStoreRaw(dir, '{}');
    const res = service.listAssignments(A, {});
    expect(res).toEqual([]);
    expect(res.error).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// API level: real server, real JWT, real storage — the contract the frontend
// actually consumes.
// ---------------------------------------------------------------------------
describe('assignment API — READ_ERROR reaches the client as 500, never as 200 + []', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('asg-readerr-api');
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

  const ownerA = () => token('u-owner', 'rdaOwner', 'Owner', 'rda-a');
  const t1 = () => token('u-t1', 'rdaTeacher1', 'Viewer', 'rda-a');
  const s1 = () => token('u-s1', 'rdaStudent1', 'Viewer', 'rda-a');

  const get = (p, tok) =>
    request(app).get(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`);
  const post = (p, tok, body) =>
    request(app).post(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const patch = (p, tok, body) =>
    request(app).patch(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});

  const isReadError500 = (res) => {
    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
    expect(res.body.details && res.body.details.code).toBe('READ_ERROR');
    // The critical guarantee: no success payload the UI could coerce into [].
    expect(res.body.success).not.toBe(true);
    expect(Array.isArray(res.body.data)).toBe(false);
  };

  test('valid populated store: 200 + real rows', async () => {
    const list = await get('/assignments', ownerA());
    expect(list.statusCode).toBe(200);
    expect(Array.isArray(list.body.data)).toBe(true);
    expect(list.body.data.map((r) => r.id)).toEqual(['asg-a1', 'asg-a2']);
    const one = await get('/assignments/asg-a1', ownerA());
    expect(one.statusCode).toBe(200);
    expect(one.body.data.title).toBe('Homework A1');
  });

  test('valid empty store: 200 + [] (the natural empty state)', async () => {
    writeStoreRaw(dir, JSON.stringify({ assignments: [] }));
    const list = await get('/assignments', ownerA());
    expect(list.statusCode).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  test('missing store: 200 + [] (the natural empty state)', async () => {
    fs.rmSync(storePath(dir));
    const list = await get('/assignments', ownerA());
    expect(list.statusCode).toBe(200);
    expect(list.body.data).toEqual([]);
  });

  test('corrupt store: list/get/create/update/archive all answer 500 READ_ERROR', async () => {
    writeStoreRaw(dir, MALFORMED);

    isReadError500(await get('/assignments', ownerA()));
    isReadError500(await get('/assignments/asg-a1', ownerA()));
    // A write must never answer 201/200 for a store it could not read.
    isReadError500(await post('/assignments', ownerA(), { classId: 'cls-a1', title: 'New', dueDate: '2026-03-01' }));
    isReadError500(await put('/assignments/asg-a1', ownerA(), { title: 'Renamed' }));
    isReadError500(await patch('/assignments/asg-a1/archive', ownerA()));

    // The corrupt bytes survive the whole API round trip untouched.
    expect(readStoreRaw(dir)).toBe(MALFORMED);
    expectNoArtifacts(dir);
  });

  test('corrupt store: linked actors get READ_ERROR, never a fall-through 403/404', async () => {
    writeStoreRaw(dir, MALFORMED);
    // Teacher: previously rows.filter on the error object surfaced as a
    // generic 503-less 500 or a 403; it must now be an explicit READ_ERROR.
    isReadError500(await get('/assignments', t1()));
    isReadError500(await get('/assignments/asg-a1', t1()));
    // Student read path through the same list endpoint.
    isReadError500(await get('/assignments', s1()));
    // Submission load path must not 404/403 on a read failure either.
    isReadError500(await get('/assignments/asg-a1/submissions', ownerA()));
    expect(readStoreRaw(dir)).toBe(MALFORMED);
  });

  test('corrupt store: student submission write is a READ_ERROR, not a fake success', async () => {
    writeStoreRaw(dir, MALFORMED);
    const res = await put('/assignments/asg-a1/submission', s1(), { content: 'My answer' });
    isReadError500(res);
    expect(readStoreRaw(dir)).toBe(MALFORMED);
    expectNoArtifacts(dir);
  });

  test('scalar store: API surfaces READ_ERROR instead of 200 + []', async () => {
    writeStoreRaw(dir, SCALAR);
    isReadError500(await get('/assignments', ownerA()));
    expect(readStoreRaw(dir)).toBe(SCALAR);
  });
});
