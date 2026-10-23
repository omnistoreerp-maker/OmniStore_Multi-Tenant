'use strict';

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
  { id: 'sub-a', name: 'Submission Tenant A', code: 'SUA', active: true },
  { id: 'sub-b', name: 'Submission Tenant B', code: 'SUB', active: true }
];

const CLASS_EDIT = ['education.classes.view', 'education.classes.edit'];
const GRADING_EDIT = ['education.grading.view', 'education.grading.edit'];
const TEACHER_PERMISSIONS = [...CLASS_EDIT, ...GRADING_EDIT];

function userRecords(password) {
  return [
    { id: 'u-owner', username: 'subOwner', password, role: 'Owner', fullName: 'Owner', tenantIds: ['sub-a', 'sub-b'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-t1', username: 'subTeacher1', password, role: 'Viewer', fullName: 'Teacher One', permissions: TEACHER_PERMISSIONS.slice(), tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-t2', username: 'subTeacher2', password, role: 'Viewer', fullName: 'Teacher Two', permissions: TEACHER_PERMISSIONS.slice(), tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-ca1', username: 'subCenter1', password, role: 'Manager', fullName: 'Center One', permissions: TEACHER_PERMISSIONS.slice(), tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-s1', username: 'subStudent1', password, role: 'Viewer', fullName: 'Student One', permissions: [], tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-s2', username: 'subStudent2', password, role: 'Viewer', fullName: 'Student Two', permissions: [], tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-sg', username: 'subStudentGrants', password, role: 'Viewer', fullName: 'Student Grants', permissions: TEACHER_PERMISSIONS.slice(), tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-unlinked', username: 'subUnlinked', password, role: 'Viewer', fullName: 'Unlinked', permissions: [], tenantIds: ['sub-a'], createdAt: STAMP, updatedAt: STAMP },
    { id: 'u-ob', username: 'subOwnerB', password, role: 'Owner', fullName: 'Owner B', tenantIds: ['sub-b'], createdAt: STAMP, updatedAt: STAMP }
  ];
}

function seedAll(dir, password) {
  seed(dir, 'companies', companies);
  seed(dir, 'users', { users: userRecords(password) });
  seed(dir, 'educationCenters', { centers: [
    { id: 'cen-a1', tenantId: 'sub-a', centerCode: 'CA1', name: 'Center A1', status: 'active', userId: 'u-ca1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cen-a2', tenantId: 'sub-a', centerCode: 'CA2', name: 'Center A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cen-b', tenantId: 'sub-b', centerCode: 'CB', name: 'Center B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationPrograms', { programs: [
    { id: 'prg-a1', tenantId: 'sub-a', centerId: 'cen-a1', name: 'Track A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'prg-a2', tenantId: 'sub-a', centerId: 'cen-a2', name: 'Track A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'prg-b', tenantId: 'sub-b', centerId: 'cen-b', name: 'Track B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationCourses', { courses: [
    { id: 'crs-a1', tenantId: 'sub-a', programId: 'prg-a1', name: 'Course A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'crs-a2', tenantId: 'sub-a', programId: 'prg-a2', name: 'Course A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'crs-b', tenantId: 'sub-b', programId: 'prg-b', name: 'Course B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationTeachers', { teachers: [
    { id: 'tch-a1', tenantId: 'sub-a', teacherCode: 'TA1', firstName: 'Ann', lastName: 'One', status: 'active', userId: 'u-t1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'tch-a2', tenantId: 'sub-a', teacherCode: 'TA2', firstName: 'Bob', lastName: 'Two', status: 'active', userId: 'u-t2', createdAt: STAMP, updatedAt: STAMP },
    { id: 'tch-b', tenantId: 'sub-b', teacherCode: 'TB', firstName: 'Ben', lastName: 'Bee', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationClasses', { classes: [
    { id: 'cls-a1', tenantId: 'sub-a', courseId: 'crs-a1', teacherId: 'tch-a1', classCode: 'CA1', name: 'Algebra A1', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-a2', tenantId: 'sub-a', courseId: 'crs-a2', teacherId: 'tch-a2', classCode: 'CA2', name: 'Geometry A2', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'cls-b', tenantId: 'sub-b', courseId: 'crs-b', teacherId: 'tch-b', classCode: 'CB', name: 'Algebra B', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationStudents', { students: [
    { id: 'stu-1', tenantId: 'sub-a', studentCode: 'S1', firstName: 'Sara', lastName: 'One', status: 'active', userId: 'u-s1', createdAt: STAMP, updatedAt: STAMP },
    { id: 'stu-2', tenantId: 'sub-a', studentCode: 'S2', firstName: 'Sam', lastName: 'Two', status: 'active', userId: 'u-s2', createdAt: STAMP, updatedAt: STAMP },
    { id: 'stu-g', tenantId: 'sub-a', studentCode: 'SG', firstName: 'Syd', lastName: 'Gee', status: 'active', userId: 'u-sg', createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationEnrollments', { enrollments: [
    { id: 'enr-1', tenantId: 'sub-a', studentId: 'stu-1', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP },
    { id: 'enr-2', tenantId: 'sub-a', studentId: 'stu-2', classId: 'cls-a2', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP },
    { id: 'enr-g', tenantId: 'sub-a', studentId: 'stu-g', classId: 'cls-a1', status: 'active', enrolledAt: STAMP, withdrawnAt: null, createdAt: STAMP, updatedAt: STAMP }
  ] });
  seed(dir, 'educationAssignments', { assignments: [
    { id: 'asg-a1', tenantId: 'sub-a', classId: 'cls-a1', title: 'Homework A1', description: 'Answer the questions', dueDate: '2026-12-01', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-a2', tenantId: 'sub-a', classId: 'cls-a2', title: 'Homework A2', description: 'Show your work', dueDate: '2026-12-02', status: 'active', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-arch', tenantId: 'sub-a', classId: 'cls-a1', title: 'Archived A1', description: 'Old', dueDate: '2026-01-01', status: 'archived', createdAt: STAMP, updatedAt: STAMP },
    { id: 'asg-b', tenantId: 'sub-b', classId: 'cls-b', title: 'Homework B', description: 'Foreign', dueDate: '2026-12-03', status: 'active', createdAt: STAMP, updatedAt: STAMP }
  ] });
}

describe('assignmentSubmission.service — tenant scope, enrollment, review lock', () => {
  const A = { tenantId: 'sub-a' };
  const B = { tenantId: 'sub-b' };
  let dir;
  let service;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('sub-svc');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/assignmentSubmission.service');
    seedAll(dir, 'unused');
  });

  afterEach(() => {
    try { require('fs').rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listSubmissions(null, {})).toThrow('Tenant context is required');
    expect(() => service.getSubmission(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.getStudentSubmission(null, 'a', 's')).toThrow('Tenant context is required');
    expect(() => service.saveStudentSubmission(null, 'a', 's', { content: 'x' })).toThrow('Tenant context is required');
    expect(() => service.reviewSubmission(null, 'x', { grade: 'A' })).toThrow('Tenant context is required');
  });

  test('a student can save and update only their own submission for an active assignment', () => {
    const created = service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: '  First answer  ' });
    expect(created.tenantId).toBe('sub-a');
    expect(created.assignmentId).toBe('asg-a1');
    expect(created.studentId).toBe('stu-1');
    expect(created.content).toBe('First answer');
    expect(created.status).toBe('submitted');
    expect(created.grade).toBe('');
    expect(created.reviewedAt).toBe('');
    const updated = service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'Second answer' });
    expect(updated.id).toBe(created.id);
    expect(updated.content).toBe('Second answer');
    expect(updated.submittedAt).toBe(created.submittedAt);
    expect(service.listSubmissions(A, { assignmentId: 'asg-a1' })).toHaveLength(1);
  });

  test('saving requires an active assignment and an active enrollment', () => {
    expect(() => service.saveStudentSubmission(A, 'asg-arch', 'stu-1', { content: 'x' }))
      .toThrow('assignmentId must reference an active Assignment');
    expect(() => service.saveStudentSubmission(A, 'asg-a2', 'stu-1', { content: 'x' }))
      .toThrow("student is not actively enrolled in this assignment's class");
    expect(() => service.saveStudentSubmission(A, 'asg-a1', 'stu-2', { content: 'x' }))
      .toThrow("student is not actively enrolled in this assignment's class");
    expect(() => service.saveStudentSubmission(B, 'asg-a1', 'stu-1', { content: 'x' }))
      .toThrow('assignmentId does not reference an Assignment in this tenant');
    expect(() => service.saveStudentSubmission(A, 'asg-b', 'stu-1', { content: 'x' }))
      .toThrow('assignmentId does not reference an Assignment in this tenant');
  });

  test('server-owned and review fields are never writable by the student', () => {
    for (const field of ['id', 'tenantId', 'assignmentId', 'studentId', 'status', 'grade', 'feedback']) {
      expect(() => service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'x', [field]: 'y' }))
        .toThrow(field + ' is not writable');
    }
    expect(() => service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: '' }))
      .toThrow('content is required');
  });

  test('review records a grade and feedback, and locks the student content', () => {
    const created = service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'Answer' });
    const reviewed = service.reviewSubmission(A, created.id, { grade: 'Excellent', feedback: 'Well done' });
    expect(reviewed.status).toBe('reviewed');
    expect(reviewed.grade).toBe('Excellent');
    expect(reviewed.feedback).toBe('Well done');
    expect(reviewed.reviewedAt).not.toBe('');
    expect(() => service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'Changed' }))
      .toThrow('this submission has already been reviewed');
    const reReviewed = service.reviewSubmission(A, created.id, { grade: 'Good', feedback: '' });
    expect(reReviewed.status).toBe('reviewed');
    expect(reReviewed.grade).toBe('Good');
    expect(reReviewed.feedback).toBe('');
  });

  test('review requires a bounded grade and forbids student/relationship fields', () => {
    const created = service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'Answer' });
    expect(() => service.reviewSubmission(A, created.id, {})).toThrow('grade is required');
    expect(() => service.reviewSubmission(A, created.id, { grade: 'x'.repeat(161) }))
      .toThrow('grade must be at most 160 characters');
    expect(() => service.reviewSubmission(A, created.id, { grade: 'A', feedback: 'x'.repeat(2001) }))
      .toThrow('feedback must be at most 2000 characters');
    for (const field of ['content', 'assignmentId', 'studentId', 'status', 'submittedAt', 'reviewedAt']) {
      expect(() => service.reviewSubmission(A, created.id, { grade: 'A', [field]: 'y' }))
        .toThrow(field + ' is not writable');
    }
  });

  test('cross-tenant reads and reviews are absent, never leaked', () => {
    const created = service.saveStudentSubmission(A, 'asg-a1', 'stu-1', { content: 'Answer' });
    expect(service.listSubmissions(B, { assignmentId: 'asg-a1' })).toEqual([]);
    expect(service.getSubmission(B, created.id)).toBeNull();
    expect(service.getStudentSubmission(B, 'asg-a1', 'stu-1')).toBeNull();
    expect(service.reviewSubmission(B, created.id, { grade: 'A' })).toBeNull();
  });
});

describe('assignmentSubmission routes — real server and ownership matrix', () => {
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('sub-rt');
    seedAll(dir, bcrypt.hashSync('Pass#123', 10));
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

  const ownerA = () => token('u-owner', 'subOwner', 'Owner', 'sub-a');
  const ownerB = () => token('u-ob', 'subOwnerB', 'Owner', 'sub-b');
  const t1 = () => token('u-t1', 'subTeacher1', 'Viewer', 'sub-a');
  const t2 = () => token('u-t2', 'subTeacher2', 'Viewer', 'sub-a');
  const ca1 = () => token('u-ca1', 'subCenter1', 'Manager', 'sub-a');
  const s1 = () => token('u-s1', 'subStudent1', 'Viewer', 'sub-a');
  const s2 = () => token('u-s2', 'subStudent2', 'Viewer', 'sub-a');
  const sg = () => token('u-sg', 'subStudentGrants', 'Viewer', 'sub-a');
  const unlinked = () => token('u-unlinked', 'subUnlinked', 'Viewer', 'sub-a');

  const get = (p, tok) => {
    const req = request(app).get(`${BASE}${p}`);
    return tok ? req.set('Authorization', `Bearer ${tok}`) : req;
  };
  const put = (p, tok, body) =>
    request(app).put(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const patch = (p, tok, body) =>
    request(app).patch(`${BASE}${p}`).set('Authorization', `Bearer ${tok}`).send(body || {});
  const ids = (res) => (res.body.data || []).map((row) => row.id).sort();
  const denied403 = (res) => {
    expect(res.statusCode).toBe(403);
    expect(res.body.details.code).toBe('OWNERSHIP_DENIED');
  };

  test('anonymous is 401 and an unlinked grant-less account is 403', async () => {
    expect((await get('/assignments/asg-a1/submissions', null)).statusCode).toBe(401);
    expect((await put('/assignments/asg-a1/submission', null, { content: 'x' })).statusCode).toBe(401);
    expect((await patch('/assignments/asg-a1/submissions/any/review', null, { grade: 'A' })).statusCode).toBe(401);
    expect((await get('/assignments/asg-a1/submissions', unlinked())).statusCode).toBe(403);
    expect((await put('/assignments/asg-a1/submission', unlinked(), { content: 'x' })).statusCode).toBe(403);
  });

  test('a linked student saves and reads only their own submission', async () => {
    const saved = await put('/assignments/asg-a1/submission', s1(), { content: 'My answer' });
    expect(saved.statusCode).toBe(200);
    expect(saved.body.data.studentId).toBe('stu-1');
    expect(saved.body.data.assignmentId).toBe('asg-a1');
    const mine = await get('/assignments/asg-a1/submissions', s1());
    expect(mine.statusCode).toBe(200);
    expect(ids(mine)).toEqual([saved.body.data.id]);
    expect((await get('/assignments/asg-a1/submissions', s2())).statusCode).toBe(403);
    expect((await put('/assignments/asg-a1/submission', s2(), { content: 'Hijack' })).statusCode).toBe(403);
    expect((await put('/assignments/asg-a2/submission', s1(), { content: 'Hijack' })).statusCode).toBe(403);
    const foreign = await put('/assignments/asg-b/submission', s1(), { content: 'Hijack' });
    expect(foreign.statusCode).toBe(404);
    expect((await put('/assignments/asg-arch/submission', s1(), { content: 'Old' })).statusCode).toBe(400);
  });

  test('students with grants still cannot write assignments or review submissions', async () => {
    expect((await put('/assignments/asg-a1', sg(), { title: 'Hijack' })).statusCode).toBe(403);
    const saved = await put('/assignments/asg-a1/submission', sg(), { content: 'Mine' });
    expect(saved.statusCode).toBe(200);
    const review = await patch(`/assignments/asg-a1/submissions/${saved.body.data.id}/review`, sg(), { grade: 'A' });
    expect(review.statusCode).toBe(403);
    const mine = await get('/assignments/asg-a1/submissions', sg());
    expect(mine.statusCode).toBe(200);
    expect(ids(mine)).toEqual([saved.body.data.id]);
  });

  test('a teacher reads and reviews only submissions for their own class', async () => {
    const s1Saved = await put('/assignments/asg-a1/submission', s1(), { content: 'S1 answer' });
    const sgSaved = await put('/assignments/asg-a1/submission', sg(), { content: 'SG answer' });
    expect(s1Saved.statusCode).toBe(200);
    expect(sgSaved.statusCode).toBe(200);
    const own = await get('/assignments/asg-a1/submissions', t1());
    expect(own.statusCode).toBe(200);
    expect(ids(own)).toEqual([s1Saved.body.data.id, sgSaved.body.data.id].sort());
    expect((await get('/assignments/asg-a2/submissions', t1())).statusCode).toBe(403);
    expect((await get('/assignments/asg-a1/submissions', t2())).statusCode).toBe(403);
    const wrongParent = await patch(`/assignments/asg-a2/submissions/${s1Saved.body.data.id}/review`, t1(), {
      grade: 'A'
    });
    expect(wrongParent.statusCode).toBe(404);
    const reviewed = await patch(`/assignments/asg-a1/submissions/${s1Saved.body.data.id}/review`, t1(), {
      grade: 'Excellent',
      feedback: 'Clear work'
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.body.data.status).toBe('reviewed');
    const foreignReview = await patch(`/assignments/asg-a1/submissions/${s1Saved.body.data.id}/review`, t2(), { grade: 'A' });
    expect(foreignReview.statusCode).toBe(403);
    const locked = await put('/assignments/asg-a1/submission', s1(), { content: 'Changed' });
    expect(locked.statusCode).toBe(409);
    expect(locked.body.details.code).toBe('SUBMISSION_REVIEWED');
  });

  test('a linked center is narrowed to its own center classes', async () => {
    const saved = await put('/assignments/asg-a1/submission', s1(), { content: 'Answer' });
    const own = await get('/assignments/asg-a1/submissions', ca1());
    expect(own.statusCode).toBe(200);
    expect(ids(own)).toEqual([saved.body.data.id]);
    expect((await get('/assignments/asg-a2/submissions', ca1())).statusCode).toBe(403);
    const review = await patch(`/assignments/asg-a1/submissions/${saved.body.data.id}/review`, ca1(), { grade: 'Good' });
    expect(review.statusCode).toBe(200);
  });

  test('operator and cross-tenant access follow the tenant boundary', async () => {
    const saved = await put('/assignments/asg-a1/submission', s1(), { content: 'Answer' });
    expect((await get('/assignments/asg-a1/submissions', ownerA())).statusCode).toBe(200);
    expect((await get('/assignments/asg-a1/submissions', ownerB())).statusCode).toBe(404);
    expect((await patch(`/assignments/asg-a1/submissions/${saved.body.data.id}/review`, ownerB(), { grade: 'A' })).statusCode).toBe(404);
    expect((await get('/assignments/asg-b/submissions', ownerA())).statusCode).toBe(404);
  });

  test('review validates its body and never accepts server-owned fields', async () => {
    const saved = await put('/assignments/asg-a1/submission', s1(), { content: 'Answer' });
    expect((await patch(`/assignments/asg-a1/submissions/${saved.body.data.id}/review`, t1(), {})).statusCode).toBe(400);
    expect((await patch(`/assignments/asg-a1/submissions/${saved.body.data.id}/review`, t1(), { grade: 'A', studentId: 'stu-2' })).statusCode).toBe(400);
    expect((await put('/assignments/asg-a1/submission', s1(), { content: 'Answer', tenantId: 'sub-b' })).statusCode).toBe(400);
  });
});
