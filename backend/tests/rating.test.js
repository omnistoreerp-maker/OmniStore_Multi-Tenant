'use strict';

// P2 Ratings — regression suite (Teacher portal, Device 2).
//
// Proves, against the REAL middleware chain and the REAL server.js mount:
//
//   A. Authentication — every rating route refuses an anonymous caller.
//   B. Authorization — strict gate does not degrade under AUTH_REQUIRED=false;
//      unregistered permissions fail closed; an UNLINKED permission-holding
//      Viewer is still refused writes by the global role gate.
//   C. Operator access — an unlinked Owner enters, corrects and withdraws
//      feedback; validation covers score 1-5, real dates, immutable refs and
//      the refusal of every money field (including the `rating` alias — the
//      canonical field is `score`).
//   D. Ownership — a linked teacher reads ONLY ratings about themselves
//      (force-scoped list, 403 on other rows) and can never create, edit or
//      archive ANY rating, even holding education.ratings.edit.
//   E. Tenant isolation — every read/write is scoped to the trusted tenant;
//      cross-tenant ids answer 404, cross-tenant references answer 400 with
//      no existence leak; archived parents are ALLOWED (feedback outlives the
//      records it mentions, unlike a booking).
//   F. Audit — rating mutations land in the tamper-evident audit log.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const DAY = '2026-06-15';

const companies = [
  { id: 'rt-a', name: 'Rating Tenant A', code: 'RTA', active: true },
  { id: 'rt-b', name: 'Rating Tenant B', code: 'RTB', active: true }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'rtOwner', password, role: 'Owner', fullName: 'Rating Owner',
      tenantIds: ['rt-a', 'rt-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-actor', username: 'rtActor', password, role: 'Viewer', fullName: 'Teacher Actor',
      permissions: ['education.ratings.view', 'education.ratings.edit'],
      tenantIds: ['rt-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-actor2', username: 'rtActor2', password, role: 'Viewer', fullName: 'Teacher Actor Two',
      permissions: ['education.ratings.view', 'education.ratings.edit'],
      tenantIds: ['rt-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-stranger', username: 'rtStranger', password, role: 'Viewer', fullName: 'Rating Stranger',
      permissions: ['education.ratings.export'],
      tenantIds: ['rt-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const teachers = [
  { id: 'tch-1', tenantId: 'rt-a', teacherCode: 'RT1', firstName: 'Ann', lastName: 'Teacher', displayName: 'Ann Teacher', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-2', tenantId: 'rt-a', teacherCode: 'RT2', firstName: 'Bob', lastName: 'Teacher', displayName: 'Bob Teacher', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-gone', tenantId: 'rt-a', teacherCode: 'RT3', firstName: 'Old', lastName: 'Teacher', displayName: 'Old Teacher', status: 'archived', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'tch-b1', tenantId: 'rt-b', teacherCode: 'RTB', firstName: 'Ben', lastName: 'Teacher', displayName: 'Ben Teacher', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

const students = [
  { id: 'stu-1', tenantId: 'rt-a', studentCode: 'RS1', firstName: 'Sara', lastName: 'Student', displayName: 'Sara Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-2', tenantId: 'rt-a', studentCode: 'RS2', firstName: 'Sam', lastName: 'Student', displayName: 'Sam Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-gone', tenantId: 'rt-a', studentCode: 'RS3', firstName: 'Old', lastName: 'Student', displayName: 'Old Student', status: 'archived', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'stu-b1', tenantId: 'rt-b', studentCode: 'RSB', firstName: 'Bea', lastName: 'Student', displayName: 'Bea Student', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

const classes = [
  { id: 'cls-1', tenantId: 'rt-a', courseId: 'crs-1', teacherId: 'tch-1', classCode: 'C1', name: 'Algebra', displayName: 'Algebra', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'cls-2', tenantId: 'rt-a', courseId: 'crs-1', teacherId: 'tch-2', classCode: 'C2', name: 'Geometry', displayName: 'Geometry', status: 'active', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
];

function seedAll(dir) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
  seed(dir, 'educationTeachers', { teachers });
  seed(dir, 'educationStudents', { students });
  seed(dir, 'educationClasses', { classes });
}

// ---------------------------------------------------------------------------
// 1. SERVICE — trusted tenant, refs, validation, correction, isolation
// ---------------------------------------------------------------------------
describe('P2 rating.service — trusted tenant, score contract and isolation', () => {
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('rat-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    seedAll(dir);
    service = require('../services/rating.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'rt-a' };
  const B = { tenantId: 'rt-b' };
  const base = { teacherId: 'tch-1', studentId: 'stu-1', score: '5', comment: 'Excellent' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listRatings(null)).toThrow('Tenant context is required');
    expect(() => service.listRatings({})).toThrow('Tenant context is required');
    expect(() => service.getRating(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createRating(null, base)).toThrow('Tenant context is required');
    expect(() => service.updateRating(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveRating(null, 'x')).toThrow('Tenant context is required');
  });

  test('create stamps the trusted tenant and starts active', () => {
    const created = service.createRating(A, { ...base, scheduledDate: DAY, classId: 'cls-1' });
    expect(created.tenantId).toBe('rt-a');
    expect(created.status).toBe('active');
    expect(created.score).toBe('5');
    expect(created.classId).toBe('cls-1');
    expect(created.scheduledDate).toBe(DAY);
    expect(created.id).toMatch(/^rat-/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('create requires teacher, student and a score', () => {
    try {
      service.createRating(A, { comment: 'hi' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(Array.isArray(err.validation)).toBe(true);
      expect(err.validation).toEqual(expect.arrayContaining([
        'teacherId is required', 'studentId is required', 'score is required'
      ]));
    }
  });

  test('unknown and cross-tenant parents are the same 400 — no existence leak', () => {
    const unknown = 'teacherId does not reference a Teacher in this tenant';
    expect(() => service.createRating(A, { ...base, teacherId: 'nope' })).toThrow(unknown);
    expect(() => service.createRating(B, { ...base, teacherId: 'tch-1', studentId: 'stu-b1' }))
      .toThrow(unknown);
    expect(() => service.createRating(A, { ...base, studentId: 'stu-b1' }))
      .toThrow('studentId does not reference a Student in this tenant');
  });

  test('archived parents are ALLOWED — feedback outlives the records it mentions', () => {
    const past = service.createRating(A, { ...base, teacherId: 'tch-gone', studentId: 'stu-gone' });
    expect(past.teacherId).toBe('tch-gone');
    expect(past.studentId).toBe('stu-gone');
    expect(service.getRating(A, past.id)).toBeTruthy();
  });

  test('classId must reference a Class taught by the rating teacher', () => {
    expect(() => service.createRating(A, { ...base, classId: 'cls-2' }))
      .toThrow('classId must reference a Class taught by teacherId');
    expect(() => service.createRating(A, { ...base, classId: 'nope' }))
      .toThrow('classId does not reference a Class in this tenant');
    expect(service.createRating(A, { ...base, classId: 'cls-1' }).classId).toBe('cls-1');
  });

  test('score is 1-5 as a string, never coerced', () => {
    for (const score of ['1', '2', '3', '4', '5']) {
      expect(service.createRating(A, { ...base, score }).score).toBe(score);
    }
    expect(() => service.createRating(A, { ...base, score: '6' }))
      .toThrow('score must be an integer from 1 to 5');
    expect(() => service.createRating(A, { ...base, score: '0' }))
      .toThrow('score must be an integer from 1 to 5');
    expect(() => service.createRating(A, { ...base, score: '4.5' }))
      .toThrow('score must be an integer from 1 to 5');
    expect(() => service.createRating(A, { ...base, score: 'good' }))
      .toThrow('score must be an integer from 1 to 5');
    expect(() => service.createRating(A, { ...base, score: 5 }))
      .toThrow('score must be a string');
  });

  test('scheduledDate is optional and strictly validated when present', () => {
    expect(service.createRating(A, { ...base, scheduledDate: DAY }).scheduledDate).toBe(DAY);
    expect(service.createRating(A, { ...base, scheduledDate: '' }).scheduledDate).toBe('');
    expect(() => service.createRating(A, { ...base, scheduledDate: '2026-02-30' }))
      .toThrow('real calendar date');
    expect(() => service.createRating(A, { ...base, scheduledDate: '15/06/2026' }))
      .toThrow('YYYY-MM-DD');
  });

  test('references are immutable; score, comment and date are correctable', () => {
    const r = service.createRating(A, { ...base, classId: 'cls-1', scheduledDate: DAY });
    for (const key of ['teacherId', 'studentId', 'classId']) {
      expect(() => service.updateRating(A, r.id, { [key]: 'x' }))
        .toThrow(key + ' cannot be changed');
    }

    const corrected = service.updateRating(A, r.id, { score: '3', comment: 'Needs work', scheduledDate: '' });
    expect(corrected.score).toBe('3');
    expect(corrected.comment).toBe('Needs work');
    expect(corrected.scheduledDate).toBe('');
    expect(corrected.teacherId).toBe('tch-1');
    expect(corrected.classId).toBe('cls-1');
    expect(corrected.createdAt).toBe(r.createdAt);

    // Score can never be cleared; comment can.
    const noScoreClear = service.updateRating(A, r.id, { score: '' });
    expect(noScoreClear.score).toBe('3');
    const noComment = service.updateRating(A, r.id, { comment: '' });
    expect(noComment.comment).toBe('');
  });

  test('status is server-owned and every money field is refused', () => {
    const r = service.createRating(A, base);

    expect(() => service.createRating(A, { ...base, status: 'archived' }))
      .toThrow('status is not writable');
    expect(() => service.updateRating(A, r.id, { status: 'active' }))
      .toThrow('status is not writable');

    for (const field of ['payment', 'amount', 'price', 'fee', 'invoice', 'refund', 'salary', 'payroll', 'rating']) {
      expect(() => service.createRating(A, { ...base, [field]: 'x' }))
        .toThrow(field + ' is not writable');
    }
    for (const field of ['id', 'tenantId', 'userId', 'createdBy']) {
      expect(() => service.createRating(A, { ...base, [field]: 'x' }))
        .toThrow(field + ' is not writable');
    }
    // Nothing financial is writable or persisted.
    for (const member of Object.keys(service.WRITABLE_FIELDS)) {
      expect(member).not.toMatch(/price|amount|fee|pay|invoice|billing|currency|salary/i);
    }
    const stored = service.getRating(A, r.id);
    for (const key of ['amount', 'price', 'fee', 'payment', 'invoice', 'salary']) {
      expect(Object.prototype.hasOwnProperty.call(stored, key)).toBe(false);
    }
  });

  test('archive withdraws without destroying, and only in the own tenant', () => {
    const r = service.createRating(A, base);
    const archived = service.archiveRating(A, r.id);
    expect(archived.status).toBe('archived');
    expect(archived.score).toBe('5'); // the feedback itself survives
    expect(service.getRating(A, r.id).status).toBe('archived');

    // Cross-tenant: same answer as missing, never a 403-shaped leak.
    expect(service.archiveRating(B, r.id)).toBeNull();
    expect(service.updateRating(B, r.id, { score: '1' })).toBeNull();
    expect(service.getRating(B, r.id)).toBeNull();
    expect(service.listRatings(B)).toEqual([]);
  });

  test('list filters, status default and newest-day-first ordering', () => {
    const older = service.createRating(A, { ...base, scheduledDate: '2026-06-01', comment: 'older' });
    const newer = service.createRating(A, { ...base, studentId: 'stu-2', score: '3', scheduledDate: DAY, comment: 'newer' });
    const other = service.createRating(A, { ...base, teacherId: 'tch-2', scheduledDate: '2026-06-10' });

    const all = service.listRatings(A);
    expect(all.map(r => r.id)).toEqual([newer.id, other.id, older.id]);

    expect(service.listRatings(A, { teacherId: 'tch-2' }).map(r => r.id)).toEqual([other.id]);
    expect(service.listRatings(A, { studentId: 'stu-2' }).map(r => r.id)).toEqual([newer.id]);
    expect(service.listRatings(A, { score: '5' }).map(r => r.id)).toEqual([other.id, older.id]);
    expect(service.listRatings(A, { score: '4' })).toEqual([]);
    expect(service.listRatings(A, { status: 'archived' })).toEqual([]);
    service.archiveRating(A, other.id);
    expect(service.listRatings(A, { status: 'archived' }).map(r => r.id)).toEqual([other.id]);
    expect(service.listRatings(A, { status: 'active' }).map(r => r.id)).toEqual([newer.id, older.id]);
    expect(service.listRatings(A, { scheduledDate: DAY }).map(r => r.id)).toEqual([newer.id]);
    expect(service.listRatings(A, { dateFrom: '2026-06-05' }).map(r => r.id)).toEqual([newer.id, other.id]);
    expect(service.listRatings(A, { dateTo: '2026-06-05' }).map(r => r.id)).toEqual([older.id]);
  });

  test('the export surface carries no payment member', () => {
    expect(service.WRITABLE_FIELDS).toEqual({
      teacherId: 'string', studentId: 'string', classId: 'string',
      scheduledDate: 'string', score: 'string', comment: 'string'
    });
    expect(service.RATING_STATUSES).toEqual(['active', 'archived']);
    expect(service.FORBIDDEN_FIELDS).toContain('status');
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP — authn, authz, operator CRUD, ownership, isolation, audit
// ---------------------------------------------------------------------------
describe('P2 rating routes — authorization, ownership and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('rat-http');
    seedAll(dir);
    process.env.ENABLE_TENANT_CARRY = 'true';
    app = startServer(dir, { AUTH_REQUIRED: 'true' }).app;
    jwt = require('../utils/jwt');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const token = (id, username, role, tenantId) =>
    jwt.signAccessToken({ id, username, role, tenantId });

  const ownerA = () => token('u-owner', 'rtOwner', 'Owner', 'rt-a');
  const ownerB = () => token('u-owner', 'rtOwner', 'Owner', 'rt-b');
  const actorA = () => token('u-actor', 'rtActor', 'Viewer', 'rt-a');
  const actor2A = () => token('u-actor2', 'rtActor2', 'Viewer', 'rt-a');
  const strangerA = () => token('u-stranger', 'rtStranger', 'Viewer', 'rt-a');

  const post = (path, tok, body) =>
    request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const put = (path, tok, body) =>
    request(app).put(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const patch = (path, tok, body) =>
    request(app).patch(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`).send(body);
  const get = (path, tok) =>
    request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);

  const operatorRating = (teacherId = 'tch-1', studentId = 'stu-1', extra = {}) =>
    post('/ratings', ownerA(), { teacherId, studentId, score: '5', comment: 'Great', scheduledDate: DAY, ...extra });

  const link = (teacherId, userId) =>
    post(`/teachers/${teacherId}/link-user`, ownerA(), { userId });

  test('A. unauthenticated access is refused on every rating route', async () => {
    expect((await request(app).get(`${BASE}/ratings`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/ratings/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/ratings`).send({})).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/ratings/anything`).send({})).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/ratings/anything/archive`)).statusCode).toBe(401);
  });

  test('B. the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('rat-lenient');
    seedAll(lenientDir);
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/ratings`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/ratings`).send({})).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('B. an unregistered rating permission fails closed, and unlinked writes stay role-gated', async () => {
    const read = await get('/ratings', strangerA());
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const write = await post('/ratings', strangerA(), { teacherId: 'tch-1', studentId: 'stu-1', score: '5' });
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);

    // An unlinked Viewer holding the REGISTERED edit grant is still refused
    // writes by the global role gate (the identity exception needs a link).
    const unlinked = await post('/ratings', actorA(), { teacherId: 'tch-1', studentId: 'stu-1', score: '5' });
    expect(unlinked.statusCode).toBe(403);
    expect(unlinked.body.message).toBe('Insufficient role');
    expect(readStore(dir, 'educationRatings')).toBeNull();

    // ...but its registered view grant is honoured for reads.
    expect((await get('/ratings', actorA())).statusCode).toBe(200);
  });

  test('C. an operator enters, corrects and withdraws feedback, with audit entries', async () => {
    const created = await operatorRating();
    expect(created.statusCode).toBe(201);
    const id = created.body.data.id;
    expect(created.body.data.score).toBe('5');
    expect(created.body.data.status).toBe('active');

    expect((await get('/ratings', ownerA())).body.data).toHaveLength(1);
    expect((await get(`/ratings/${id}`, ownerA())).body.data.comment).toBe('Great');

    const corrected = await put(`/ratings/${id}`, ownerA(), { score: '3', comment: 'Late twice' });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.body.data.score).toBe('3');
    expect(corrected.body.data.comment).toBe('Late twice');

    const archived = await patch(`/ratings/${id}/archive`, ownerA());
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
    expect(archived.body.data.score).toBe('3'); // withdrawn, not destroyed

    await new Promise(resolve => setTimeout(resolve, 50));
    const entries = (readStore(dir, 'auditLog') || { entries: [] }).entries;
    const ratingEntries = entries.filter(e => String(e.path || '').includes('/education/ratings'));
    expect(ratingEntries.length).toBeGreaterThanOrEqual(3);
    const createEntry = ratingEntries.find(e => e.method === 'POST' && e.statusCode === 201);
    expect(createEntry.userId).toBe('u-owner');
    expect(ratingEntries.some(e => String(e.path || '').endsWith('/archive') && e.statusCode === 200)).toBe(true);
  });

  test('C. validation and the money refusal answer 400 with details', async () => {
    const badScore = await operatorRating('tch-1', 'stu-1', { score: '9' });
    expect(badScore.statusCode).toBe(400);
    expect(badScore.body.details.details).toEqual(expect.arrayContaining([
      'score must be an integer from 1 to 5'
    ]));

    const missing = await post('/ratings', ownerA(), { comment: 'no refs' });
    expect(missing.statusCode).toBe(400);
    expect(missing.body.details.details).toEqual(expect.arrayContaining([
      'teacherId is required', 'studentId is required', 'score is required'
    ]));

    const money = await operatorRating('tch-1', 'stu-1', { amount: 100 });
    expect(money.statusCode).toBe(400);
    expect(money.body.details.details).toEqual(expect.arrayContaining(['amount is not writable']));

    const spoof = await operatorRating('tch-1', 'stu-1', { status: 'archived' });
    expect(spoof.statusCode).toBe(400);
    expect(spoof.body.details.details).toEqual(expect.arrayContaining(['status is not writable']));

    expect(readStore(dir, 'educationRatings')).toBeNull();
  });

  test('D. a linked teacher reads ONLY ratings about themselves', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    expect((await link('tch-2', 'u-actor2')).statusCode).toBe(200);

    const mine = await operatorRating('tch-1');
    const theirs = await operatorRating('tch-2', 'stu-2');
    const mineId = mine.body.data.id;
    const theirsId = theirs.body.data.id;

    // Force-scoped list: the other teacher's row never appears, even asked for.
    const list = await get('/ratings?teacherId=tch-2', actorA());
    expect(list.statusCode).toBe(200);
    expect(list.body.data.map(r => r.id)).toEqual([mineId]);
    expect((await get('/ratings', actorA())).body.data.map(r => r.id)).toEqual([mineId]);

    expect((await get(`/ratings/${mineId}`, actorA())).statusCode).toBe(200);
    const otherRead = await get(`/ratings/${theirsId}`, actorA());
    expect(otherRead.statusCode).toBe(403);
    expect(otherRead.body.details.code).toBe('OWNERSHIP_DENIED');
  });

  test('D. a linked teacher can never write a rating, even with the edit grant', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    const mine = await operatorRating('tch-1');
    const mineId = mine.body.data.id;

    const create = await post('/ratings', actorA(), { teacherId: 'tch-1', studentId: 'stu-2', score: '5' });
    expect(create.statusCode).toBe(403);
    expect(create.body.details.code).toBe('OWNERSHIP_DENIED');

    const edit = await put(`/ratings/${mineId}`, actorA(), { score: '1' });
    expect(edit.statusCode).toBe(403);
    expect(edit.body.details.code).toBe('OWNERSHIP_DENIED');

    const withdraw = await patch(`/ratings/${mineId}/archive`, actorA());
    expect(withdraw.statusCode).toBe(403);
    expect(withdraw.body.details.code).toBe('OWNERSHIP_DENIED');

    // Nothing changed: same score, still active.
    const stored = readStore(dir, 'educationRatings');
    expect(stored.ratings.find(r => r.id === mineId).score).toBe('5');
    expect(stored.ratings.find(r => r.id === mineId).status).toBe('active');
  });

  test('E. tenant isolation: 404 across tenants and 400 for foreign references', async () => {
    const mine = await operatorRating('tch-1');
    const id = mine.body.data.id;

    expect((await get('/ratings', ownerB())).body.data).toEqual([]);
    expect((await get(`/ratings/${id}`, ownerB())).statusCode).toBe(404);
    expect((await put(`/ratings/${id}`, ownerB(), { score: '1' })).statusCode).toBe(404);
    expect((await patch(`/ratings/${id}/archive`, ownerB())).statusCode).toBe(404);

    const ref = await post('/ratings', ownerB(), {
      teacherId: 'tch-1', studentId: 'stu-b1', score: '5'
    });
    expect(ref.statusCode).toBe(400);
    expect(ref.body.details.details).toEqual([
      'teacherId does not reference a Teacher in this tenant'
    ]);

    const own = await post('/ratings', ownerB(), {
      teacherId: 'tch-b1', studentId: 'stu-b1', score: '4'
    });
    expect(own.statusCode).toBe(201);
    expect(own.body.data.tenantId).toBe('rt-b');
    expect((await get('/ratings', ownerA())).body.data.map(r => r.id)).toEqual([id]);
  });

  test('E. the linked-teacher identity itself is tenant-scoped', async () => {
    expect((await link('tch-1', 'u-actor')).statusCode).toBe(200);
    const meB = await get('/teachers/me', token('u-actor', 'rtActor', 'Viewer', 'rt-b'));
    expect(meB.statusCode).toBe(404);
    expect(meB.body.details.code).toBe('TEACHER_NOT_LINKED');
  });
});
