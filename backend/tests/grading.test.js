'use strict';

// STU-10 Education Grading records — regression suite (Device 2).
//
// Grading is the recorded outcome for ONE Enrollment, and this suite pins the
// contracts STU-10 locks down:
//
//   1. ONE REFERENCE. A row stores `enrollmentId` and nothing else. No student,
//      class, course, program, teacher or center reference is persisted, and the
//      Class chain behind the Enrollment is never walked — so an archived
//      Course, Program, Teacher or Center cannot invalidate a historical grade.
//   2. ONE CANONICAL VALUE, NO SCALE. `grade` is a bounded, trimmed, non-empty
//      string recorded verbatim. The suite pins that NO scale is imposed: no
//      numeric range, no enum, no percent/letter/GPA validation, and no
//      comparison, conversion or aggregation anywhere. `score`, `mark`, `result`,
//      `grades`, `exam` and `exams` stay refused because they belong to a
//      per-assessment model the repository does not have.
//   3. UNIQUENESS. At most one row per (tenant, enrollment). There is no
//      assessment identity, so a second row would have to invent one; a genuine
//      second term is a withdraw + re-enroll, which yields a new enrollment id.
//   4. DATE. Client-supplied, strict date-only `YYYY-MM-DD`, never derived from
//      the server clock, never normalized, no timezone. The future is refused.
//      The enrollment WINDOW is deliberately NOT applied — a term grade is
//      routinely awarded after the enrollment closed — which is the one
//      intentional divergence from STU-8.
//   5. CORRECTION, NOT LIFECYCLE. `grade`, `gradingDate` AND `notes` are
//      mutable; `enrollmentId` is immutable. There is no DELETE, no /archive and
//      no /withdraw, so a refused correction is the only failure mode that has
//      to leave the row byte-for-byte unchanged.
//
// The suite also pins the absences: no assessment, exam, coursework, transcript,
// certificate, GPA, ranking, notification, guardian, financial or timezone field
// is writable, and grading touches neither the attendance nor the scheduling
// store — there is no `sessionId` and no `scheduleId`.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore, listStores } = require('./helpers/testData');

const companies = [
  { id: 'grd-a', name: 'Grading Tenant A', code: 'GRDA', active: true },
  { id: 'grd-b', name: 'Grading Tenant B', code: 'GRDB', active: true },
  { id: 'grd-retired', name: 'Retired Grading Tenant', code: 'GRDR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'grdOwner', password, role: 'Owner', fullName: 'Grading Owner',
      tenantIds: ['grd-a', 'grd-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Grading permissions EXPLICITLY, so the
      // suite proves an unregistered permission still fails closed rather than
      // being honoured because a client record asked for it.
      id: 'u-clerk', username: 'grdClerk', password, role: 'Viewer', fullName: 'Grading Clerk',
      permissions: ['education.grading.view', 'education.grading.edit'],
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'grdManager', password, role: 'Manager', fullName: 'Grading Manager',
      tenantIds: ['grd-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const TODAY = new Date().toISOString().slice(0, 10);

function dayOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

const dayAt = (day, hour) => day + 'T' + String(hour).padStart(2, '0') + ':00:00.000Z';

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-10 grading.service — enrollment reference, grade semantics, uniqueness and correction', () => {
  let dir;
  let service;
  let enrollments;
  let students;
  let classes;
  let courses;
  let programs;
  let teachers;
  let centers;
  let storage;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('grd-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/grading.service');
    enrollments = require('../services/enrollment.service');
    students = require('../services/student.service');
    classes = require('../services/class.service');
    courses = require('../services/course.service');
    programs = require('../services/program.service');
    teachers = require('../services/teacher.service');
    centers = require('../services/center.service');
    storage = require('../repositories/storageAdapter');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'grd-a' };
  const B = { tenantId: 'grd-b' };

  const studentIn = (ctx, opts = {}) => {
    const input = { firstName: 'Nadia', lastName: opts.last || 'Hassan' };
    if (opts.status) input.status = opts.status;
    return students.createStudent(ctx, input);
  };

  const teacherIn = (ctx, opts = {}) => {
    const input = { firstName: 'Ali', lastName: opts.last || 'One' };
    if (opts.status) input.status = opts.status;
    return teachers.createTeacher(ctx, input);
  };

  // Center -> Program -> Course -> Class plus a Teacher, in one tenant. Center
  // is optional; `opts.classStatus` may be 'inactive'.
  const chainIn = (ctx, opts = {}) => {
    const programInput = { name: opts.programName || 'English Track' };
    if (opts.centerId) programInput.centerId = opts.centerId;
    const program = programs.createProgram(ctx, programInput);
    const course = courses.createCourse(ctx, { programId: program.id, name: opts.courseName || 'Grammar 101' });
    const teacher = teacherIn(ctx, { last: opts.teacherLast || 'One', status: opts.teacherStatus });
    const classInput = { courseId: course.id, teacherId: teacher.id, name: opts.className || 'A1' };
    if (opts.classStatus) classInput.status = opts.classStatus;
    const klass = classes.createClass(ctx, classInput);
    return { program, course, teacher, klass };
  };

  // A ready (student, class) pair in one tenant.
  const pairIn = (ctx, opts = {}) => {
    const chain = chainIn(ctx, opts);
    const student = studentIn(ctx, { last: opts.studentLast || 'Hassan', status: opts.studentStatus });
    return { ...chain, student, classId: chain.klass.id };
  };

  // A live STU-7 enrollment, optionally back-dated in the store so historical
  // dates exist. The STU-7 API refuses to back-date, so the timestamps are
  // rewritten afterwards — exactly the state a migrated term would be in.
  const enrollmentIn = (ctx, opts = {}) => {
    const pair = opts.pair || pairIn(ctx, opts);
    const created = enrollments.createEnrollment(ctx, {
      studentId: pair.student.id,
      classId: pair.classId
    });
    if (opts.backdateDays) {
      const enrolledAt = dayAt(dayOffset(-opts.backdateDays), 9);
      const doc = storage.read('educationEnrollments');
      storage.write('educationEnrollments', {
        ...doc,
        enrollments: (doc.enrollments || []).map(e =>
          e.id === created.id ? { ...e, enrolledAt, createdAt: enrolledAt, updatedAt: enrolledAt } : e)
      });
    }
    if (opts.withdraw) enrollments.withdrawEnrollment(ctx, created.id);
    return { ...pair, enrollment: created, enrollmentId: created.id };
  };

  // A valid create payload for `enrollment`, defaulting to today.
  const award = (enrollmentId, extra, ctx) => service.createGrade(ctx || A, Object.assign(
    { enrollmentId, gradingDate: TODAY, grade: 'B' },
    extra || {}
  ));

  // --- TENANT CONTEXT -------------------------------------------------------

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listGrading(null)).toThrow('Tenant context is required');
    expect(() => service.listGrading({})).toThrow('Tenant context is required');
    expect(() => service.getGrade(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createGrade(null, { enrollmentId: 'e', gradingDate: TODAY, grade: 'B' }))
      .toThrow('Tenant context is required');
    expect(() => service.updateGrade(null, 'x', { grade: 'A' })).toThrow('Tenant context is required');
    expect(() => service.updateGrade({ tenantId: '' }, 'x', {})).toThrow('Tenant context is required');
  });

  // --- RECORD ---------------------------------------------------------------

  test('create returns exactly the agreed shape and nothing else', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId, { notes: 'term result' });

    expect(Object.keys(created).sort()).toEqual([
      'createdAt', 'enrollmentId', 'grade', 'gradingDate', 'id', 'notes', 'tenantId', 'updatedAt'
    ]);
    expect(created.id).toMatch(/^grd-/);
    expect(created.tenantId).toBe('grd-a');
    expect(created.enrollmentId).toBe(enrollmentId);
    expect(created.gradingDate).toBe(TODAY);
    expect(created.grade).toBe('B');
    expect(created.notes).toBe('term result');
    expect(created.createdAt).toBe(created.updatedAt);

    // One reference only: no student, class, course, program, teacher or center.
    for (const forbidden of ['studentId', 'classId', 'courseId', 'programId', 'teacherId',
                             'centerId', 'sessionId', 'scheduleId', 'assessmentId']) {
      expect(Object.prototype.hasOwnProperty.call(created, forbidden)).toBe(false);
    }
  });

  test('get returns the stored row and list returns it too', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId, { grade: 'A+' });

    expect(service.getGrade(A, created.id)).toEqual(created);
    expect(service.listGrading(A)).toEqual([created]);
    expect(service.getGrade(A, 'grd-nope')).toBeNull();
    expect(service.getGrade(B, created.id)).toBeNull();
  });

  test('the id is stable across reads and updates', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    const updated = service.updateGrade(A, created.id, { grade: 'C' });
    expect(updated.id).toBe(created.id);
    expect(service.getGrade(A, created.id).id).toBe(created.id);
  });

  test('the store is { grades: [] } and holds every tenant that wrote it', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'A2' });
    const other = enrollmentIn(B, { studentLast: 'Three', className: 'B1' });

    award(first.enrollmentId);
    award(second.enrollmentId, { grade: 'A' });
    award(other.enrollmentId, { grade: 'A' }, B);

    const stored = readStore(dir, 'educationGrading');
    expect(Object.keys(stored)).toEqual(['grades']);
    expect(stored.grades).toHaveLength(3);
    expect(stored.grades.filter(g => g.tenantId === 'grd-a')).toHaveLength(2);
    expect(stored.grades.filter(g => g.tenantId === 'grd-b')).toHaveLength(1);
    expect(service.listGrading(A)).toHaveLength(2);
    expect(service.listGrading(B)).toHaveLength(1);
  });

  test('the service declares the store key it owns and its writable surface', () => {
    expect(service.STORE_KEY).toBe('educationGrading');
    expect(Object.keys(service.WRITABLE_FIELDS))
      .toEqual(['enrollmentId', 'gradingDate', 'grade', 'notes']);
    expect(service.FORBIDDEN_FIELDS).toContain('tenantId');
    // The canonical field is NOT in the refused list, and the rest of the
    // grading vocabulary still is.
    expect(service.LATER_PHASE_FIELDS).not.toContain('grade');
    for (const reserved of ['score', 'mark', 'result', 'grades', 'exam', 'exams']) {
      expect(service.LATER_PHASE_FIELDS).toContain(reserved);
    }
  });

  // --- REQUIRED FIELDS ------------------------------------------------------

  test('create requires enrollmentId, gradingDate and grade', () => {
    const { enrollmentId } = enrollmentIn(A);
    expect(() => service.createGrade(A, { gradingDate: TODAY, grade: 'B' }))
      .toThrow('enrollmentId is required');
    expect(() => service.createGrade(A, { enrollmentId, grade: 'B' }))
      .toThrow('gradingDate is required');
    expect(() => service.createGrade(A, { enrollmentId, gradingDate: TODAY }))
      .toThrow('grade is required');
    expect(() => service.createGrade(A, {})).toThrow(/is required/);
    expect(() => service.createGrade(A, null)).toThrow('request body must be a JSON object');
    expect(() => service.createGrade(A, [])).toThrow('request body must be a JSON object');
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a blank required field is treated as missing, not as a value', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const blank of ['', '   ']) {
      expect(() => service.createGrade(A, { enrollmentId: blank, gradingDate: TODAY, grade: 'B' }))
        .toThrow('enrollmentId is required');
      expect(() => service.createGrade(A, { enrollmentId, gradingDate: blank, grade: 'B' }))
        .toThrow('gradingDate is required');
      expect(() => service.createGrade(A, { enrollmentId, gradingDate: TODAY, grade: blank }))
        .toThrow('grade is required');
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  // --- GRADE SEMANTICS ------------------------------------------------------

  test('the grade is recorded verbatim: no scale, no unit, no normalization', () => {
    // Every one of these is a legitimate way an institution writes a mark, and
    // the repository defines no scale against which any of them could be judged
    // invalid. STU-10 stores the value and asserts nothing further about it.
    const values = ['B', 'A+', 'distinction', '85', '85%', '3.9', '4.0 GPA', 'PASS',
                    ' merit ', 'ممتاز', '5/5', '90/100', 'good', 'VG'];
    values.forEach((value, index) => {
      const { enrollmentId } = enrollmentIn(A, { studentLast: 'S' + index, className: 'C' + index });
      const created = award(enrollmentId, { grade: value });
      // Stored trimmed - the only transformation applied - and otherwise verbatim.
      expect(created.grade).toBe(value.trim());
    });
    expect(service.listGrading(A)).toHaveLength(values.length);
  });

  test('a grade longer than the bound is refused rather than truncated', () => {
    const { enrollmentId } = enrollmentIn(A);
    expect(award(enrollmentId, { grade: 'x'.repeat(160) }).grade).toHaveLength(160);
    const second = enrollmentIn(A, { studentLast: 'Other', className: 'Other' });
    expect(() => award(second.enrollmentId, { grade: 'x'.repeat(161) }))
      .toThrow('grade must be at most 160 characters');
    expect(service.listGrading(A)).toHaveLength(1);
  });

  test('a non-string grade is refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const bad of [85, true, {}, [], new Date()]) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: bad
      })).toThrow('grade must be a string');
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('notes are optional, bounded and independent of the grade contract', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'A2' });
    expect(award(first.enrollmentId).notes).toBe('');
    expect(award(second.enrollmentId, { notes: '  re-marked  ' }).notes).toBe('re-marked');
    const third = enrollmentIn(A, { studentLast: 'Three', className: 'A3' });
    expect(() => award(third.enrollmentId, { notes: 'x'.repeat(161) }))
      .toThrow('notes must be at most 160 characters');
  });

  // --- DATE -----------------------------------------------------------------

  test('a date that is not a strict YYYY-MM-DD day is refused, never coerced', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const bad of ['2026-10-01T09:00:00Z', '01/10/2026', '2026-02-30', '2026-13-01',
                       '2026-00-10', '2023-02-29', '10-01-2026', 20261001, true]) {
      expect(() => service.createGrade(A, { enrollmentId, gradingDate: bad, grade: 'B' }))
        .toThrow(/gradingDate must be (a date in YYYY-MM-DD format|a real calendar date|a string)/);
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a leap day that really exists is accepted', () => {
    const { enrollmentId } = enrollmentIn(A, { backdateDays: 400 });
    expect(award(enrollmentId, { gradingDate: '2024-02-29' }).gradingDate).toBe('2024-02-29');
  });

  test('a future grading date is refused: a grade records what already happened', () => {
    const { enrollmentId } = enrollmentIn(A);
    expect(() => award(enrollmentId, { gradingDate: dayOffset(1) }))
      .toThrow('gradingDate cannot be in the future');
    expect(() => award(enrollmentId, { gradingDate: dayOffset(30) }))
      .toThrow('gradingDate cannot be in the future');
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('the date is client-supplied and never derived from the server clock', () => {
    const { enrollmentId } = enrollmentIn(A, { backdateDays: 60 });
    const historic = dayOffset(-45);
    expect(award(enrollmentId, { gradingDate: historic }).gradingDate).toBe(historic);
  });

  test('no timezone is stored or interpreted', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    expect(Object.prototype.hasOwnProperty.call(created, 'timezone')).toBe(false);
    const second = enrollmentIn(A, { studentLast: 'Other', className: 'Other' });
    expect(() => service.createGrade(A, {
      enrollmentId: second.enrollmentId, gradingDate: TODAY, grade: 'B', timezone: 'Africa/Cairo'
    })).toThrow('timezone is not writable');
  });

  // --- ENROLLMENT OWNERSHIP -------------------------------------------------

  test('an unresolvable enrollment is refused and creates nothing', () => {
    expect(() => award('enr-nope')).toThrow('enrollmentId does not reference an Enrollment in this tenant');
    expect(service.listGrading(A)).toHaveLength(0);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a foreign enrollment is refused identically to a nonexistent one', () => {
    const foreign = enrollmentIn(B);
    let foreignError;
    let unknownError;
    try { award(foreign.enrollmentId); } catch (err) { foreignError = err.message; }
    try { award('enr-nope'); } catch (err) { unknownError = err.message; }
    // Existence of another tenant's Enrollment is NOT leaked.
    expect(foreignError).toBe(unknownError);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a malformed enrollmentId is refused before any lookup', () => {
    // `[]` stringifies to an empty string, so it is caught as a MISSING id
    // rather than as a wrong type; every other value is a type failure.
    for (const bad of [12345, {}, true]) {
      expect(() => service.createGrade(A, { enrollmentId: bad, gradingDate: TODAY, grade: 'B' }))
        .toThrow('enrollmentId must be a string');
    }
    expect(() => service.createGrade(A, { enrollmentId: [], gradingDate: TODAY, grade: 'B' }))
      .toThrow('enrollmentId is required');
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a cross-tenant enrollment never grants a grade to either tenant', () => {
    const inA = enrollmentIn(A);
    const inB = enrollmentIn(B);
    expect(() => award(inB.enrollmentId, {}, A))
      .toThrow('enrollmentId does not reference an Enrollment in this tenant');
    expect(() => award(inA.enrollmentId, {}, B))
      .toThrow('enrollmentId does not reference an Enrollment in this tenant');
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a WITHDRAWN enrollment may still be graded — the window is not enforced', () => {
    // The one intentional divergence from STU-8: a term grade is routinely
    // awarded after the enrollment closed, and a finished term is frequently
    // backfilled, so no enrollment window is applied in either direction.
    const closed = enrollmentIn(A, { backdateDays: 30, withdraw: true });
    const after = award(closed.enrollmentId, { gradingDate: TODAY, grade: 'A' });
    expect(after.gradingDate).toBe(TODAY);

    // A second row for the same enrollment is a CONFLICT, not a second window.
    expect(() => award(closed.enrollmentId, { gradingDate: dayOffset(-20), grade: 'B' }))
      .toThrow('grade already recorded for this enrollment');
    expect(service.listGrading(A)).toHaveLength(1);
  });

  test('a backdated term is graded without any window check', () => {
    // Backdated 60 days: a grade 45 days ago sits inside that window, and the
    // rule under test is that STU-10 does not consult the window at all.
    const { enrollmentId } = enrollmentIn(A, { backdateDays: 60 });
    expect(award(enrollmentId, { gradingDate: dayOffset(-45) }).gradingDate).toBe(dayOffset(-45));
  });

  test('an archived parent chain never invalidates an existing grade', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const chain = enrollmentIn(A, { centerId: center.id, studentLast: 'Solo', className: 'Only' });
    const created = award(chain.enrollmentId, { notes: 'kept' });

    centers.archiveCenter(A, center.id);
    programs.archiveProgram(A, chain.program.id);
    courses.archiveCourse(A, chain.course.id);
    teachers.archiveTeacher(A, chain.teacher.id);
    classes.archiveClass(A, chain.klass.id);

    const still = service.getGrade(A, created.id);
    expect(still).not.toBeNull();
    expect(still.notes).toBe('kept');
    expect(still.grade).toBe('B');
    expect(service.updateGrade(A, created.id, { grade: 'A' }).grade).toBe('A');
  });

  test('grading reads and writes no enrollment, attendance or scheduling store', () => {
    const chain = enrollmentIn(A);
    const enrollmentsBefore = readStore(dir, 'educationEnrollments');
    const classesBefore = readStore(dir, 'educationClasses');
    const studentsBefore = readStore(dir, 'educationStudents');

    const created = award(chain.enrollmentId);
    service.updateGrade(A, created.id, { grade: 'A', gradingDate: dayOffset(-1) });

    expect(readStore(dir, 'educationEnrollments')).toEqual(enrollmentsBefore);
    expect(readStore(dir, 'educationClasses')).toEqual(classesBefore);
    expect(readStore(dir, 'educationStudents')).toEqual(studentsBefore);
    // Grading created no attendance or scheduling data of its own.
    expect(readStore(dir, 'educationAttendance')).toBeNull();
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  // --- UNIQUENESS -----------------------------------------------------------

  test('a second grade for the same enrollment is a typed conflict', () => {
    const { enrollmentId } = enrollmentIn(A);
    award(enrollmentId);
    let thrown;
    try { award(enrollmentId, { grade: 'A', gradingDate: dayOffset(-1) }); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(service.GradingConflictError);
    expect(thrown.code).toBe('GRADING_CONFLICT');
    expect(thrown.conflict).toBe(true);
    expect(thrown.enrollmentId).toBe(enrollmentId);
    // The losing write changed nothing, not even the date.
    const stored = service.listGrading(A);
    expect(stored).toHaveLength(1);
    expect(stored[0].grade).toBe('B');
    expect(stored[0].gradingDate).toBe(TODAY);
  });

  test('two enrollments in the same class each hold their own grade', () => {
    const chain = chainIn(A, { className: 'Shared' });
    const first = enrollments.createEnrollment(A, { studentId: studentIn(A, { last: 'One' }).id, classId: chain.klass.id });
    const second = enrollments.createEnrollment(A, { studentId: studentIn(A, { last: 'Two' }).id, classId: chain.klass.id });

    award(first.id, { grade: 'A' });
    // Same class, same day, different enrollment: no conflict.
    expect(award(second.id, { grade: 'B' }).grade).toBe('B');
    expect(service.listGrading(A)).toHaveLength(2);
  });

  test('cross-tenant grades never conflict with each other', () => {
    const inA = enrollmentIn(A);
    const inB = enrollmentIn(B);
    award(inA.enrollmentId, { grade: 'A' });
    expect(award(inB.enrollmentId, { grade: 'A' }, B).tenantId).toBe('grd-b');
    expect(service.listGrading(A)).toHaveLength(1);
    expect(service.listGrading(B)).toHaveLength(1);
  });

  test('a withdraw + re-enroll cycle yields a SECOND grade, not a conflict', () => {
    // The honest way to record a second term for the same student and class.
    const pair = pairIn(A, { studentLast: 'Reenrol', className: 'R1' });
    const first = enrollments.createEnrollment(A, { studentId: pair.student.id, classId: pair.classId });
    award(first.id, { grade: 'B' });
    enrollments.withdrawEnrollment(A, first.id);

    const second = enrollments.createEnrollment(A, { studentId: pair.student.id, classId: pair.classId });
    expect(second.id).not.toBe(first.id);
    expect(award(second.id, { grade: 'A' }).grade).toBe('A');

    const listed = service.listGrading(A);
    expect(listed).toHaveLength(2);
    expect(listed.map(g => g.enrollmentId).sort()).toEqual([first.id, second.id].sort());
    // The original grade is untouched by the withdrawal.
    expect(service.getGrade(A, listed.find(g => g.enrollmentId === first.id).id).grade).toBe('B');
  });

  test('the conflict error message leaks no tenant, path or stack detail', () => {
    const { enrollmentId } = enrollmentIn(A);
    award(enrollmentId);
    let thrown;
    try { award(enrollmentId); } catch (err) { thrown = err; }
    expect(thrown.message).toBe('grade already recorded for this enrollment');
    expect(thrown.message).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
    expect(thrown.message).not.toContain('grd-a');
    expect(thrown.message).not.toContain('node_modules');
  });

  // --- UPDATE ---------------------------------------------------------------

  test('a re-mark changes the grade and bumps updatedAt only', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId, { grade: 'C', notes: 'first attempt' });
    const updated = service.updateGrade(A, created.id, { grade: 'B' });

    expect(updated.grade).toBe('B');
    expect(updated.notes).toBe('first attempt');
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe(created.tenantId);
    expect(updated.enrollmentId).toBe(created.enrollmentId);
    expect(updated.gradingDate).toBe(created.gradingDate);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  test('a re-mark can change the date and the notes, and omits are preserved', () => {
    const { enrollmentId } = enrollmentIn(A, { backdateDays: 30 });
    const created = award(enrollmentId, { gradingDate: dayOffset(-20), grade: 'B', notes: 'marked' });
    const moved = service.updateGrade(A, created.id, { gradingDate: dayOffset(-10) });
    expect(moved.gradingDate).toBe(dayOffset(-10));
    expect(moved.grade).toBe('B');
    expect(moved.notes).toBe('marked');
    expect(moved.createdAt).toBe(created.createdAt);
  });

  test('the grade is trimmed on correction, never coerced', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    expect(service.updateGrade(A, created.id, { grade: '  A+  ' }).grade).toBe('A+');
  });

  test('enrollmentId cannot be changed — not even to the same valid enrollment', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'A2' });
    const created = award(first.enrollmentId);

    expect(() => service.updateGrade(A, created.id, { enrollmentId: second.enrollmentId }))
      .toThrow('enrollmentId cannot be changed');
    // Even the SAME enrollment is refused: the field is immutable, not "equal".
    expect(() => service.updateGrade(A, created.id, { enrollmentId: first.enrollmentId }))
      .toThrow('enrollmentId cannot be changed');
    expect(service.getGrade(A, created.id).enrollmentId).toBe(first.enrollmentId);
  });

  test('null, undefined, empty and whitespace enrollmentId are all refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    // OWN-PROPERTY check: these are attempts to re-point the grade, not
    // omissions, so each is rejected rather than silently ignored.
    for (const bad of [null, undefined, '', '   ']) {
      expect(() => service.updateGrade(A, created.id, { enrollmentId: bad }))
        .toThrow('enrollmentId cannot be changed');
    }
    expect(service.getGrade(A, created.id).enrollmentId).toBe(enrollmentId);
  });

  test('a future date on correction is refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    expect(() => service.updateGrade(A, created.id, { gradingDate: dayOffset(2) }))
      .toThrow('gradingDate cannot be in the future');
    expect(service.getGrade(A, created.id).gradingDate).toBe(TODAY);
  });

  test('a failed correction leaves the persisted row byte-for-byte unchanged', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId, { grade: 'B', notes: 'original' });
    const beforeBytes = JSON.stringify(readStore(dir, 'educationGrading'));

    expect(() => service.updateGrade(A, created.id, { enrollmentId: 'enr-nope' })).toThrow();
    expect(() => service.updateGrade(A, created.id, { gradingDate: '2026-13-01' })).toThrow();
    expect(() => service.updateGrade(A, created.id, { gradingDate: dayOffset(3) })).toThrow();
    expect(() => service.updateGrade(A, created.id, { grade: '' })).toThrow('grade cannot be empty');
    expect(() => service.updateGrade(A, created.id, { grade: '   ' })).toThrow('grade cannot be empty');
    expect(() => service.updateGrade(A, created.id, { gradingDate: '' })).toThrow('gradingDate cannot be empty');
    expect(() => service.updateGrade(A, created.id, { gradingDate: '  ' })).toThrow('gradingDate cannot be empty');
    expect(() => service.updateGrade(A, created.id, { grade: 'x'.repeat(200) })).toThrow();
    expect(() => service.updateGrade(A, created.id, { notes: 'x'.repeat(200) })).toThrow();
    expect(() => service.updateGrade(A, created.id, { tenantId: 'grd-b' })).toThrow();
    expect(() => service.updateGrade(A, created.id, { score: 90 })).toThrow();
    expect(() => service.updateGrade(A, created.id, { sessionId: 'ses-x' })).toThrow();

    expect(JSON.stringify(readStore(dir, 'educationGrading'))).toBe(beforeBytes);
  });

  test('a correction never reintroduces a denied field into the record', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    expect(() => service.updateGrade(A, created.id, { tenantId: 'grd-b' }))
      .toThrow('tenantId is not writable');
    expect(() => service.updateGrade(A, created.id, { id: 'grd-forged' }))
      .toThrow('id is not writable');
    expect(() => service.updateGrade(A, created.id, { createdAt: '2000-01-01T00:00:00.000Z' }))
      .toThrow('createdAt is not writable');
    expect(() => service.updateGrade(A, created.id, { studentId: 'stu-x' }))
      .toThrow('studentId is not writable');
    expect(service.getGrade(A, created.id).tenantId).toBe('grd-a');
    expect(service.getGrade(A, created.id).id).toBe(created.id);
    expect(service.getGrade(A, created.id).createdAt).toBe(created.createdAt);
  });

  test('a correction on an unknown or foreign row answers null, never a leak', () => {
    const foreign = enrollmentIn(B);
    const created = award(foreign.enrollmentId, { grade: 'A' }, B);
    expect(service.updateGrade(A, 'grd-nope', { grade: 'B' })).toBeNull();
    expect(service.updateGrade(A, created.id, { grade: 'B' })).toBeNull();
    expect(service.getGrade(B, created.id).grade).toBe('A');
  });

  // --- LIST FILTERS ---------------------------------------------------------

  test('list is empty for a tenant with no rows and never touches another tenant', () => {
    enrollmentIn(A);
    enrollmentIn(B);
    expect(service.listGrading(A)).toEqual([]);
    expect(service.listGrading(B)).toEqual([]);
  });

  test('list filters by enrollmentId, gradingDate and an inclusive date range', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'A2' });
    const third = enrollmentIn(A, { studentLast: 'Three', className: 'A3' });

    // One grade per enrollment, so the range is built from three enrollments.
    award(first.enrollmentId, { gradingDate: dayOffset(-1) });
    award(second.enrollmentId, { gradingDate: dayOffset(-2) });
    award(third.enrollmentId, { gradingDate: dayOffset(-3) });

    expect(service.listGrading(A, { enrollmentId: first.enrollmentId })).toHaveLength(1);
    expect(service.listGrading(A, { enrollmentId: second.enrollmentId })).toHaveLength(1);
    expect(service.listGrading(A, { enrollmentId: 'enr-nope' })).toEqual([]);
    expect(service.listGrading(A, { gradingDate: dayOffset(-2) })).toHaveLength(1);
    expect(service.listGrading(A, { dateFrom: dayOffset(-3), dateTo: dayOffset(-2) })).toHaveLength(2);
    expect(service.listGrading(A, { dateFrom: dayOffset(-3) })).toHaveLength(3);
    expect(service.listGrading(A, { dateTo: dayOffset(-2) })).toHaveLength(2);
    expect(service.listGrading(A, { dateFrom: dayOffset(-3), dateTo: dayOffset(-3) })).toHaveLength(1);
    expect(service.listGrading(A, { dateFrom: dayOffset(9) })).toEqual([]);
  });

  test('the grade filter is an exact match on the stored value', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'A2' });
    const third = enrollmentIn(A, { studentLast: 'Three', className: 'A3' });
    award(first.enrollmentId, { grade: 'B' });
    award(second.enrollmentId, { grade: 'A+' });
    award(third.enrollmentId, { grade: 'b' });

    expect(service.listGrading(A, { grade: 'B' })).toHaveLength(1);
    expect(service.listGrading(A, { grade: 'A+' })).toHaveLength(1);
    // No case folding: the value is recorded verbatim, so filtering must not
    // invent a comparison rule the record never went through.
    expect(service.listGrading(A, { grade: 'b' })).toHaveLength(1);
    expect(service.listGrading(A, { grade: 'b' })[0].grade).toBe('b');
    expect(service.listGrading(A, { grade: 'A' })).toEqual([]);
    expect(service.listGrading(A, { grade: 'ZZZ' })).toEqual([]);
  });

  test('studentId and classId are DERIVED filters resolved through the enrollment', () => {
    const chain = chainIn(A, { className: 'Shared' });
    const wanted = students.createStudent(A, { firstName: 'Nadia', lastName: 'Wanted' });
    const other = students.createStudent(A, { firstName: 'Nadia', lastName: 'Other' });
    const wantedEnrollment = enrollments.createEnrollment(A, { studentId: wanted.id, classId: chain.klass.id });
    const otherEnrollment = enrollments.createEnrollment(A, { studentId: other.id, classId: chain.klass.id });

    award(wantedEnrollment.id, { grade: 'A' });
    award(otherEnrollment.id, { grade: 'B' });

    const byStudent = service.listGrading(A, { studentId: wanted.id });
    expect(byStudent).toHaveLength(1);
    expect(byStudent[0].grade).toBe('A');
    // The derived filter is never echoed as a stored field.
    expect(Object.prototype.hasOwnProperty.call(byStudent[0], 'studentId')).toBe(false);
    expect(service.listGrading(A, { classId: chain.klass.id })).toHaveLength(2);
  });

  test('an unknown or foreign derived filter returns an empty list without leaking', () => {
    const chain = enrollmentIn(A);
    award(chain.enrollmentId);
    const foreignStudent = students.createStudent(B, { firstName: 'Nadia', lastName: 'Foreign' });

    const viaUnknown = service.listGrading(A, { studentId: 'stu-nope' });
    const viaForeign = service.listGrading(A, { studentId: foreignStudent.id });
    const viaForeignClass = service.listGrading(A, { classId: 'cls-nope' });
    expect(viaUnknown).toEqual([]);
    // No existence leakage across tenants.
    expect(viaForeign).toEqual(viaUnknown);
    expect(viaForeignClass).toEqual([]);
  });

  test('no N+1: the derived filters use batched list calls, never per-row lookups', () => {
    const chain = chainIn(A, { className: 'Bulk' });
    const enrollmentIds = [];
    for (let i = 0; i < 10; i++) {
      const student = students.createStudent(A, { firstName: 'Nadia', lastName: 'B' + i });
      enrollmentIds.push(enrollments.createEnrollment(A, { studentId: student.id, classId: chain.klass.id }).id);
    }
    enrollmentIds.forEach(id => award(id, { grade: 'B' }));

    const listSpy = jest.spyOn(enrollments, 'listEnrollments');
    const getSpy = jest.spyOn(enrollments, 'getEnrollment');
    expect(service.listGrading(A, { classId: chain.klass.id })).toHaveLength(10);
    // ONE batched listEnrollments call regardless of how many rows are filtered.
    expect(listSpy.mock.calls.length).toBe(1);
    expect(getSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
    getSpy.mockRestore();
  });

  test('rows are ordered by grading date, deterministically', () => {
    const chain = chainIn(A, { className: 'Ordered' });
    const mk = (index) => {
      const student = students.createStudent(A, { firstName: 'Nadia', lastName: 'O' + index });
      return enrollments.createEnrollment(A, { studentId: student.id, classId: chain.klass.id }).id;
    };
    const plan = [
      { day: -3, grade: 'D' },
      { day: -1, grade: 'E' },
      { day: -1, grade: 'F' },
      { day: -2, grade: 'G' }
    ];
    plan.forEach((entry, index) => award(mk(index), { gradingDate: dayOffset(entry.day), grade: entry.grade }));

    const listed = service.listGrading(A);
    expect(listed.map(g => g.gradingDate)).toEqual([
      dayOffset(-3), dayOffset(-2), dayOffset(-1), dayOffset(-1)
    ]);
    // The order is stable across repeated calls.
    expect(service.listGrading(A).map(g => g.id)).toEqual(listed.map(g => g.id));
  });

  test('list returns copies, so a caller cannot mutate the store through them', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId);
    const listed = service.listGrading(A);
    listed[0].grade = 'ZZZ';
    expect(service.getGrade(A, created.id).grade).toBe('B');
  });

  // --- FORBIDDEN FIELDS -----------------------------------------------------

  test('server-owned fields cannot be written on create', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId',
                         'createdAt', 'updatedAt', 'gradingId']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('the rest of the grading vocabulary stays refused: no second opinion', () => {
    const { enrollmentId } = enrollmentIn(A);
    // These are the vocabulary of a per-assessment result model. Accepting them
    // here would create a second, disagreeable opinion about the same outcome.
    for (const field of ['score', 'scores', 'mark', 'marks', 'result', 'results',
                         'grades', 'exam', 'exams', 'assessment', 'assessments',
                         'assessmentId', 'assignment', 'assignments', 'coursework',
                         'questionBank', 'gpa', 'cgpa', 'rank', 'ranking', 'percentile',
                         'weight', 'weighted', 'total', 'maximum', 'maxScore',
                         'pass', 'passed', 'fail', 'failed', 'percentage',
                         'letterGrade', 'gradePoint', 'transcript', 'gradeId', 'gradingIds']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('derived ownership of another record is refused, not copied', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const field of ['studentId', 'classId', 'courseId', 'programId', 'teacherId',
                         'centerId', 'academicYear', 'enrollmentIds']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('attendance, scheduling and session coupling is refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const field of ['attendance', 'attendanceId', 'attendanceIds', 'sessionId',
                         'scheduleId', 'schedule', 'scheduling', 'dayOfWeek', 'startTime',
                         'endTime', 'room', 'recurrence']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('certificate, guardian, LMS and notification fields are refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const field of ['certificate', 'certificates', 'guardianId', 'guardianIds',
                         'lms', 'zoom', 'meetingUrl', 'videoUrl', 'notification',
                         'notifications', 'calendarSync', 'recordedBy', 'gradedBy',
                         'enrollmentStatus']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('financial and payroll fields are refused', () => {
    const { enrollmentId } = enrollmentIn(A);
    for (const field of ['payment', 'tuition', 'billing', 'invoice', 'salary', 'payroll']) {
      expect(() => service.createGrade(A, {
        enrollmentId, gradingDate: TODAY, grade: 'B', [field]: 'x'
      })).toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('a prototype-pollution payload is rejected and Object stays clean', () => {
    const { enrollmentId } = enrollmentIn(A);
    const payload = JSON.parse('{"enrollmentId":"' + enrollmentId + '","gradingDate":"'
      + TODAY + '","grade":"B","__proto__":{"polluted":"yes"}}');
    expect(() => service.createGrade(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();

    expect(() => service.updateGrade(A, 'x', { constructor: 'y' })).toThrow('constructor is not allowed');
    expect(() => service.updateGrade(A, 'x', { prototype: 'y' })).toThrow('prototype is not allowed');
    expect(service.listGrading(A)).toHaveLength(0);
  });

  test('nothing malicious is ever persisted and the record shape is exact', () => {
    const { enrollmentId } = enrollmentIn(A);
    const created = award(enrollmentId, { notes: 'ok' });
    const stored = readStore(dir, 'educationGrading');
    for (const record of stored.grades) {
      expect(Object.keys(record).sort()).toEqual(Object.keys(created).sort());
      expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
      expect(record.polluted).toBeUndefined();
      expect(record.studentId).toBeUndefined();
      expect(record.gpa).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-10 grading routes — authorization, tenant isolation and the grade contract', () => {
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

  const token = (username, tenantId, role) =>
    jwt.signAccessToken({ id: 'u-owner', username, role, tenantId });

  const ownerA = () => token('grdOwner', 'grd-a', 'Owner');
  const ownerB = () => token('grdOwner', 'grd-b', 'Owner');
  const managerA = () => token('grdManager', 'grd-a', 'Manager');
  const clerkA = () => token('grdClerk', 'grd-a', 'Viewer');

  const post = (path, tok) => request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);
  const put = (path, tok) => request(app).put(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);
  const get = (path, tok) => request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);

  const createChainIn = async (tok, opts = {}) => {
    const program = await post('/programs', tok).send({ name: 'English Track' });
    expect(program.statusCode).toBe(201);
    const course = await post('/courses', tok).send({ name: 'Grammar 101', programId: program.body.data.id });
    expect(course.statusCode).toBe(201);
    const teacher = await post('/teachers', tok).send({ firstName: 'Ali', lastName: opts.teacherLast || 'One' });
    expect(teacher.statusCode).toBe(201);
    const klass = await post('/classes', tok).send({
      courseId: course.body.data.id, teacherId: teacher.body.data.id, name: opts.className || 'A1'
    });
    expect(klass.statusCode).toBe(201);
    return {
      programId: program.body.data.id,
      courseId: course.body.data.id,
      teacherId: teacher.body.data.id,
      classId: klass.body.data.id
    };
  };

  // Builds the chain, a Student and an ACTIVE enrollment over HTTP.
  const setup = async (tok, opts = {}) => {
    const chain = await createChainIn(tok, opts);
    const student = await post('/students', tok)
      .send({ firstName: 'Nadia', lastName: opts.studentLast || 'Hassan' });
    expect(student.statusCode).toBe(201);
    const enrollment = await post('/enrollments', tok).send({
      studentId: student.body.data.id, classId: chain.classId
    });
    expect(enrollment.statusCode).toBe(201);
    return { ...chain, studentId: student.body.data.id, enrollmentId: enrollment.body.data.id };
  };

  const create = (body, tok) => post('/grading', tok).send(body);
  const awardOverHttp = (enrollmentId, extra, tok) =>
    create(Object.assign({ enrollmentId, gradingDate: TODAY, grade: 'B' }, extra || {}), tok || ownerA());

  // --- AUTH -----------------------------------------------------------------

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/grading`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/grading/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/grading`).send({ enrollmentId: 'e' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/grading/anything`).send({ grade: 'A' })).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('grd-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/grading`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/grading`).send({ enrollmentId: 'c' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Grading permissions fail closed, with no bypass', async () => {
    // The Clerk record holds education.grading.view / .edit EXPLICITLY and is
    // still refused: unknown permissions are not honoured because a client record
    // asked for them.
    expect((await get('/grading', clerkA())).statusCode).toBe(403);

    const chain = await setup(ownerA());
    const write = await awardOverHttp(chain.enrollmentId, {}, clerkA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('AUTHORIZATION: a Manager cannot write, and nothing is persisted on refusal', async () => {
    const chain = await setup(ownerA());
    expect((await awardOverHttp(chain.enrollmentId, {}, managerA())).statusCode).toBe(403);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('AUTHORIZATION: an Owner is admitted under the current registry behaviour', async () => {
    const chain = await setup(ownerA());
    expect((await get('/grading', ownerA())).statusCode).toBe(200);
    expect((await awardOverHttp(chain.enrollmentId)).statusCode).toBe(201);
  });

  // --- CRUD -----------------------------------------------------------------

  test('CRUD: the full grading lifecycle over HTTP', async () => {
    const chain = await setup(ownerA());
    const created = await create({
      enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'A+', notes: 'term result'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.message).toBe('Grading record created');
    expect(created.body.data.tenantId).toBe('grd-a');
    expect(created.body.data.enrollmentId).toBe(chain.enrollmentId);
    expect(created.body.data.grade).toBe('A+');
    expect(created.body.data.notes).toBe('term result');
    expect(Object.keys(created.body.data).sort()).toEqual([
      'createdAt', 'enrollmentId', 'grade', 'gradingDate', 'id', 'notes', 'tenantId', 'updatedAt'
    ]);
    const id = created.body.data.id;

    const fetched = await get(`/grading/${id}`, ownerA());
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.message).toBe('Grading record retrieved');
    expect(fetched.body.data.grade).toBe('A+');

    const listed = await get('/grading', ownerA());
    expect(listed.body.message).toBe('Grading retrieved');
    expect(listed.body.data).toHaveLength(1);

    const updated = await put(`/grading/${id}`, ownerA()).send({ grade: 'A', notes: 're-marked' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.message).toBe('Grading record updated');
    expect(updated.body.data.grade).toBe('A');
    expect(updated.body.data.enrollmentId).toBe(chain.enrollmentId);
  });

  test('CRUD: there is no DELETE, archive or withdraw route for a grade', async () => {
    const chain = await setup(ownerA());
    const id = (await awardOverHttp(chain.enrollmentId)).body.data.id;

    expect((await request(app).delete(`${BASE}/grading/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/grading/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/grading/${id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    // The record is still there: a re-mark is the only mutable operation.
    expect((await get(`/grading/${id}`, ownerA())).statusCode).toBe(200);
  });

  test('CRUD: get and update of a nonexistent id answer 404', async () => {
    expect((await get('/grading/grd-nope', ownerA())).statusCode).toBe(404);
    expect((await put('/grading/grd-nope', ownerA()).send({ grade: 'A' })).statusCode).toBe(404);
  });

  // --- VALIDATION -----------------------------------------------------------

  test('VALIDATION: malformed input answers 400 and persists nothing', async () => {
    const chain = await setup(ownerA());
    const base = { enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'B' };
    const badBodies = [
      {},
      { ...base, enrollmentId: undefined },
      { ...base, enrollmentId: '' },
      { ...base, enrollmentId: '   ' },
      { ...base, enrollmentId: 12345 },
      { ...base, enrollmentId: 'enr-nope' },
      { ...base, gradingDate: '2026-13-01' },
      { ...base, gradingDate: '2026-02-30' },
      { ...base, gradingDate: '01/10/2026' },
      { ...base, gradingDate: '2026-10-01T09:00:00Z' },
      { ...base, gradingDate: dayOffset(3) },
      { ...base, grade: '' },
      { ...base, grade: 85 },
      { ...base, grade: 'x'.repeat(161) },
      { ...base, notes: 'x'.repeat(161) },
      { ...base, tenantId: 'grd-b' },
      { ...base, id: 'grd-forged' },
      { ...base, score: 90 },
      { ...base, gpa: 3.9 },
      { ...base, sessionId: 'ses-forged' },
      { ...base, payment: 100 }
    ];
    for (const body of badBodies) {
      const res = await create(body, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBeTruthy();
    }
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('VALIDATION: a verbose value is stored verbatim and is not second-guessed', async () => {
    const chain = await setup(ownerA());
    // The repository defines no scale, so a percent, a GPA and a letter are all
    // simply recorded as the institution wrote them.
    for (const value of ['85%', '3.9', 'distinction', 'ممتاز']) {
      const second = await setup(ownerA(), { studentLast: 'S' + value, className: 'C' + value });
      const res = await create({ enrollmentId: second.enrollmentId, gradingDate: TODAY, grade: value }, ownerA());
      expect(res.statusCode).toBe(201);
      expect(res.body.data.grade).toBe(value);
    }
    expect(chain.enrollmentId).toBeTruthy();
    expect((await get('/grading', ownerA())).body.data).toHaveLength(4);
  });

  test('VALIDATION: an unresolvable or foreign enrollment answers 400 identically', async () => {
    const chain = await setup(ownerA());
    const foreign = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });

    const unknown = await awardOverHttp('enr-nope', {}, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/enrollmentId does not reference an Enrollment in this tenant/);

    const foreignRes = await awardOverHttp(foreign.enrollmentId, {}, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    // Existence of another tenant's Enrollment is NOT leaked.
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('VALIDATION: a rejected create leaves no partial row behind', async () => {
    const chain = await setup(ownerA());
    const res = await create({ enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'B', gpa: 4 }, ownerA());
    expect(res.statusCode).toBe(400);
    expect((await get('/grading', ownerA())).body.data).toEqual([]);
    expect(readStore(dir, 'educationGrading')).toBeNull();
  });

  test('VALIDATION: a rejected update leaves the row unchanged', async () => {
    const chain = await setup(ownerA());
    const id = (await awardOverHttp(chain.enrollmentId, { grade: 'B' })).body.data.id;

    expect((await put(`/grading/${id}`, ownerA()).send({ enrollmentId: 'enr-nope' })).statusCode).toBe(400);
    expect((await put(`/grading/${id}`, ownerA()).send({ gradingDate: dayOffset(5) })).statusCode).toBe(400);
    expect((await put(`/grading/${id}`, ownerA()).send({ grade: '' })).statusCode).toBe(400);
    expect((await put(`/grading/${id}`, ownerA()).send({ gradingDate: '' })).statusCode).toBe(400);

    const still = await get(`/grading/${id}`, ownerA());
    expect(still.body.data.grade).toBe('B');
    expect(still.body.data.gradingDate).toBe(TODAY);
    expect((await get('/grading', ownerA())).body.data).toHaveLength(1);
  });

  // --- CONFLICT -------------------------------------------------------------

  test('CONFLICT: a second grade for one enrollment answers 409 with a typed body', async () => {
    const chain = await setup(ownerA());
    expect((await awardOverHttp(chain.enrollmentId, { grade: 'B' })).statusCode).toBe(201);

    const clash = await awardOverHttp(chain.enrollmentId, { grade: 'A' });
    expect(clash.statusCode).toBe(409);
    expect(clash.body.success).toBe(false);
    expect(clash.body.message).toBe('grade already recorded for this enrollment');
    expect(clash.body.details.code).toBe('GRADING_CONFLICT');
    expect(clash.body.details.conflict).toBe(true);
    expect(clash.body.data).toBeUndefined();
    expect((await get('/grading', ownerA())).body.data).toHaveLength(1);
  });

  test('CONFLICT: a re-enrollment is graded independently, and never conflicts', async () => {
    const chain = await setup(ownerA());
    await awardOverHttp(chain.enrollmentId, { grade: 'B' });
    await request(app).patch(`${BASE}/enrollments/${chain.enrollmentId}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);

    const second = await post('/enrollments', ownerA())
      .send({ studentId: chain.studentId, classId: chain.classId });
    expect(second.statusCode).toBe(201);
    const created = await awardOverHttp(second.body.data.id, { grade: 'A' });
    expect(created.statusCode).toBe(201);
    expect((await get('/grading', ownerA())).body.data).toHaveLength(2);
  });

  // --- TENANT ISOLATION -----------------------------------------------------

  test('TENANT: one tenant never sees, fetches or re-marks another tenant row', async () => {
    const inA = await setup(ownerA());
    const inB = await setup(ownerB());
    const idA = (await awardOverHttp(inA.enrollmentId, {}, ownerA())).body.data.id;
    const idB = (await awardOverHttp(inB.enrollmentId, {}, ownerB())).body.data.id;

    expect((await get('/grading', ownerB())).body.data.map(g => g.id)).toEqual([idB]);
    expect((await get('/grading', ownerA())).body.data.map(g => g.id)).toEqual([idA]);

    expect((await get(`/grading/${idA}`, ownerB())).statusCode).toBe(404);
    expect((await get(`/grading/${idB}`, ownerA())).statusCode).toBe(404);
    expect((await put(`/grading/${idA}`, ownerB()).send({ grade: 'ZZZ' })).statusCode).toBe(404);
    expect((await put(`/grading/${idB}`, ownerA()).send({ grade: 'ZZZ' })).statusCode).toBe(404);

    expect((await get(`/grading/${idA}`, ownerA())).body.data.grade).toBe('B');
    expect((await get(`/grading/${idB}`, ownerB())).body.data.grade).toBe('B');
  });

  test('TENANT: a forged tenant in the body, the query or a header is inert', async () => {
    const chain = await setup(ownerA());

    // The header is inert: the trusted tenant still wins.
    const created = await post('/grading', ownerA())
      .set('X-Tenant-Id', 'grd-b')
      .send({ enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'B' });
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('grd-a');

    // A body tenantId is REFUSED outright rather than ignored, so it can never
    // re-parent the row either.
    const forged = await post('/grading', ownerA())
      .send({ enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'A', tenantId: 'grd-b' });
    expect(forged.statusCode).toBe(400);
    expect(forged.body.message).toMatch(/tenantId is not writable/);

    // A forged tenant filter does not widen the result set to another tenant.
    const other = await setup(ownerB());
    await awardOverHttp(other.enrollmentId, {}, ownerB());
    const listed = await get('/grading?tenantId=grd-b&companyId=grd-b', ownerA())
      .set('X-Tenant-Id', 'grd-b');
    expect(listed.statusCode).toBe(200);
    expect(listed.body.data.map(g => g.id)).toEqual([created.body.data.id]);
    expect((await get('/grading', ownerB())).body.data.map(g => g.grade)).toEqual(['B']);
  });

  test('TENANT: an owner with no tenant claim gets 400, an inactive tenant gets an empty list', async () => {
    const chain = await setup(ownerA());
    await awardOverHttp(chain.enrollmentId);

    expect((await get('/grading', token('grdOwner', undefined, 'Owner'))).statusCode).toBe(400);
    expect((await post('/grading', token('grdOwner', undefined, 'Owner'))
      .send({ enrollmentId: chain.enrollmentId, gradingDate: TODAY, grade: 'B' })).statusCode).toBe(400);

    const inactive = await get('/grading', token('grdOwner', 'grd-retired', 'Owner'));
    expect(inactive.statusCode).toBe(200);
    expect(inactive.body.data).toEqual([]);
  });

  // --- THE TIMETABLE OF GRADES ----------------------------------------------

  test('FILTERS: a term reads back in date order with authoritative and derived filters', async () => {
    const chain = await createChainIn(ownerA(), { className: 'TermA' });
    const other = await createChainIn(ownerA(), { className: 'TermB' });
    const mk = async (classId, last, day) => {
      const student = await post('/students', ownerA()).send({ firstName: 'Nadia', lastName: last });
      const enrollment = await post('/enrollments', ownerA())
        .send({ studentId: student.body.data.id, classId });
      const created = await awardOverHttp(enrollment.body.data.id, { gradingDate: day });
      return { studentId: student.body.data.id, id: created.body.data.id, enrollmentId: enrollment.body.data.id };
    };

    const plan = [
      await mk(chain.classId, 'One', dayOffset(-3)),
      await mk(other.classId, 'Two', dayOffset(-1)),
      await mk(chain.classId, 'Three', dayOffset(-2)),
      await mk(chain.classId, 'Four', dayOffset(-1))
    ];

    const all = await get('/grading', ownerA());
    expect(all.body.data).toHaveLength(4);
    expect(all.body.data.map(g => g.gradingDate)).toEqual([
      dayOffset(-3), dayOffset(-2), dayOffset(-1), dayOffset(-1)
    ]);

    const byEnrollment = await get(`/grading?enrollmentId=${plan[0].enrollmentId}`, ownerA());
    expect(byEnrollment.body.data.map(g => g.id)).toEqual([plan[0].id]);

    const byClass = await get(`/grading?classId=${chain.classId}`, ownerA());
    expect(byClass.body.data).toHaveLength(3);
    expect(byClass.body.data.every(g => Object.prototype.hasOwnProperty.call(g, 'classId'))).toBe(false);

    const byStudent = await get(`/grading?studentId=${plan[0].studentId}`, ownerA());
    expect(byStudent.body.data.map(g => g.id)).toEqual([plan[0].id]);

    const byDate = await get(`/grading?dateFrom=${dayOffset(-2)}&dateTo=${dayOffset(-1)}`, ownerA());
    expect(byDate.body.data).toHaveLength(3);

    const byGrade = await get('/grading?grade=B', ownerA());
    expect(byGrade.body.data).toHaveLength(4);
    expect((await get('/grading?grade=ZZZ', ownerA())).body.data).toEqual([]);
  });

  test('FILTERS: an unknown derived filter yields an empty list', async () => {
    const chain = await setup(ownerA());
    await awardOverHttp(chain.enrollmentId);
    const unknownStudent = await get('/grading?studentId=stu-nope', ownerA());
    expect(unknownStudent.statusCode).toBe(200);
    expect(unknownStudent.body.data).toEqual([]);
    expect((await get('/grading?classId=cls-nope', ownerA())).body.data).toEqual([]);
  });

  test('FILTERS: a bad filter value is never silently widened to the whole tenant', async () => {
    const chain = await setup(ownerA());
    await awardOverHttp(chain.enrollmentId);
    // Unlike a status enum, an unmatched grade value simply matches nothing.
    const res = await get('/grading?grade=does-not-exist', ownerA());
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([]);
    expect((await get('/grading?enrollmentId=enr-nope', ownerA())).body.data).toEqual([]);
  });

  test('INDEPENDENCE: a grade coexists with attendance and scheduling, and joins neither', async () => {
    const chain = await setup(ownerA());

    // A scheduled session and an attendance row for the same class and day.
    const session = await post('/scheduling', ownerA()).send({
      classId: chain.classId, scheduledDate: TODAY, startTime: '10:00', endTime: '11:00'
    });
    expect(session.statusCode).toBe(201);
    const attendance = await post('/attendance', ownerA()).send({
      enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present'
    });
    expect(attendance.statusCode).toBe(201);

    const graded = await awardOverHttp(chain.enrollmentId);
    expect(graded.statusCode).toBe(201);
    // No coupling key leaked onto the grade, and the other two records are
    // unchanged in shape.
    expect(Object.keys(graded.body.data)).not.toContain('sessionId');
    expect(Object.keys(attendance.body.data)).not.toContain('sessionId');
    expect(Object.keys(attendance.body.data)).not.toContain('grade');
    expect(Object.keys(session.body.data)).not.toContain('grade');
    expect(attendance.body.data.enrollmentId).toBe(chain.enrollmentId);
    expect(session.body.data.classId).toBe(chain.classId);
  });

  test('INDEPENDENCE: a grade exists with no session and no attendance at all', async () => {
    const chain = await setup(ownerA());
    expect((await awardOverHttp(chain.enrollmentId, { grade: 'A' })).statusCode).toBe(201);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
    expect(readStore(dir, 'educationAttendance')).toBeNull();
    expect((await get('/grading', ownerA())).body.data).toHaveLength(1);
  });
});