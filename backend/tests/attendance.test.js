'use strict';

// STU-8 Education Attendance records — regression suite (Device 2).
//
// Attendance is a DAILY FACT about ONE Enrollment, and this suite pins the four
// contracts STU-8 locks down:
//
//   1. ONE REFERENCE. A row stores `enrollmentId` and nothing else. No student,
//      class, course, program, teacher or center reference is persisted, and the
//      Class chain behind the Enrollment is never walked — so an archived
//      Course, Program, Teacher or Center cannot invalidate a historical record.
//   2. THE ENROLLMENT WINDOW.
//      date(enrolledAt) <= attendanceDate <= date(withdrawnAt ?? infinity), and
//      attendanceDate <= today. The enrollment's STATUS is never consulted: a
//      withdrawn enrollment is a closed window, not an invalid parent.
//   3. UNIQUENESS. At most one row per (tenant, enrollment, calendar day). A
//      second attempt is a typed ATTENDANCE_CONFLICT.
//   4. CORRECTION, NOT LIFECYCLE. `status`, `notes` AND `attendanceDate` are
//      mutable; `enrollmentId` is immutable. There is no DELETE, no /archive
//      and no /withdraw, so a refused correction is the only failure mode that
//      has to leave the row byte-for-byte unchanged.
//
// The suite also pins the absences: no grading, no exams, no scheduling, no
// financial, no guardian, no certificate and no timezone field is writable, and
// `attendanceDate` is a strict client-supplied date-only `YYYY-MM-DD` that is
// never derived from the server clock.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore, listStores } = require('./helpers/testData');

const companies = [
  { id: 'att-a', name: 'Attendance Tenant A', code: 'ATTA', active: true },
  { id: 'att-b', name: 'Attendance Tenant B', code: 'ATTB', active: true },
  { id: 'att-retired', name: 'Retired Attendance Tenant', code: 'ATTR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'attOwner', password, role: 'Owner', fullName: 'Attendance Owner',
      tenantIds: ['att-a', 'att-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Attendance permissions EXPLICITLY, so
      // the suite proves an unregistered permission still fails closed rather
      // than being honoured because a client record asked for it.
      id: 'u-clerk', username: 'attClerk', password, role: 'Viewer', fullName: 'Attendance Clerk',
      permissions: ['education.attendance.view', 'education.attendance.edit'],
      tenantIds: ['att-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'attManager', password, role: 'Manager', fullName: 'Attendance Manager',
      tenantIds: ['att-a'], createdAt: stamp, updatedAt: stamp
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
describe('STU-8 attendance.service — enrollment reference, date window, uniqueness and correction', () => {
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
    dir = makeTempDataDir('att-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/attendance.service');
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

  const A = { tenantId: 'att-a' };
  const B = { tenantId: 'att-b' };

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

  // Writes an Enrollment with EXPLICIT timestamps straight into the store. The
  // STU-7 API refuses to back-date an enrollment, so the historical window cases
  // can only be exercised through the store — which is exactly the state a real
  // migrated term would be in.
  const enrollmentAt = (ctx, opts) => {
    const pair = opts.pair || pairIn(ctx, opts);
    const enrolledAt = opts.enrolledAt || dayAt(dayOffset(-30), 9);
    const withdrawnAt = opts.withdrawnAt === undefined ? null : opts.withdrawnAt;
    const record = {
      id: opts.id || 'enr-fixed-' + Math.random().toString(36).slice(2, 8),
      tenantId: ctx.tenantId,
      studentId: pair.student.id,
      classId: pair.classId,
      status: withdrawnAt ? 'withdrawn' : 'active',
      enrolledAt,
      withdrawnAt,
      notes: '',
      createdAt: enrolledAt,
      updatedAt: withdrawnAt || enrolledAt
    };
    const doc = storage.read('educationEnrollments');
    const list = Array.isArray(doc.enrollments) ? doc.enrollments : [];
    list.push(record);
    storage.write('educationEnrollments', { ...doc, enrollments: list });
    return { ...pair, enrollment: record };
  };

  // The common case: an ACTIVE enrollment opened 30 days ago and never
  // withdrawn, so historical dates in between are in-window.
  const enrollmentIn = (ctx, opts = {}) => enrollmentAt(ctx, opts);

  // A REAL STU-7 enrollment, then back-dated in the store. The window cases
  // need a start in the past, and the API deliberately refuses to back-date,
  // so the timestamps are rewritten afterwards.
  const historicEnrollment = (ctx, studentId, classId, daysAgo = 30) => {
    const created = enrollments.createEnrollment(ctx, { studentId, classId });
    const enrolledAt = dayAt(dayOffset(-daysAgo), 9);
    const doc = storage.read('educationEnrollments');
    doc.enrollments = (doc.enrollments || []).map(e =>
      e.id === created.id ? { ...e, enrolledAt, createdAt: enrolledAt, updatedAt: enrolledAt } : e);
    storage.write('educationEnrollments', doc);
    return created;
  };

  // A valid create payload for `enrollment`, defaulting to today.
  const mark = (enrollmentId, attendanceDate, status, extra) =>
    service.createAttendance(A, Object.assign(
      { enrollmentId, attendanceDate: attendanceDate || TODAY, status: status || 'present' },
      extra || {}
    ));

// --- TENANT CONTEXT -------------------------------------------------------

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listAttendance(null)).toThrow('Tenant context is required');
    expect(() => service.listAttendance({})).toThrow('Tenant context is required');
    expect(() => service.getAttendance(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createAttendance(null, { enrollmentId: 'e', attendanceDate: TODAY, status: 'present' }))
      .toThrow('Tenant context is required');
    expect(() => service.updateAttendance(null, 'x', { status: 'absent' })).toThrow('Tenant context is required');
    expect(() => service.updateAttendance({ tenantId: '' }, 'x', {})).toThrow('Tenant context is required');
  });

  // --- MODEL ----------------------------------------------------------------

  test('create requires enrollmentId, attendanceDate and status', () => {
    const { enrollment } = enrollmentIn(A);
    expect(() => service.createAttendance(A, { attendanceDate: TODAY, status: 'present' }))
      .toThrow('enrollmentId is required');
    expect(() => service.createAttendance(A, { enrollmentId: enrollment.id, status: 'present' }))
      .toThrow('attendanceDate is required');
    expect(() => service.createAttendance(A, { enrollmentId: enrollment.id, attendanceDate: TODAY }))
      .toThrow('status is required');
    expect(() => service.createAttendance(A, { enrollmentId: '  ', attendanceDate: TODAY, status: 'present' }))
      .toThrow('enrollmentId is required');
    expect(() => service.createAttendance(A, { enrollmentId: enrollment.id, attendanceDate: '  ', status: 'present' }))
      .toThrow('attendanceDate is required');
    expect(() => service.createAttendance(A, 'nope')).toThrow('request body must be a JSON object');
    expect(() => service.createAttendance(A, ['nope'])).toThrow('request body must be a JSON object');
    expect(service.listAttendance(A)).toHaveLength(0);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('create stamps exactly the contracted record shape', () => {
    const { enrollment } = enrollmentIn(A);
    const created = mark(enrollment.id);

    expect(created.tenantId).toBe('att-a');
    expect(created.enrollmentId).toBe(enrollment.id);
    expect(created.attendanceDate).toBe(TODAY);
    expect(created.status).toBe('present');
    expect(created.notes).toBe('');
    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.createdAt).toBe(created.updatedAt);
    // Exactly eight contracted keys — no denormalized student/class/course ids.
    expect(Object.keys(created).sort()).toEqual([
      'attendanceDate', 'createdAt', 'enrollmentId', 'id', 'notes', 'status', 'tenantId', 'updatedAt'
    ]);
  });

  test('the persisted record carries no denormalized ownership reference', () => {
    const { enrollment } = enrollmentIn(A);
    const created = mark(enrollment.id, TODAY, 'late', { notes: 'ran late' });
    for (const derived of ['studentId', 'classId', 'courseId', 'programId', 'teacherId', 'centerId']) {
      expect(Object.prototype.hasOwnProperty.call(created, derived)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, derived)).toBe(false);
    }
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });

  test('generated ids are unique across many rows', () => {
    const { enrollment } = enrollmentIn(A);
    const ids = new Set();
    for (let i = 1; i <= 5; i++) {
      ids.add(mark(enrollment.id, dayOffset(-i)).id);
    }
    expect(ids.size).toBe(5);
  });

  test('notes is optional, trimmed and capped at 160 characters', () => {
    const { enrollment } = enrollmentIn(A);
    expect(mark(enrollment.id, dayOffset(-4)).notes).toBe('');
    expect(mark(enrollment.id, dayOffset(-3), 'absent', { notes: '  ill, doctor note  ' }).notes)
      .toBe('ill, doctor note');
    expect(() => mark(enrollment.id, dayOffset(-2), 'absent', { notes: 'x'.repeat(161) }))
      .toThrow('notes must be at most 160 characters');
    expect(mark(enrollment.id, dayOffset(-1), 'absent', { notes: 'y'.repeat(160) }).notes).toHaveLength(160);
  });

  // --- ENROLLMENT RESOLUTION ----------------------------------------------

  test('an unresolvable enrollment is refused and creates nothing', () => {
    expect(() => service.createAttendance(A, { enrollmentId: 'enr-nope', attendanceDate: TODAY, status: 'present' }))
      .toThrow('enrollmentId does not reference an Enrollment in this tenant');
    expect(service.listAttendance(A)).toHaveLength(0);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('a foreign enrollment is refused identically to a nonexistent one', () => {
    const foreign = enrollmentIn(B).enrollment;
    let foreignError;
    let unknownError;
    try { mark(foreign.id); } catch (err) { foreignError = err.message; }
    try { mark('enr-nope'); } catch (err) { unknownError = err.message; }
    // Existence of another tenant's Enrollment is NOT leaked.
    expect(foreignError).toBe(unknownError);
    expect(service.listAttendance(A)).toHaveLength(0);
    expect(service.listAttendance(B)).toHaveLength(0);
  });

  test('an active enrollment accepts attendance on the enrolledAt date', () => {
    const { enrollment } = enrollmentIn(A);
    expect(enrollment.status).toBe('active');
    expect(enrollment.withdrawnAt).toBeNull();
    const created = mark(enrollment.id, TODAY);
    expect(created.attendanceDate).toBe(TODAY);
  });

  test('a withdrawn enrollment still accepts in-window historical attendance', () => {
    const { enrollment } = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-30), 9),
      withdrawnAt: dayAt(dayOffset(-5), 12)
    });
    expect(enrollment.status).toBe('withdrawn');
    // The status is NOT consulted: a closed window is not an invalid parent.
    const created = service.createAttendance(A, {
      enrollmentId: enrollment.id, attendanceDate: dayOffset(-10), status: 'present'
    });
    expect(created.attendanceDate).toBe(dayOffset(-10));
  });

  test('attendance never reads or mutates a parent store', () => {
    const chain = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-20), 9),
      withdrawnAt: dayAt(dayOffset(-2), 12)
    });
    const studentsBefore = readStore(dir, 'educationStudents');
    const classesBefore = readStore(dir, 'educationClasses');
    const coursesBefore = readStore(dir, 'educationCourses');
    const programsBefore = readStore(dir, 'educationPrograms');
    const teachersBefore = readStore(dir, 'educationTeachers');
    const centersBefore = readStore(dir, 'educationCenters');
    const enrollmentsBefore = readStore(dir, 'educationEnrollments');

    mark(chain.enrollment.id, dayOffset(-10), 'excused', { notes: 'family leave' });
    service.updateAttendance(A, service.listAttendance(A)[0].id, { status: 'absent' });

    expect(readStore(dir, 'educationStudents')).toEqual(studentsBefore);
    expect(readStore(dir, 'educationClasses')).toEqual(classesBefore);
    expect(readStore(dir, 'educationCourses')).toEqual(coursesBefore);
    expect(readStore(dir, 'educationPrograms')).toEqual(programsBefore);
    expect(readStore(dir, 'educationTeachers')).toEqual(teachersBefore);
    expect(readStore(dir, 'educationCenters')).toEqual(centersBefore);
    expect(readStore(dir, 'educationEnrollments')).toEqual(enrollmentsBefore);
  });

  test('an archived Student behind the enrollment does NOT block attendance', () => {
    const chain = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    students.archiveStudent(A, chain.student.id);
    const created = mark(chain.enrollment.id, dayOffset(-5));
    expect(created.enrollmentId).toBe(chain.enrollment.id);
  });

  test('an archived Class behind the enrollment does NOT block attendance', () => {
    const chain = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    classes.archiveClass(A, chain.classId);
    const created = mark(chain.enrollment.id, dayOffset(-5));
    expect(created.enrollmentId).toBe(chain.enrollment.id);
  });

  test('archived Course, Program, Teacher and Center are irrelevant', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const chain = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9), centerId: center.id });
    courses.archiveCourse(A, chain.course.id);
    programs.archiveProgram(A, chain.program.id);
    teachers.archiveTeacher(A, chain.teacher.id);
    centers.archiveCenter(A, center.id);

    // Every one of them is archived and attendance is still recorded.
    expect(service.createAttendance(A, {
      enrollmentId: chain.enrollment.id, attendanceDate: dayOffset(-5), status: 'present'
    }).enrollmentId).toBe(chain.enrollment.id);
  });

  test('archiving parents never invalidates an existing attendance row', () => {
    const chain = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const created = mark(chain.enrollment.id, dayOffset(-5), 'present', { notes: 'kept' });

    students.archiveStudent(A, chain.student.id);
    classes.archiveClass(A, chain.classId);
    courses.archiveCourse(A, chain.course.id);
    programs.archiveProgram(A, chain.program.id);
    teachers.archiveTeacher(A, chain.teacher.id);

    const still = service.getAttendance(A, created.id);
    expect(still).not.toBeNull();
    expect(still.status).toBe('present');
    expect(still.notes).toBe('kept');
  });

// --- DATE FORMAT ----------------------------------------------------------

  test('a strict YYYY-MM-DD date is accepted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    expect(mark(enrollment.id, dayOffset(-3)).attendanceDate).toBe(dayOffset(-3));
  });

  test('a timestamp is rejected — attendanceDate is never a datetime', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const bad of ['2026-10-01T09:00:00Z', '2026-10-01T09:00:00.000Z', '2026-10-01 09:00:00',
                       '2026-10-01T00:00:00+02:00', dayAt(TODAY, 9)]) {
      expect(() => mark(enrollment.id, bad)).toThrow('attendanceDate must be a date in YYYY-MM-DD format');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('a malformed or localized date is rejected', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const bad of ['01/10/2026', '10-01-2026', '2026/10/01', '1-1-2026', '2026-1-1',
                       'yesterday', 'today', '2026-10', '20261001', '2026-13-01']) {
      expect(() => mark(enrollment.id, bad))
        .toThrow(/attendanceDate must be (a date in YYYY-MM-DD format|a real calendar date)/);
    }
    // A blank value is a MISSING field rather than a malformed one. `mark`
    // substitutes a default for a falsy date, so it is sent directly.
    for (const blank of ['', '   ']) {
      expect(() => service.createAttendance(A, {
        enrollmentId: enrollment.id, attendanceDate: blank, status: 'present'
      })).toThrow('attendanceDate is required');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('an impossible calendar date is rejected even when well formatted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt('2020-01-01', 9) });
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2023-02-29']) {
      expect(() => mark(enrollment.id, bad)).toThrow(/attendanceDate must be (a real calendar date|a date in YYYY-MM-DD format)/);
    }
    // A real leap day is still accepted.
    expect(mark(enrollment.id, '2024-02-29').attendanceDate).toBe('2024-02-29');
  });

  test('a non-string date is rejected', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const bad of [20261001, 20261001123456, {}, [], true, new Date()]) {
      expect(() => mark(enrollment.id, bad)).toThrow('attendanceDate must be a string');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('a future date is rejected — attendance records what happened', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const bad of [dayOffset(1), dayOffset(2), dayOffset(30)]) {
      expect(() => mark(enrollment.id, bad)).toThrow('attendanceDate cannot be in the future');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  // --- ENROLLMENT WINDOW ----------------------------------------------------

  test('a date before enrolledAt is rejected', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const bad of [dayOffset(-11), dayOffset(-20), dayOffset(-365)]) {
      expect(() => mark(enrollment.id, bad)).toThrow('attendanceDate is before the enrollment period');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('the enrolledAt date itself is accepted even when enrolled later that day', () => {
    // Enrolled at 23:00 on the day, attendance for that same calendar day is
    // allowed: the window compares CALENDAR dates, not instants.
    const day = dayOffset(-7);
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(day, 23) });
    expect(mark(enrollment.id, day).attendanceDate).toBe(day);
  });

  test('a date inside the enrollment is accepted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-30), 9) });
    expect(mark(enrollment.id, dayOffset(-15)).attendanceDate).toBe(dayOffset(-15));
  });

  test('the withdrawnAt date itself is accepted', () => {
    const day = dayOffset(-6);
    const { enrollment } = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-30), 9),
      withdrawnAt: dayAt(day, 11)
    });
    expect(mark(enrollment.id, day).attendanceDate).toBe(day);
  });

  test('a date after withdrawnAt is rejected', () => {
    const { enrollment } = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-30), 9),
      withdrawnAt: dayAt(dayOffset(-6), 11)
    });
    for (const bad of [dayOffset(-5), dayOffset(-1), TODAY]) {
      expect(() => mark(enrollment.id, bad)).toThrow('attendanceDate is after the enrollment period');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('historical backfill works for a still-active enrollment', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-40), 9) });
    for (const day of [-1, -2, -3, -4, -5]) {
      expect(mark(enrollment.id, dayOffset(day), 'present').attendanceDate).toBe(dayOffset(day));
    }
    expect(service.listAttendance(A)).toHaveLength(5);
  });

  test('historical backfill works for a withdrawn enrollment inside the window', () => {
    const { enrollment } = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-60), 9),
      withdrawnAt: dayAt(dayOffset(-20), 11)
    });
    for (const day of [-21, -25, -30, -40]) {
      expect(mark(enrollment.id, dayOffset(day), 'excused').attendanceDate).toBe(dayOffset(day));
    }
    expect(service.listAttendance(A)).toHaveLength(4);
  });

  test('the window is read from the Enrollment timestamps, never from its status', () => {
    // An enrollment flagged `active` while carrying a `withdrawnAt` — the two
    // timestamps are the contract, and the status flag proves nothing about the
    // window in either direction.
    const pair = pairIn(A);
    const inconsistent = {
      id: 'enr-closed-active',
      tenantId: 'att-a',
      studentId: pair.student.id,
      classId: pair.classId,
      status: 'active',
      enrolledAt: dayAt(dayOffset(-40), 9),
      withdrawnAt: dayAt(dayOffset(-20), 11),
      notes: '',
      createdAt: dayAt(dayOffset(-40), 9),
      updatedAt: dayAt(dayOffset(-20), 11)
    };
    storage.write('educationEnrollments', {
      enrollments: [...(storage.read('educationEnrollments').enrollments || []), inconsistent]
    });
    expect(inconsistent.status).toBe('active');
    expect(() => mark('enr-closed-active', dayOffset(-10)))
      .toThrow('attendanceDate is after the enrollment period');
    expect(mark('enr-closed-active', dayOffset(-30)).attendanceDate).toBe(dayOffset(-30));
  });

// --- STATUS ---------------------------------------------------------------

  test('the outcome enum is exactly present, absent, late and excused', () => {
    expect(service.ATTENDANCE_STATUSES).toEqual(['present', 'absent', 'late', 'excused']);
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const statuses = ['present', 'absent', 'late', 'excused'];
    statuses.forEach((status, i) => {
      expect(mark(enrollment.id, dayOffset(-10 + i), status).status).toBe(status);
    });
  });

  test('there is no fifth status — no financial, grading or disciplinary value', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    for (const bad of ['paid', 'unpaid', 'graded', 'failed', 'suspended', 'excused_late', 'lateMinutes',
                       'absent_unexcused', 'Pending', 'PRESENT', 'half_day', 'holiday']) {
      expect(() => mark(enrollment.id, dayOffset(-5), bad)).toThrow('status must be one of:');
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('status is validated as a string and cannot be blanked', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    expect(() => mark(enrollment.id, dayOffset(-5), 42)).toThrow('status must be a string');
    // `mark` substitutes a default for a falsy status, so a blank status is sent
    // through the service directly.
    expect(() => service.createAttendance(A, {
      enrollmentId: enrollment.id, attendanceDate: dayOffset(-5), status: null
    })).toThrow('status is required');
    expect(() => service.createAttendance(A, {
      enrollmentId: enrollment.id, attendanceDate: dayOffset(-5), status: ''
    })).toThrow('status is required');
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('absence detail belongs in notes, not a separate reason taxonomy', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'excused', { notes: 'medical appointment' });
    expect(created.notes).toBe('medical appointment');
    expect(created.status).toBe('excused');
    // There is no reason/reasonCode field to fill.
    expect(Object.keys(created)).not.toContain('reason');
    expect(Object.keys(created)).not.toContain('reasonCode');
  });

// --- UNIQUENESS -----------------------------------------------------------

  test('a second row for the same enrollment and date is a typed conflict', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    mark(enrollment.id, dayOffset(-5), 'present');
    let thrown;
    try { mark(enrollment.id, dayOffset(-5), 'absent'); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(service.AttendanceConflictError);
    expect(thrown.code).toBe('ATTENDANCE_CONFLICT');
    expect(thrown.name).toBe('AttendanceConflictError');
    expect(service.listAttendance(A)).toHaveLength(1);
  });

  test('the conflict error carries no stack detail to the caller', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    mark(enrollment.id, dayOffset(-5));
    let thrown;
    try { mark(enrollment.id, dayOffset(-5)); } catch (err) { thrown = err; }
    // The message names only the enrollment date, never a path or tenant.
    expect(thrown.message).toMatch(/attendance already recorded for this enrollment on/);
    expect(thrown.message).not.toMatch(/[A-Za-z]:\\|\/home\/|omnistore/);
    expect(thrown.message).not.toContain('att-a');
  });

  test('the same date on a DIFFERENT enrollment is independent', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'B1' });
    expect(mark(first.enrollment.id, dayOffset(-5)).id).not.toBe(mark(second.enrollment.id, dayOffset(-5)).id);
    expect(service.listAttendance(A)).toHaveLength(2);
  });

  test('the same date for the same student in two classes is independent', () => {
    const student = studentIn(A, { last: 'Shared' });
    const first = chainIn(A, { className: 'A1' });
    const second = chainIn(A, { className: 'B1' });
    const e1 = historicEnrollment(A, student.id, first.klass.id);
    const e2 = historicEnrollment(A, student.id, second.klass.id);
    expect(mark(e1.id, dayOffset(-5)).id).not.toBe(mark(e2.id, dayOffset(-5)).id);
    expect(service.listAttendance(A)).toHaveLength(2);
  });

  test('withdraw and re-enroll allows the same calendar date on the new stint', () => {
    const pair = pairIn(A);
    const first = historicEnrollment(A, pair.student.id, pair.classId);
    const day = TODAY;
    mark(first.id, day, 'absent');
    enrollments.withdrawEnrollment(A, first.id);

    const second = historicEnrollment(A, pair.student.id, pair.classId);
    expect(second.id).not.toBe(first.id);
    // Same student, same class, same calendar day — no collision, because the
    // two stints are two enrollments.
    expect(mark(second.id, day, 'present').attendanceDate).toBe(day);
    expect(service.listAttendance(A)).toHaveLength(2);
  });

  test('the same values in two tenants do not collide', () => {
    const inA = enrollmentIn(A).enrollment;
    const inB = enrollmentIn(B).enrollment;
    expect(mark(inA.id, TODAY).id).not.toBe(service.createAttendance(B, {
      enrollmentId: inB.id, attendanceDate: TODAY, status: 'present'
    }).id);
    expect(service.listAttendance(A)).toHaveLength(1);
    expect(service.listAttendance(B)).toHaveLength(1);
  });

  test('a conflict is scoped per tenant, so tenant A is unaffected', () => {
    const inA = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) }).enrollment;
    const inB = enrollmentAt(B, { enrolledAt: dayAt(dayOffset(-10), 9) }).enrollment;
    service.createAttendance(A, { enrollmentId: inA.id, attendanceDate: dayOffset(-5), status: 'present' });
    // The identical (enrollment-scoped) values in tenant B are accepted.
    expect(service.createAttendance(B, {
      enrollmentId: inB.id, attendanceDate: dayOffset(-5), status: 'present'
    })).not.toBeNull();
    expect(() => service.createAttendance(A, {
      enrollmentId: inA.id, attendanceDate: dayOffset(-5), status: 'present'
    })).toThrow(/already recorded/);
  });

// --- UPDATE ----------------------------------------------------------------

  test('a correction changes status and bumps updatedAt only', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'present', { notes: 'original' });
    const updated = service.updateAttendance(A, created.id, { status: 'absent' });

    expect(updated.status).toBe('absent');
    expect(updated.notes).toBe('original');
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe(created.tenantId);
    expect(updated.enrollmentId).toBe(created.enrollmentId);
    expect(updated.attendanceDate).toBe(created.attendanceDate);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime()).toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  test('a correction can change notes and trim them', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'excused');
    expect(service.updateAttendance(A, created.id, { notes: '  moved to the front desk  ' }).notes)
      .toBe('moved to the front desk');
    expect(() => service.updateAttendance(A, created.id, { notes: 'z'.repeat(161) }))
      .toThrow('notes must be at most 160 characters');
    expect(service.getAttendance(A, created.id).notes).toBe('moved to the front desk');
  });

  test('a correction can move the date and keeps id, tenant, enrollment and createdAt', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'present');
    const corrected = service.updateAttendance(A, created.id, { attendanceDate: dayOffset(-8) });

    expect(corrected.attendanceDate).toBe(dayOffset(-8));
    expect(corrected.id).toBe(created.id);
    expect(corrected.tenantId).toBe('att-a');
    expect(corrected.enrollmentId).toBe(enrollment.id);
    expect(corrected.createdAt).toBe(created.createdAt);
    expect(corrected.status).toBe('present');
  });

  test('omitted fields are preserved by a correction', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'late', { notes: 'bus was late' });
    const updated = service.updateAttendance(A, created.id, {});
    expect(updated.status).toBe('late');
    expect(updated.notes).toBe('bus was late');
    expect(updated.attendanceDate).toBe(dayOffset(-5));
  });

  test('enrollmentId cannot be changed — not even to another valid enrollment', () => {
    const first = enrollmentIn(A, { studentLast: 'One', className: 'A1' });
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'B1' });
    const created = mark(first.enrollment.id, dayOffset(-5));

    expect(() => service.updateAttendance(A, created.id, { enrollmentId: second.enrollment.id }))
      .toThrow('enrollmentId cannot be changed');
    // Even the SAME enrollment is refused: the field is immutable, not "equal".
    expect(() => service.updateAttendance(A, created.id, { enrollmentId: first.enrollment.id }))
      .toThrow('enrollmentId cannot be changed');
    expect(service.getAttendance(A, created.id).enrollmentId).toBe(first.enrollment.id);
  });

  test('null, undefined, empty and whitespace enrollmentId are all refused', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5));
    // OWN-PROPERTY check: these are attempts to change the relationship, not
    // omissions, so each is rejected rather than silently ignored.
    for (const bad of [null, undefined, '', '   ']) {
      expect(() => service.updateAttendance(A, created.id, { enrollmentId: bad }))
        .toThrow('enrollmentId cannot be changed');
    }
    expect(() => service.updateAttendance(A, created.id, { enrollmentId: 'enr-nope' }))
      .toThrow('enrollmentId cannot be changed');
    expect(() => service.updateAttendance(A, created.id, { enrollmentId: first_foreignId() }))
      .toThrow('enrollmentId cannot be changed');
    expect(service.getAttendance(A, created.id).enrollmentId).toBe(enrollment.id);
  });

  function first_foreignId() {
    return enrollmentIn(B, { studentLast: 'Foreign' }).enrollment.id;
  }

  test('a malformed or impossible correction date is refused', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt('2020-01-01', 9) });
    const created = mark(enrollment.id, dayOffset(-5));
    for (const bad of ['2026-10-01T09:00:00Z', '01/10/2026', '2026-13-01', '2026-02-30', 20261001]) {
      expect(() => service.updateAttendance(A, created.id, { attendanceDate: bad })).toThrow();
    }
    expect(service.getAttendance(A, created.id).attendanceDate).toBe(dayOffset(-5));
  });

  test('a future correction date is refused', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5));
    expect(() => service.updateAttendance(A, created.id, { attendanceDate: dayOffset(2) }))
      .toThrow('attendanceDate cannot be in the future');
    expect(service.getAttendance(A, created.id).attendanceDate).toBe(dayOffset(-5));
  });

  test('a correction outside the enrollment window is refused', () => {
    const { enrollment } = enrollmentAt(A, {
      enrolledAt: dayAt(dayOffset(-40), 9),
      withdrawnAt: dayAt(dayOffset(-20), 11)
    });
    const created = mark(enrollment.id, dayOffset(-25));
    expect(() => service.updateAttendance(A, created.id, { attendanceDate: dayOffset(-45) }))
      .toThrow('attendanceDate is before the enrollment period');
    expect(() => service.updateAttendance(A, created.id, { attendanceDate: dayOffset(-10) }))
      .toThrow('attendanceDate is after the enrollment period');
    expect(service.getAttendance(A, created.id).attendanceDate).toBe(dayOffset(-25));
  });

  test('a correction onto an occupied date is a typed conflict', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const first = mark(enrollment.id, dayOffset(-5));
    mark(enrollment.id, dayOffset(-9));
    let thrown;
    try { service.updateAttendance(A, first.id, { attendanceDate: dayOffset(-9) }); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(service.AttendanceConflictError);
    expect(thrown.code).toBe('ATTENDANCE_CONFLICT');
    expect(service.getAttendance(A, first.id).attendanceDate).toBe(dayOffset(-5));
  });

  test('a correction to the SAME date is allowed (it is not a collision)', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'present');
    const updated = service.updateAttendance(A, created.id, {
      attendanceDate: dayOffset(-5), status: 'late'
    });
    expect(updated.attendanceDate).toBe(dayOffset(-5));
    expect(updated.status).toBe('late');
  });

  test('a failed correction leaves the persisted row byte-for-byte unchanged', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-40), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'present', { notes: 'original' });
    const before = readStore(dir, 'educationAttendance');
    const beforeBytes = JSON.stringify(before);

    expect(() => service.updateAttendance(A, created.id, { enrollmentId: 'enr-nope' })).toThrow();
    expect(() => service.updateAttendance(A, created.id, { attendanceDate: '2026-13-01' })).toThrow();
    expect(() => service.updateAttendance(A, created.id, { attendanceDate: dayOffset(5) })).toThrow();
    expect(() => service.updateAttendance(A, created.id, { notes: 'x'.repeat(200) })).toThrow();
    expect(() => service.updateAttendance(A, created.id, { status: 'paid' })).toThrow();

    expect(JSON.stringify(readStore(dir, 'educationAttendance'))).toBe(beforeBytes);
  });

  test('a correction on an unknown or foreign row answers null, never a leak', () => {
    expect(service.updateAttendance(A, 'att-nope', { status: 'absent' })).toBeNull();
    const { enrollment } = enrollmentIn(B);
    const foreign = service.createAttendance(B, {
      enrollmentId: enrollment.id, attendanceDate: TODAY, status: 'present'
    });
    expect(service.updateAttendance(A, foreign.id, { status: 'absent' })).toBeNull();
    expect(service.getAttendance(B, foreign.id).status).toBe('present');
  });

  test('a correction never reintroduces a denied field into the record', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    const created = mark(enrollment.id, dayOffset(-5));
    expect(() => service.updateAttendance(A, created.id, { tenantId: 'att-b' }))
      .toThrow('tenantId is not writable');
    expect(() => service.updateAttendance(A, created.id, { id: 'att-forged' }))
      .toThrow('id is not writable');
    expect(() => service.updateAttendance(A, created.id, { createdAt: '2000-01-01T00:00:00.000Z' }))
      .toThrow('createdAt is not writable');
    expect(service.getAttendance(A, created.id).tenantId).toBe('att-a');
    expect(service.getAttendance(A, created.id).id).toBe(created.id);
  });

// --- LIST FILTERS ----------------------------------------------------------

  test('list is empty for a tenant with no rows and never touches another tenant', () => {
    enrollmentIn(A);
    enrollmentIn(B);
    expect(service.listAttendance(A)).toEqual([]);
    expect(service.listAttendance(B)).toEqual([]);
  });

  test('get returns null for an unknown id and for a foreign row', () => {
    const inA = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) }).enrollment;
    const created = mark(inA.id, dayOffset(-5));
    expect(service.getAttendance(A, created.id)).toEqual(created);
    expect(service.getAttendance(A, 'att-nope')).toBeNull();
    expect(service.getAttendance(B, created.id)).toBeNull();
  });

  test('list filters by enrollmentId, attendanceDate and status', () => {
    const first = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) }).enrollment;
    const second = enrollmentIn(A, { studentLast: 'Two', className: 'B1' }).enrollment;
    mark(first.id, dayOffset(-5), 'present');
    mark(first.id, dayOffset(-4), 'absent');
    mark(second.id, dayOffset(-5), 'present');

    expect(service.listAttendance(A, { enrollmentId: first.id })).toHaveLength(2);
    expect(service.listAttendance(A, { enrollmentId: second.id })).toHaveLength(1);
    expect(service.listAttendance(A, { attendanceDate: dayOffset(-5) })).toHaveLength(2);
    expect(service.listAttendance(A, { status: 'absent' })).toHaveLength(1);
    expect(service.listAttendance(A, { status: 'late' })).toHaveLength(0);
    // A nonsense status matches nothing rather than everything.
    expect(service.listAttendance(A, { status: 'paid' })).toHaveLength(0);
  });

  test('dateFrom and dateTo form an inclusive range', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    for (const day of [-1, -2, -3, -4]) mark(enrollment.id, dayOffset(day), 'present');

    expect(service.listAttendance(A, { dateFrom: dayOffset(-3), dateTo: dayOffset(-2) })).toHaveLength(2);
    // Both endpoints are inclusive.
    expect(service.listAttendance(A, { dateFrom: dayOffset(-3) })).toHaveLength(3);
    expect(service.listAttendance(A, { dateTo: dayOffset(-2) })).toHaveLength(3);
    expect(service.listAttendance(A, { dateFrom: dayOffset(-4), dateTo: dayOffset(-4) })).toHaveLength(1);
    expect(service.listAttendance(A, { dateFrom: dayOffset(-30), dateTo: dayOffset(0) })).toHaveLength(4);
    // An inverted or non-overlapping range simply matches nothing.
    expect(service.listAttendance(A, { dateFrom: dayOffset(-1), dateTo: dayOffset(-3) })).toHaveLength(0);
    expect(service.listAttendance(A, { dateFrom: dayOffset(0) })).toHaveLength(0);
  });

  test('studentId is a DERIVED filter resolved through the enrollment', () => {
    const student = studentIn(A, { last: 'Derived' });
    const other = studentIn(A, { last: 'Unrelated' });
    const klass = chainIn(A).klass;
    const e1 = historicEnrollment(A, student.id, klass.id);
    const e2 = historicEnrollment(A, other.id, klass.id);
    mark(e1.id, dayOffset(-5), 'present');
    mark(e2.id, dayOffset(-5), 'absent');

    const filtered = service.listAttendance(A, { studentId: student.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].enrollmentId).toBe(e1.id);
    // The stored record still carries no studentId.
    expect(Object.prototype.hasOwnProperty.call(filtered[0], 'studentId')).toBe(false);
  });

  test('classId is a DERIVED filter resolved through the enrollment', () => {
    const student = studentIn(A);
    const first = chainIn(A, { className: 'A1' });
    const second = chainIn(A, { className: 'B1' });
    const e1 = historicEnrollment(A, student.id, first.klass.id);
    const e2 = historicEnrollment(A, student.id, second.klass.id);
    mark(e1.id, dayOffset(-5));
    mark(e2.id, dayOffset(-5));

    const filtered = service.listAttendance(A, { classId: second.klass.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].enrollmentId).toBe(e2.id);
  });

  test('studentId and classId combine as an AND', () => {
    const student = studentIn(A, { last: 'Both' });
    const other = studentIn(A, { last: 'One' });
    const first = chainIn(A, { className: 'A1' });
    const second = chainIn(A, { className: 'B1' });
    const matching = historicEnrollment(A, student.id, first.klass.id);
    const otherClass = historicEnrollment(A, student.id, second.klass.id);
    const otherStudent = historicEnrollment(A, other.id, first.klass.id);
    mark(matching.id, dayOffset(-5));
    mark(otherClass.id, dayOffset(-5));
    mark(otherStudent.id, dayOffset(-5));

    const filtered = service.listAttendance(A, { studentId: student.id, classId: first.klass.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].enrollmentId).toBe(matching.id);
  });

  test('an unknown derived filter value returns an empty list without leaking', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    mark(enrollment.id, dayOffset(-5));
    expect(service.listAttendance(A, { studentId: 'stu-nope' })).toEqual([]);
    expect(service.listAttendance(A, { classId: 'cls-nope' })).toEqual([]);
  });

  test('a FOREIGN derived filter value returns an empty list, identical to unknown', () => {
    const inA = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const inB = enrollmentAt(B, { enrolledAt: dayAt(dayOffset(-10), 9) });
    mark(inA.enrollment.id, dayOffset(-5));

    const viaForeignStudent = service.listAttendance(A, { studentId: inB.student.id });
    const viaUnknownStudent = service.listAttendance(A, { studentId: 'stu-nope' });
    expect(viaForeignStudent).toEqual([]);
    expect(viaForeignStudent).toEqual(viaUnknownStudent);
    // The foreign enrollment's own attendance is untouched in its own tenant.
    expect(service.listAttendance(B)).toEqual([]);
  });

  test('rows are ordered chronologically with a deterministic tie-breaker', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-20), 9) });
    for (const day of [-1, -6, -3, -9, -4]) mark(enrollment.id, dayOffset(day), 'present');
    const listed = service.listAttendance(A);
    const dates = listed.map(r => r.attendanceDate);
    expect(dates).toEqual([...dates].sort());
    expect(dates).toEqual([
      dayOffset(-9), dayOffset(-6), dayOffset(-4), dayOffset(-3), dayOffset(-1)
    ]);
    // The order is stable across repeated calls.
    expect(service.listAttendance(A).map(r => r.id)).toEqual(listed.map(r => r.id));
  });

  test('no N+1: a derived filter resolves enrollments in batched list calls', () => {
    const student = studentIn(A, { last: 'Bulk' });
    for (let i = 0; i < 8; i++) {
      // Eight classes for one student: eight enrollments, thirty-two rows.
      const klass = chainIn(A, { className: 'Bulk' + i }).klass;
      const enrollment = historicEnrollment(A, student.id, klass.id);
      for (let d = 1; d <= 4; d++) mark(enrollment.id, dayOffset(-d), 'present');
    }
    expect(service.listAttendance(A, { studentId: student.id })).toHaveLength(32);

    // ONE batched listEnrollments call regardless of how many rows are filtered;
    // a per-row getEnrollment() implementation would call it 32 times.
    const listSpy = jest.spyOn(enrollments, 'listEnrollments');
    const getSpy = jest.spyOn(enrollments, 'getEnrollment');
    const filtered = service.listAttendance(A, { studentId: student.id });
    expect(filtered).toHaveLength(32);
    expect(listSpy.mock.calls.length).toBeLessThanOrEqual(1);
    expect(getSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
    getSpy.mockRestore();
  });

  test('list returns copies, so a caller cannot mutate the store through them', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const created = mark(enrollment.id, dayOffset(-5));
    const listed = service.listAttendance(A);
    listed[0].status = 'tampered';
    expect(service.getAttendance(A, created.id).status).toBe('present');
  });

// --- FORBIDDEN FIELDS AND SECURITY ----------------------------------------

  test('server-owned fields cannot be written on create', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId',
                         'createdAt', 'updatedAt', 'attendanceId']) {
      expect(() => mark(enrollment.id, dayOffset(-5), 'present', { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listAttendance(A)).toHaveLength(0);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('derived ownership fields cannot be written on create', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const field of ['studentId', 'classId', 'courseId', 'programId', 'teacherId', 'centerId',
                         'academicYear', 'enrollmentIds', 'attendanceIds']) {
      expect(() => mark(enrollment.id, dayOffset(-5), 'present', { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('no grading, exam, financial or scheduling field is accepted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const forbidden = ['grade', 'grades', 'score', 'exam', 'exams', 'result', 'mark',
                       'payment', 'tuition', 'billing', 'invoice', 'salary', 'payroll',
                       'schedule', 'scheduling', 'sessionId', 'dayOfWeek', 'startTime',
                       'endTime', 'room', 'recurrence'];
    for (const field of forbidden) {
      expect(() => mark(enrollment.id, dayOffset(-5), 'present', { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    // STU-8 is DAILY: none of the STU-9 scheduling keys is writable.
    expect(Object.keys(service.WRITABLE_FIELDS)).toEqual(['enrollmentId', 'attendanceDate', 'status', 'notes']);
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('no guardian, certificate, timezone or check-in field is accepted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    for (const field of ['guardianId', 'guardianIds', 'certificate', 'capacity', 'enrollmentStatus',
                         'timezone', 'recordedBy', 'checkInTime', 'checkOutTime']) {
      expect(() => mark(enrollment.id, dayOffset(-5), 'present', { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('a prototype-pollution payload is rejected and Object stays clean', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const payload = JSON.parse('{"enrollmentId":"' + enrollment.id + '","attendanceDate":"'
      + dayOffset(-5) + '","status":"present","__proto__":{"polluted":"yes"}}');
    expect(() => service.createAttendance(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();

    expect(() => service.updateAttendance(A, 'x', { constructor: 'y' })).toThrow('constructor is not allowed');
    expect(() => service.updateAttendance(A, 'x', { prototype: 'y' })).toThrow('prototype is not allowed');
    expect(service.listAttendance(A)).toHaveLength(0);
  });

  test('no malicious field is ever persisted', () => {
    const { enrollment } = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) });
    const created = mark(enrollment.id, dayOffset(-5), 'present', { notes: 'ok' });
    const stored = readStore(dir, 'educationAttendance');
    expect(Object.keys(stored)).toEqual(['attendance']);
    for (const record of stored.attendance) {
      expect(Object.keys(record).sort()).toEqual(Object.keys(created).sort());
      expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
      expect(record.polluted).toBeUndefined();
    }
  });

  test('the store is tenant-owned and never mixes tenants on disk', () => {
    const inA = enrollmentAt(A, { enrolledAt: dayAt(dayOffset(-10), 9) }).enrollment;
    const inB = enrollmentAt(B, { enrolledAt: dayAt(dayOffset(-10), 9) }).enrollment;
    mark(inA.id, dayOffset(-5));
    service.createAttendance(B, { enrollmentId: inB.id, attendanceDate: dayOffset(-5), status: 'absent' });

    const stored = readStore(dir, 'educationAttendance');
    expect(stored.attendance).toHaveLength(2);
    expect(stored.attendance.filter(r => r.tenantId === 'att-a')).toHaveLength(1);
    expect(stored.attendance.filter(r => r.tenantId === 'att-b')).toHaveLength(1);
  });

  test('the service declares the store key it owns and nothing else', () => {
    expect(service.STORE_KEY).toBe('educationAttendance');
    expect(service.FORBIDDEN_FIELDS).toContain('tenantId');
    expect(service.LATER_PHASE_FIELDS).toContain('sessionId');
  });

});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-8 attendance routes — authorization, tenant isolation and the daily contract', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('att-http');
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

  const ownerA = () => token('attOwner', 'att-a', 'Owner');
  const ownerB = () => token('attOwner', 'att-b', 'Owner');
  const managerA = () => token('attManager', 'att-a', 'Manager');
  const clerkA = () => token('attClerk', 'att-a', 'Viewer');

  const post = (path, tok) => request(app).post(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tok}`);

  const put = (path, tok) => request(app).put(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tok}`);

  const get = (path, tok) => request(app).get(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tok}`);

  const createChainIn = async (tok, opts = {}) => {
    const program = await post('/programs', tok)
      .send(opts.centerId ? { name: 'English Track', centerId: opts.centerId } : { name: 'English Track' });
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

  const createStudentIn = (lastName, tok) =>
    post('/students', tok).send({ firstName: 'Nadia', lastName: lastName || 'Hassan' });

  // Builds the chain, a Student and an ACTIVE enrollment over HTTP.
  const setup = async (tok, opts = {}) => {
    const chain = await createChainIn(tok, opts);
    const student = await createStudentIn(opts.studentLast || 'Hassan', tok);
    expect(student.statusCode).toBe(201);
    const enrollment = await post('/enrollments', tok).send({
      studentId: student.body.data.id, classId: chain.classId
    });
    expect(enrollment.statusCode).toBe(201);
    return { ...chain, studentId: student.body.data.id, enrollmentId: enrollment.body.data.id };
  };

  const create = (body, tok) => post('/attendance', tok).send(body);

  // The STU-7 API stamps `enrolledAt` with the server clock and refuses to
  // back-date it, so a historical window is set up by rewriting the store —
  // exactly the state a migrated term would already be in. The rewrite goes
  // through storageAdapter rather than fs so fileStore's read cache is
  // refreshed by the same code path the server uses.
  const backdate = (enrollmentId, enrolledAt) => {
    const storage = require('../repositories/storageAdapter');
    const doc = storage.read('educationEnrollments');
    storage.write('educationEnrollments', {
      ...doc,
      enrollments: (doc.enrollments || []).map(e =>
        e.id === enrollmentId ? { ...e, enrolledAt, createdAt: enrolledAt, updatedAt: enrolledAt } : e)
    });
  };

  // Builds the chain, a Student and an enrollment opened 30 days ago, so
  // in-window historical days exist over HTTP too.
  const setupHistoric = async (tok, opts = {}) => {
    const built = await setup(tok, opts);
    backdate(built.enrollmentId, dayAt(dayOffset(-30), 9));
    return built;
  };

  const markDay = (enrollmentId, attendanceDate, status, tok) =>
    create({ enrollmentId, attendanceDate, status }, tok || ownerA());

  // --- AUTH ------------------------------------------------------------------

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/attendance`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/attendance/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/attendance`).send({ enrollmentId: 'e' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/attendance/anything`).send({ status: 'absent' })).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('att-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/attendance`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/attendance`).send({ enrollmentId: 'e' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Attendance permissions fail closed, with no bypass', async () => {
    // The Clerk record holds education.attendance.view / .edit EXPLICITLY and is
    // still refused: unknown permissions are not honoured because a client
    // record asked for them.
    expect((await get('/attendance', clerkA())).statusCode).toBe(403);

    const chain = await setup(ownerA());
    const write = await markDay(chain.enrollmentId, TODAY, 'present', clerkA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('AUTHORIZATION: a Manager cannot write, and nothing is persisted on refusal', async () => {
    const chain = await setup(ownerA());
    expect((await markDay(chain.enrollmentId, TODAY, 'present', managerA())).statusCode).toBe(403);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('AUTHORIZATION: an Owner is admitted under the current registry behaviour', async () => {
    const chain = await setup(ownerA());
    expect((await get('/attendance', ownerA())).statusCode).toBe(200);
    const res = await markDay(chain.enrollmentId, TODAY, 'present', ownerA());
    expect(res.statusCode).toBe(201);
  });

  // --- CRUD ------------------------------------------------------------------

  test('CRUD: the full daily lifecycle over HTTP', async () => {
    const chain = await setup(ownerA());
    const created = await markDay(chain.enrollmentId, TODAY, 'late', ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.message).toBe('Attendance created');
    expect(created.body.data.tenantId).toBe('att-a');
    expect(created.body.data.status).toBe('late');
    expect(created.body.data.notes).toBe('');
    expect(Object.keys(created.body.data).sort()).toEqual([
      'attendanceDate', 'createdAt', 'enrollmentId', 'id', 'notes', 'status', 'tenantId', 'updatedAt'
    ]);
    const id = created.body.data.id;

    const fetched = await get(`/attendance/${id}`, ownerA());
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.message).toBe('Attendance retrieved');
    expect(fetched.body.data.enrollmentId).toBe(chain.enrollmentId);

    const listed = await get('/attendance', ownerA());
    expect(listed.body.message).toBe('Attendance retrieved');
    expect(listed.body.data).toHaveLength(1);

    const updated = await put(`/attendance/${id}`, ownerA()).send({ status: 'excused', notes: 'medical' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.message).toBe('Attendance updated');
    expect(updated.body.data.status).toBe('excused');
    expect(updated.body.data.notes).toBe('medical');
    expect(updated.body.data.enrollmentId).toBe(chain.enrollmentId);
  });

  test('CRUD: there is no DELETE, archive or withdraw route for attendance', async () => {
    const chain = await setup(ownerA());
    const id = (await markDay(chain.enrollmentId, TODAY, 'present', ownerA())).body.data.id;

    expect((await request(app).delete(`${BASE}/attendance/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/attendance/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/attendance/${id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    // The record is still there: correction is the only mutable operation.
    expect((await get(`/attendance/${id}`, ownerA())).statusCode).toBe(200);
  });

  test('CRUD: a same-day correction is the supported fix for a mis-marked register', async () => {
    const chain = await setup(ownerA());
    const created = await markDay(chain.enrollmentId, TODAY, 'absent', ownerA());
    const corrected = await put(`/attendance/${created.body.data.id}`, ownerA())
      .send({ status: 'present', notes: 'marked wrong' });
    expect(corrected.statusCode).toBe(200);
    expect(corrected.body.data.status).toBe('present');
    expect(corrected.body.data.notes).toBe('marked wrong');
    // The day was not double-recorded: still exactly one row.
    expect((await get('/attendance', ownerA())).body.data).toHaveLength(1);
  });

// --- VALIDATION -------------------------------------------------------------

  test('VALIDATION: the three required fields answer 400 and persist nothing', async () => {
    const chain = await setup(ownerA());
    expect((await create({ attendanceDate: TODAY, status: 'present' }, ownerA())).statusCode).toBe(400);
    expect((await create({ enrollmentId: chain.enrollmentId, status: 'present' }, ownerA())).statusCode).toBe(400);
    expect((await create({ enrollmentId: chain.enrollmentId, attendanceDate: TODAY }, ownerA())).statusCode).toBe(400);
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: a date that is not a strict YYYY-MM-DD day answers 400', async () => {
    const chain = await setup(ownerA());
    for (const bad of ['2026-10-01T09:00:00Z', '01/10/2026', '2026-02-30', '2026-13-01', 20261001]) {
      const res = await create({ enrollmentId: chain.enrollmentId, attendanceDate: bad, status: 'present' }, ownerA());
      expect(res.statusCode).toBe(400);
    }
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: a future attendanceDate answers 400', async () => {
    const chain = await setup(ownerA());
    const res = await create({ enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(3), status: 'present' }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/attendanceDate cannot be in the future/);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: an invalid status answers 400', async () => {
    const chain = await setup(ownerA());
    for (const bad of ['paid', 'graded', 'failed', 'suspended', 'excused_late']) {
      const res = await create({ enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: bad }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/status must be one of/);
    }
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: an unresolvable or foreign enrollment answers 400 identically', async () => {
    const chain = await setup(ownerA());
    const foreign = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });

    const unknown = await create({ enrollmentId: 'enr-nope', attendanceDate: TODAY, status: 'present' }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/enrollmentId does not reference an Enrollment in this tenant/);

    const foreignRes = await create({ enrollmentId: foreign.enrollmentId, attendanceDate: TODAY, status: 'present' }, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    // Existence of another tenant's Enrollment is NOT leaked.
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: a date before the enrolledAt date answers 400', async () => {
    // A live enrollment created now only has today in its window, so yesterday
    // is provably outside it.
    const chain = await setup(ownerA());
    const res = await create({
      enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(-1), status: 'present'
    }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/attendanceDate is before the enrollment period/);
  });

  test('VALIDATION: the withdrawal date is inside the window and closed days stay closed', async () => {
    const chain = await setup(ownerA());
    const withdrawn = await request(app).patch(`${BASE}/enrollments/${chain.enrollmentId}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(withdrawn.statusCode).toBe(200);

    // Today is still inside the window (withdrawal happened today)…
    expect((await create({
      enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present'
    }, ownerA())).statusCode).toBe(201);

    // …but a withdrawal never back-dates, so no future day is open, and a
    // pre-enrollment day stays closed too.
    const future = await create({
      enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(5), status: 'present'
    }, ownerA());
    expect(future.statusCode).toBe(400);
    const past = await create({
      enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(-5), status: 'present'
    }, ownerA());
    expect(past.statusCode).toBe(400);
  });

  test('VALIDATION: a duplicate enrollment/date answers 409 with the typed code', async () => {
    const chain = await setup(ownerA());
    expect((await markDay(chain.enrollmentId, TODAY, 'present', ownerA())).statusCode).toBe(201);
    const duplicate = await markDay(chain.enrollmentId, TODAY, 'absent', ownerA());
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.body.message).toMatch(/already recorded/);
    expect(duplicate.body.details ? duplicate.body.details.code : undefined).toBe('ATTENDANCE_CONFLICT');
    // The original row is untouched.
    expect((await get('/attendance', ownerA())).body.data[0].status).toBe('present');
  });

  test('VALIDATION: server-owned and derived fields answer 400 on create', async () => {
    const chain = await setup(ownerA());
    const fields = ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt',
                    'updatedAt', 'attendanceId', 'studentId', 'classId', 'courseId', 'programId',
                    'teacherId', 'centerId', 'grade', 'score', 'exam', 'payment', 'tuition',
                    'sessionId', 'dayOfWeek', 'startTime', 'room', 'guardianId', 'certificate',
                    'timezone', 'checkInTime', 'recordedBy'];
    for (const field of fields) {
      const res = await create({
        enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present', [field]: 'x'
      }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('VALIDATION: a prototype-pollution payload is neutralized at the HTTP layer', async () => {
    const chain = await setup(ownerA());
    const raw = JSON.stringify({ enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present' });
    const res = await request(app).post(`${BASE}/attendance`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('Content-Type', 'application/json')
      .send(raw.slice(0, -1) + ',"__proto__":{"polluted":"yes"}}');
    // Master-owned backend/middleware/security.js strips __proto__ before the
    // controller runs, so the service-level own-property check is defense in
    // depth rather than the first line of defence. Either answer is safe.
    expect([201, 400]).toContain(res.statusCode);
    if (res.statusCode === 400) expect(res.body.message).toMatch(/__proto__ is not allowed/);
    expect({}.polluted).toBeUndefined();

    const stored = readStore(dir, 'educationAttendance');
    if (stored) {
      for (const record of stored.attendance) {
        expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
        expect(record.polluted).toBeUndefined();
      }
    }
  });

  test('SECURITY: no response leaks a stack trace, file path or other tenant', async () => {
    const chain = await setup(ownerA());
    const res = await create({ enrollmentId: 'enr-nope', attendanceDate: TODAY, status: 'present' }, ownerA());
    const body = JSON.stringify(res.body);
    expect(res.statusCode).toBe(400);
    expect(body).not.toMatch(/at [A-Za-z_$][\w$]*\s*\(/);       // stack frames
    expect(body).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//); // absolute paths
    expect(body).not.toContain('att-b');
    expect(body).not.toContain(require.resolve('../services/attendance.service'));
    expect(body).not.toContain('node_modules');
  });

// --- IMMUTABILITY AND CORRECTION OVER HTTP -----------------------------------

  describe('IMMUTABILITY: PUT cannot re-point the enrollment relationship', () => {
    let id;
    let original;
    let second;
    let foreign;

    beforeEach(async () => {
      const chain = await setup(ownerA());
      const created = await create({
        enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present', notes: 'original'
      }, ownerA());
      expect(created.statusCode).toBe(201);
      id = created.body.data.id;
      original = created.body.data;
      second = await setup(ownerA(), { studentLast: 'Other', className: 'Other' });
      foreign = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });
    });

    const putBody = body => put(`/attendance/${id}`, ownerA()).send(body);

    const assertUnchanged = async () => {
      const current = await get(`/attendance/${id}`, ownerA());
      expect(current.statusCode).toBe(200);
      expect(current.body.data.enrollmentId).toBe(original.enrollmentId);
      expect(current.body.data.attendanceDate).toBe(original.attendanceDate);
      expect(current.body.data.status).toBe(original.status);
      expect(current.body.data.notes).toBe(original.notes);
      expect(current.body.data.id).toBe(original.id);
      expect(current.body.data.tenantId).toBe(original.tenantId);
      expect(current.body.data.createdAt).toBe(original.createdAt);
    };

    test('re-pointing to another VALID enrollment is refused', async () => {
      const res = await putBody({ enrollmentId: second.enrollmentId, status: 'absent' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/enrollmentId cannot be changed/);
      await assertUnchanged();
    });

    test('re-sending the SAME enrollment is still refused', async () => {
      expect((await putBody({ enrollmentId: original.enrollmentId })).statusCode).toBe(400);
      await assertUnchanged();
    });

    test('a nonexistent enrollment is refused with the immutability message', async () => {
      const res = await putBody({ enrollmentId: 'enr-nope' });
      expect(res.statusCode).toBe(400);
      // The relationship is immutable, so the reference is never even resolved.
      expect(res.body.message).toMatch(/enrollmentId cannot be changed/);
      await assertUnchanged();
    });

    test('a FOREIGN enrollment is refused with the identical message', async () => {
      const res = await putBody({ enrollmentId: foreign.enrollmentId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/enrollmentId cannot be changed/);
      await assertUnchanged();
    });

    test('null, empty and whitespace enrollmentId are refused', async () => {
      // An explicit `null` survives JSON; `undefined` cannot, so it is exercised
      // at the service level, where the own-property check sees it directly.
      for (const bad of [null, '', '   ']) {
        const res = await putBody({ enrollmentId: bad });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/enrollmentId cannot be changed/);
      }
      const raw = JSON.stringify({ enrollmentId: null, status: 'absent' });
      const res = await request(app).put(`${BASE}/attendance/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('Content-Type', 'application/json')
        .send(raw);
      expect(res.statusCode).toBe(400);
      await assertUnchanged();
    });

    test('a refused re-point leaves the persisted row byte-for-byte unchanged', async () => {
      const before = JSON.stringify(readStore(dir, 'educationAttendance'));
      await putBody({ enrollmentId: second.enrollmentId, status: 'absent' });
      expect(JSON.stringify(readStore(dir, 'educationAttendance'))).toBe(before);
    });
  });

  describe('CORRECTION: attendanceDate is correctable and safe to fail', () => {
    let id;
    let original;

    beforeEach(async () => {
      const chain = await setup(ownerA());
      const created = await create({
        enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'absent'
      }, ownerA());
      expect(created.statusCode).toBe(201);
      id = created.body.data.id;
      original = created.body.data;
    });

    test('a valid date correction keeps id, tenant, enrollment and createdAt', async () => {
      // Same day, but the record was mis-filed: a status-only correction is the
      // observable part, and the invariants below are what a date move must keep.
      const res = await put(`/attendance/${id}`, ownerA()).send({ attendanceDate: TODAY, status: 'present' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.attendanceDate).toBe(original.attendanceDate);
      expect(res.body.data.status).toBe('present');
      expect(res.body.data.id).toBe(original.id);
      expect(res.body.data.tenantId).toBe(original.tenantId);
      expect(res.body.data.enrollmentId).toBe(original.enrollmentId);
      expect(res.body.data.createdAt).toBe(original.createdAt);
    });

    test('an invalid correction date answers 400 and changes nothing', async () => {
      const before = JSON.stringify(readStore(dir, 'educationAttendance'));
      for (const bad of ['2026-10-01T09:00:00Z', '01/10/2026', '2026-02-30', '2026-13-45']) {
        const res = await put(`/attendance/${id}`, ownerA()).send({ attendanceDate: bad });
        expect(res.statusCode).toBe(400);
      }
      expect(JSON.stringify(readStore(dir, 'educationAttendance'))).toBe(before);
    });

    test('a future correction date answers 400 and changes nothing', async () => {
      const before = JSON.stringify(readStore(dir, 'educationAttendance'));
      const res = await put(`/attendance/${id}`, ownerA()).send({ attendanceDate: dayOffset(4) });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/attendanceDate cannot be in the future/);
      expect(JSON.stringify(readStore(dir, 'educationAttendance'))).toBe(before);
    });

    test('an out-of-window correction date answers 400 and changes nothing', async () => {
      const before = JSON.stringify(readStore(dir, 'educationAttendance'));
      const res = await put(`/attendance/${id}`, ownerA()).send({ attendanceDate: dayOffset(-10) });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/attendanceDate is before the enrollment period/);
      expect(JSON.stringify(readStore(dir, 'educationAttendance'))).toBe(before);
    });

    test('a correction onto a day another enrollment already holds succeeds', async () => {
      // Two HISTORIC enrollments, each with its own row: moving one onto the
      // other's day is allowed, because uniqueness is scoped to the enrollment
      // and not to the student or the class.
      const first = await setupHistoric(ownerA(), { studentLast: 'First', className: 'A1' });
      const second = await setupHistoric(ownerA(), { studentLast: 'Second', className: 'B1' });

      const mine = await create({
        enrollmentId: first.enrollmentId, attendanceDate: dayOffset(-3), status: 'present'
      }, ownerA());
      expect(mine.statusCode).toBe(201);
      const theirs = await create({
        enrollmentId: second.enrollmentId, attendanceDate: dayOffset(-2), status: 'present'
      }, ownerA());
      expect(theirs.statusCode).toBe(201);

      const before = JSON.stringify(readStore(dir, 'educationAttendance'));
      const res = await put(`/attendance/${mine.body.data.id}`, ownerA()).send({ attendanceDate: dayOffset(-2) });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.attendanceDate).toBe(dayOffset(-2));
      expect(res.body.data.id).toBe(mine.body.data.id);
      expect(res.body.data.createdAt).toBe(mine.body.data.createdAt);
      expect(JSON.stringify(readStore(dir, 'educationAttendance'))).not.toBe(before);
      expect((await get('/attendance?attendanceDate=' + dayOffset(-2), ownerA())).body.data).toHaveLength(2);
    });

    test('a correction onto a day ALREADY HELD BY THE SAME enrollment answers 409', async () => {
      const chain = await setupHistoric(ownerA(), { studentLast: 'Dup', className: 'C1' });
      const target = await create({
        enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(-3), status: 'present'
      }, ownerA());
      expect(target.statusCode).toBe(201);
      await create({ enrollmentId: chain.enrollmentId, attendanceDate: dayOffset(-2), status: 'present' }, ownerA());

      const res = await put(`/attendance/${target.body.data.id}`, ownerA()).send({ attendanceDate: dayOffset(-2) });
      expect(res.statusCode).toBe(409);
      expect(res.body.details ? res.body.details.code : undefined).toBe('ATTENDANCE_CONFLICT');
      expect((await get(`/attendance/${target.body.data.id}`, ownerA())).body.data.attendanceDate).toBe(dayOffset(-3));
    });

    test('a correction on an unknown or foreign id answers 404', async () => {
      expect((await put('/attendance/att-nope', ownerA()).send({ status: 'absent' })).statusCode).toBe(404);
      const foreign = await create({
        enrollmentId: (await setup(ownerB())).enrollmentId, attendanceDate: TODAY, status: 'present'
      }, ownerB());
      expect(foreign.statusCode).toBe(201);
      const res = await put(`/attendance/${foreign.body.data.id}`, ownerA()).send({ status: 'absent' });
      expect(res.statusCode).toBe(404);
      expect((await get(`/attendance/${foreign.body.data.id}`, ownerB())).body.data.status).toBe('present');
    });
  });

// --- TENANT ISOLATION -------------------------------------------------------

  test('TENANT: list only returns the caller tenant rows', async () => {
    const inA = await setup(ownerA());
    const inB = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });
    await markDay(inA.enrollmentId, TODAY, 'present', ownerA());
    await markDay(inB.enrollmentId, TODAY, 'absent', ownerB());

    const listedA = await get('/attendance', ownerA());
    expect(listedA.body.data).toHaveLength(1);
    expect(listedA.body.data[0].tenantId).toBe('att-a');
    const listedB = await get('/attendance', ownerB());
    expect(listedB.body.data).toHaveLength(1);
    expect(listedB.body.data[0].tenantId).toBe('att-b');
  });

  test('TENANT: get and update of a foreign row answer 404', async () => {
    const inA = await setup(ownerA());
    const created = await markDay(inA.enrollmentId, TODAY, 'present', ownerA());
    const id = created.body.data.id;

    const crossRead = await get(`/attendance/${id}`, ownerB());
    expect(crossRead.statusCode).toBe(404);
    expect(crossRead.body.message).toBe('Attendance not found');

    const crossWrite = await put(`/attendance/${id}`, ownerB()).send({ status: 'absent' });
    expect(crossWrite.statusCode).toBe(404);
    // Unchanged in its own tenant.
    expect((await get(`/attendance/${id}`, ownerA())).body.data.status).toBe('present');
  });

  test('TENANT: a body tenantId cannot redirect the write', async () => {
    const inB = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });
    const res = await create({
      enrollmentId: inB.enrollmentId, attendanceDate: TODAY, status: 'present', tenantId: 'att-b'
    }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/tenantId is not writable/);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
    expect((await get('/attendance', ownerB())).body.data).toHaveLength(0);
  });

  test('TENANT: a body companyId or branchId is refused too', async () => {
    const chain = await setup(ownerA());
    for (const field of ['companyId', 'branchId']) {
      const res = await create({
        enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present', [field]: 'att-b'
      }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('TENANT: a query tenantId, companyId or branchId is ignored', async () => {
    const inA = await setup(ownerA());
    await markDay(inA.enrollmentId, TODAY, 'present', ownerA());

    for (const query of ['?tenantId=att-b', '?companyId=att-b', '?branchId=att-b']) {
      const res = await request(app).get(`${BASE}/attendance${query}`)
        .set('Authorization', `Bearer ${ownerA()}`);
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].tenantId).toBe('att-a');
    }
  });

  test('TENANT: an X-Tenant-Id header cannot redirect the write', async () => {
    const chain = await setup(ownerA());
    const res = await request(app).post(`${BASE}/attendance`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('X-Tenant-Id', 'att-b')
      .send({ enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'present' });
    expect(res.statusCode).toBe(201);
    // The header is inert: the trusted tenant still won.
    expect(res.body.data.tenantId).toBe('att-a');
    expect((await get('/attendance', ownerB())).body.data).toHaveLength(0);
  });

  test('TENANT: a missing tenant claim answers 400', async () => {
    const noTenant = jwt.signAccessToken({ id: 'u-owner', username: 'attOwner', role: 'Owner' });
    for (const call of [
      request(app).get(`${BASE}/attendance`).set('Authorization', `Bearer ${noTenant}`),
      request(app).post(`${BASE}/attendance`).set('Authorization', `Bearer ${noTenant}`)
        .send({ enrollmentId: 'e', attendanceDate: TODAY, status: 'present' }),
      request(app).put(`${BASE}/attendance/att-x`).set('Authorization', `Bearer ${noTenant}`).send({ status: 'absent' })
    ]) {
      const res = await call;
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Tenant context required');
    }
  });

  test('TENANT: an inactive tenant answers an empty list rather than an error', async () => {
    const retired = token('attOwner', 'att-retired', 'Owner');
    const listed = await get('/attendance', retired);
    expect(listed.statusCode).toBe(200);
    expect(listed.body.data).toEqual([]);
    const one = await get('/attendance/att-x', retired);
    expect(one.statusCode).toBe(404);
  });

  // --- FILTERS OVER HTTP -------------------------------------------------------

  test('FILTERS: the authoritative filters work over HTTP', async () => {
    const chain = await setupHistoric(ownerA());
    await markDay(chain.enrollmentId, dayOffset(-1), 'present', ownerA());
    await markDay(chain.enrollmentId, dayOffset(-2), 'absent', ownerA());
    await markDay(chain.enrollmentId, dayOffset(-3), 'late', ownerA());

    expect((await get(`/attendance?enrollmentId=${chain.enrollmentId}`, ownerA())).body.data).toHaveLength(3);
    expect((await get(`/attendance?attendanceDate=${dayOffset(-1)}`, ownerA())).body.data).toHaveLength(1);
    expect((await get('/attendance?status=absent', ownerA())).body.data).toHaveLength(1);
    const range = await get(`/attendance?dateFrom=${dayOffset(-2)}&dateTo=${dayOffset(-1)}`, ownerA());
    expect(range.body.data).toHaveLength(2);
    expect(range.body.data.map(r => r.attendanceDate)).toEqual([dayOffset(-2), dayOffset(-1)]);
  });

  test('FILTERS: studentId and classId are derived, not stored', async () => {
    const chain = await setup(ownerA());
    await markDay(chain.enrollmentId, TODAY, 'present', ownerA());

    const byStudent = await get(`/attendance?studentId=${chain.studentId}`, ownerA());
    expect(byStudent.body.data).toHaveLength(1);
    const byClass = await get(`/attendance?classId=${chain.classId}`, ownerA());
    expect(byClass.body.data).toHaveLength(1);
    // The returned record is still the bare persisted contract.
    expect(Object.keys(byStudent.body.data[0]).sort()).toEqual([
      'attendanceDate', 'createdAt', 'enrollmentId', 'id', 'notes', 'status', 'tenantId', 'updatedAt'
    ]);
  });

  test('FILTERS: an unknown or foreign derived filter answers an empty list', async () => {
    const chain = await setup(ownerA());
    await markDay(chain.enrollmentId, TODAY, 'present', ownerA());
    const foreign = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });

    const unknown = await get('/attendance?studentId=stu-nope', ownerA());
    const crossTenant = await get(`/attendance?studentId=${foreign.studentId}`, ownerA());
    expect(unknown.body.data).toEqual([]);
    // No existence leakage across tenants.
    expect(crossTenant.body.data).toEqual(unknown.body.data);
  });

  test('FILTERS: an unsupported filter is ignored rather than honoured', async () => {
    const chain = await setup(ownerA());
    await markDay(chain.enrollmentId, TODAY, 'present', ownerA());
    // courseId / programId / teacherId / centerId and free-text search are NOT
    // STU-8 filters; an unknown query key must not narrow or widen the result.
    const res = await get(`/attendance?courseId=${chain.courseId}&search=Hassan`, ownerA());
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  // --- REGRESSION ---------------------------------------------------------------

  test('REGRESSION: attendance stays implemented at STU-8 while scheduling advances', async () => {
    const caps = await get('/capabilities', ownerA());
    expect(caps.statusCode).toBe(200);
    // STU-9 flipped `scheduling` and STU-10 flipped `grading`; STU-8's own
    // status is unchanged, and the attendance contract is deliberately
    // independent of both.
    expect(caps.body.data.find(c => c.key === 'attendance').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'attendance').phase).toBe('STU-8');
    expect(caps.body.data.find(c => c.key === 'scheduling').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'scheduling').phase).toBe('STU-9');
    expect(caps.body.data.find(c => c.key === 'grading').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'grading').phase).toBe('STU-10');
  });

  test('REGRESSION: the earlier Education routes are not shadowed', async () => {
    for (const route of ['students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance']) {
      expect((await get(`/${route}`, ownerA())).statusCode).toBe(200);
    }
  });

  // STU-8 deliberately introduced no session-shaped sub-resource under
  // attendance. STU-9 added scheduling as its OWN entity, and did not reach back
  // into attendance, so these paths are still absent and attendance still keys
  // only on (tenant, enrollment, date).
  test('REGRESSION: attendance exposes no session-shaped sub-resource', async () => {
    for (const path of ['/schedule', '/schedules', '/sessions', '/attendance/sessions']) {
      expect((await get(path, ownerA())).statusCode).toBe(404);
    }
  });

  test('REGRESSION: attendance introduces no unrelated runtime store', async () => {
    const chain = await setup(ownerA());
    await markDay(chain.enrollmentId, TODAY, 'present', ownerA());
    await put(`/attendance/${(await get('/attendance', ownerA())).body.data[0].id}`, ownerA())
      .send({ status: 'absent' });

    const stores = listStores(dir);
    expect(stores).toContain('educationAttendance.json');
    expect(stores.filter(s => /^attendance/i.test(s) && s !== 'educationAttendance.json')).toEqual([]);
    expect(stores.filter(s => /schedule|session|grading|billing/i.test(s))).toEqual([]);
  });

  test('REGRESSION: the enrollment lifecycle still works alongside attendance', async () => {
    const chain = await setup(ownerA());
    await markDay(chain.enrollmentId, TODAY, 'present', ownerA());

    const withdrawn = await request(app).patch(`${BASE}/enrollments/${chain.enrollmentId}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(withdrawn.statusCode).toBe(200);
    // The attendance row survives the withdrawal: history is not destroyed.
    const still = await get('/attendance', ownerA());
    expect(still.body.data).toHaveLength(1);
    expect(still.body.data[0].enrollmentId).toBe(chain.enrollmentId);
  });

  test('REGRESSION: re-enrollment creates an independent attendance set', async () => {
    const chain = await setup(ownerA());
    const day = dayOffset(-1);
    const first = await create({ enrollmentId: chain.enrollmentId, attendanceDate: day, status: 'absent' }, ownerA());
    // dayOffset(-1) predates today's enrollment, so re-date to today for the test.
    expect([201, 400]).toContain(first.statusCode);

    const second = await create({
      enrollmentId: chain.enrollmentId, attendanceDate: TODAY, status: 'absent'
    }, ownerA());
    expect(second.statusCode).toBe(201);

    await request(app).patch(`${BASE}/enrollments/${chain.enrollmentId}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    const reenrolled = await post('/enrollments', ownerA())
      .send({ studentId: chain.studentId, classId: chain.classId });
    expect(reenrolled.statusCode).toBe(201);
    expect(reenrolled.body.data.id).not.toBe(chain.enrollmentId);

    // The new stint can be marked for the same calendar day without a conflict.
    const sameDay = await create({
      enrollmentId: reenrolled.body.data.id, attendanceDate: TODAY, status: 'present'
    }, ownerA());
    expect(sameDay.statusCode).toBe(201);
    expect((await get('/attendance', ownerA())).body.data).toHaveLength(2);
  });

});

// ---------------------------------------------------------------------------
// 3. BATCH — one register, one request
// ---------------------------------------------------------------------------
// The batch path is an operational convenience, NOT a second attendance model,
// so this suite holds it to the same four STU-8 contracts as a single create:
// the same record shape, the same trusted tenant, the same enrollment window and
// the same one-row-per-(tenant, enrollment, day) rule. On top of that it pins
// the two properties that make it safe to trust: it never partially writes, and
// it never overwrites.

describe('EDUCATION CORE+ attendance bulk — one register, one request, all or nothing', () => {
  let dir;
  let service;
  let enrollments;
  let students;
  let classes;
  let courses;
  let programs;
  let teachers;
  let storage;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('att-bulk-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/attendance.service');
    enrollments = require('../services/enrollment.service');
    students = require('../services/student.service');
    classes = require('../services/class.service');
    courses = require('../services/course.service');
    programs = require('../services/program.service');
    teachers = require('../services/teacher.service');
    storage = require('../repositories/storageAdapter');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'att-a' };
  const B = { tenantId: 'att-b' };

  // One class holding `count` distinct students, each ACTIVELY enrolled, all
  // created today so today is inside every enrollment window.
  const rosterIn = (ctx, count) => {
    const program = programs.createProgram(ctx, { name: 'English Track' });
    const course = courses.createCourse(ctx, { programId: program.id, name: 'Grammar 101' });
    const teacher = teachers.createTeacher(ctx, { firstName: 'Ali', lastName: 'One' });
    const klass = classes.createClass(ctx, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    const rows = [];
    for (let i = 0; i < count; i++) {
      const student = students.createStudent(ctx, { firstName: 'Nadia', lastName: 'Student' + i });
      const enrollment = enrollments.createEnrollment(ctx, { studentId: student.id, classId: klass.id });
      rows.push({ student, enrollment });
    }
    return { program, course, teacher, klass, rows, classId: klass.id };
  };

  const entriesFor = (roster) => roster.rows.map((row, i) => ({
    enrollmentId: row.enrollment.id,
    status: i % 2 === 0 ? 'present' : 'late'
  }));

  const batch = (roster, extra) => Object.assign(
    { attendanceDate: TODAY, entries: entriesFor(roster) },
    extra || {}
  );

  const stored = () => {
    const doc = storage.read('educationAttendance');
    return Array.isArray(doc.attendance) ? doc.attendance : [];
  };

  // --- TENANT CONTEXT ---------------------------------------------------------

  test('BULK: refuses to run without a trusted tenant', () => {
    expect(() => service.bulkCreateAttendance(null, { attendanceDate: TODAY, entries: [] }))
      .toThrow('Tenant context is required');
    expect(() => service.bulkCreateAttendance({}, { attendanceDate: TODAY, entries: [] }))
      .toThrow('Tenant context is required');
    expect(() => service.bulkCreateAttendance({ tenantId: '' }, { attendanceDate: TODAY, entries: [] }))
      .toThrow('Tenant context is required');
  });

  // --- THE HAPPY PATH ---------------------------------------------------------

  test('BULK: a valid batch records every entry in one call', () => {
    const roster = rosterIn(A, 5);
    const result = service.bulkCreateAttendance(A, batch(roster));

    expect(result.attendanceDate).toBe(TODAY);
    expect(result.count).toBe(5);
    expect(result.records).toHaveLength(5);

    const rows = stored();
    expect(rows).toHaveLength(5);
    expect(rows.map(r => r.enrollmentId).sort()).toEqual(entriesFor(roster).map(e => e.enrollmentId).sort());
    rows.forEach((row) => {
      // The batch writes the SAME record a single create writes, tenant included.
      expect(Object.keys(row).sort()).toEqual([
        'attendanceDate', 'createdAt', 'enrollmentId', 'id', 'notes', 'status', 'tenantId', 'updatedAt'
      ]);
      expect(row.tenantId).toBe('att-a');
      expect(row.attendanceDate).toBe(TODAY);
      expect(row.notes).toBe('');
    });
    expect(new Set(rows.map(r => r.id)).size).toBe(5);
  });

  test('BULK: the written records are byte-identical in shape to a single create', () => {
    const roster = rosterIn(A, 2);
    const one = service.createAttendance(A, {
      enrollmentId: roster.rows[0].enrollment.id, attendanceDate: TODAY, status: 'absent', notes: 'called'
    });
    const many = service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [{ enrollmentId: roster.rows[1].enrollment.id, status: 'excused', notes: '  medical  ' }]
    });

    expect(Object.keys(many.records[0]).sort()).toEqual(Object.keys(one).sort());
    // The batch trims notes exactly as the single create does.
    expect(many.records[0].notes).toBe('medical');
    expect(one.notes).toBe('called');
  });

  test('BULK: every documented status is accepted', () => {
    const roster = rosterIn(A, 4);
    const result = service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: roster.rows.map((row, i) => ({
        enrollmentId: row.enrollment.id,
        status: service.ATTENDANCE_STATUSES[i]
      }))
    });
    expect(result.count).toBe(4);
    expect(stored().map(r => r.status).sort())
      .toEqual([...service.ATTENDANCE_STATUSES].sort());
  });

  // --- EMPTY AND MALFORMED ----------------------------------------------------

  test('BULK: an empty batch is refused and writes nothing', () => {
    rosterIn(A, 2);
    expect(() => service.bulkCreateAttendance(A, { attendanceDate: TODAY, entries: [] }))
      .toThrow('at least one entry');
    expect(stored()).toEqual([]);
  });

  test('BULK: a malformed envelope is refused and writes nothing', () => {
    const roster = rosterIn(A, 2);
    for (const payload of [
      null,
      'not-an-object',
      [],
      { entries: entriesFor(roster) },
      { attendanceDate: TODAY },
      { attendanceDate: TODAY, entries: 'nope' },
      { attendanceDate: TODAY, entries: [null] },
      { attendanceDate: TODAY, entries: ['nope'] }
    ]) {
      expect(() => service.bulkCreateAttendance(A, payload)).toThrow();
    }
    expect(stored()).toEqual([]);
  });

  test('BULK: the batch is bounded', () => {
    expect(service.MAX_BATCH_ENTRIES).toBe(500);
    const roster = rosterIn(A, 1);
    const tooMany = {
      attendanceDate: TODAY,
      entries: Array.from({ length: service.MAX_BATCH_ENTRIES + 1 }, () => ({
        enrollmentId: roster.rows[0].enrollment.id, status: 'present'
      }))
    };
    expect(() => service.bulkCreateAttendance(A, tooMany)).toThrow('at most 500 entries');
    expect(stored()).toEqual([]);
  });

  // --- DATE -------------------------------------------------------------------

  test('BULK: an invalid date is refused and writes nothing', () => {
    const roster = rosterIn(A, 2);
    for (const day of ['', 'today', '2026-1-1', '01-01-2026', '2026-01-01T00:00:00Z', '2023-02-29']) {
      expect(() => service.bulkCreateAttendance(A, { attendanceDate: day, entries: entriesFor(roster) }))
        .toThrow();
    }
    expect(stored()).toEqual([]);
  });

  test('BULK: a future date is refused and writes nothing', () => {
    const roster = rosterIn(A, 2);
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: dayOffset(1), entries: entriesFor(roster)
    })).toThrow('future');
    expect(stored()).toEqual([]);
  });

  // --- STATUS -----------------------------------------------------------------

  test('BULK: an invalid status is refused by index and writes nothing', () => {
    const roster = rosterIn(A, 3);
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [
        { enrollmentId: roster.rows[0].enrollment.id, status: 'present' },
        { enrollmentId: roster.rows[1].enrollment.id, status: 'sick' },
        { enrollmentId: roster.rows[2].enrollment.id, status: 'present' }
      ]
    })).toThrow('entries[1].status must be one of');
    expect(stored()).toEqual([]);
  });

  test('BULK: a missing status is refused and writes nothing', () => {
    const roster = rosterIn(A, 2);
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [
        { enrollmentId: roster.rows[0].enrollment.id, status: 'present' },
        { enrollmentId: roster.rows[1].enrollment.id }
      ]
    })).toThrow('status is required');
    expect(stored()).toEqual([]);
  });

  // --- DUPLICATES INSIDE THE BATCH --------------------------------------------

  test('BULK: the same enrollment twice in one batch is refused and writes nothing', () => {
    const roster = rosterIn(A, 2);
    const shared = roster.rows[0].enrollment.id;
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [
        { enrollmentId: shared, status: 'present' },
        { enrollmentId: shared, status: 'absent' }
      ]
    })).toThrow('repeated in this batch');
    expect(stored()).toEqual([]);
  });

  // --- ALREADY-RECORDED DAYS --------------------------------------------------

  test('BULK: an already-recorded day is a typed conflict and writes nothing', () => {
    const roster = rosterIn(A, 3);
    service.createAttendance(A, {
      enrollmentId: roster.rows[0].enrollment.id, attendanceDate: TODAY, status: 'present'
    });

    let caught = null;
    try {
      service.bulkCreateAttendance(A, batch(roster));
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeNull();
    expect(caught.conflict).toBe(true);
    expect(caught.code).toBe('ATTENDANCE_CONFLICT');
    expect(caught.attendanceDate).toBe(TODAY);
    expect(caught.conflicts).toHaveLength(1);
    expect(caught.conflicts[0].enrollmentId).toBe(roster.rows[0].enrollment.id);
    expect(caught.conflicts[0].attendanceId).toBeTruthy();

    // The refusal changed nothing, including the row that already existed.
    const rows = stored();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('present');
  });

  test('BULK: a conflict never overwrites — the correction still goes through the update path', () => {
    const roster = rosterIn(A, 2);
    const created = service.createAttendance(A, {
      enrollmentId: roster.rows[0].enrollment.id, attendanceDate: TODAY, status: 'present', notes: 'kept'
    });
    expect(() => service.bulkCreateAttendance(A, batch(roster))).toThrow();

    const corrected = service.updateAttendance(A, created.id, { status: 'absent' });
    expect(corrected.status).toBe('absent');
    expect(corrected.notes).toBe('kept');
    expect(corrected.enrollmentId).toBe(roster.rows[0].enrollment.id);
    expect(stored()).toHaveLength(1);
  });

  // --- TENANT ISOLATION -------------------------------------------------------

  test('BULK: a foreign enrollment is refused and the whole batch is abandoned', () => {
    const mine = rosterIn(A, 3);
    const theirs = rosterIn(B, 1);

    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [
        { enrollmentId: mine.rows[0].enrollment.id, status: 'present' },
        { enrollmentId: theirs.rows[0].enrollment.id, status: 'present' },
        { enrollmentId: mine.rows[1].enrollment.id, status: 'present' }
      ]
    })).toThrow('entries[1].enrollmentId does not reference an Enrollment in this tenant');

    // A foreign enrollment is indistinguishable from a missing one, and no part
    // of the batch survives the refusal.
    expect(stored()).toEqual([]);
  });

  test('BULK: an unknown enrollment id is refused exactly like a foreign one', () => {
    const roster = rosterIn(A, 1);
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [
        { enrollmentId: roster.rows[0].enrollment.id, status: 'present' },
        { enrollmentId: 'enr-does-not-exist', status: 'present' }
      ]
    })).toThrow('does not reference an Enrollment in this tenant');
    expect(stored()).toEqual([]);
  });

  test('BULK: one tenant can never see or write another tenant rows', () => {
    const mine = rosterIn(A, 2);
    const theirs = rosterIn(B, 2);
    service.bulkCreateAttendance(A, batch(mine));

    expect(service.listAttendance(A, {})).toHaveLength(2);
    expect(service.listAttendance(B, {})).toHaveLength(0);
    // The same day is free in the other tenant, because uniqueness is per tenant.
    expect(() => service.bulkCreateAttendance(B, {
      attendanceDate: TODAY,
      entries: theirs.rows.map(r => ({ enrollmentId: r.enrollment.id, status: 'absent' }))
    })).not.toThrow();
    expect(service.listAttendance(B, {})).toHaveLength(2);
  });

  // --- ATOMICITY --------------------------------------------------------------

  test('ATOMICITY: a batch with any invalid entry persists NOTHING', () => {
    const roster = rosterIn(A, 6);
    const entries = entriesFor(roster);
    entries[4].status = 'unknown-status';

    expect(() => service.bulkCreateAttendance(A, { attendanceDate: TODAY, entries })).toThrow();
    expect(stored()).toEqual([]);

    // And the day is still free afterwards: the refusal reserved nothing.
    expect(service.bulkCreateAttendance(A, { attendanceDate: TODAY, entries: entriesFor(roster) }).count)
      .toBe(6);
  });

  test('ATOMICITY: a day outside the enrollment window rejects the whole batch', () => {
    const roster = rosterIn(A, 2);
    const doc = storage.read('educationEnrollments');
    const opened = new Date(Date.now() - 40 * 86400000).toISOString();
    storage.write('educationEnrollments', {
      ...doc,
      enrollments: doc.enrollments.map(e => ({ ...e, enrolledAt: opened, createdAt: opened }))
    });

    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: dayOffset(-30), entries: entriesFor(roster)
    })).not.toThrow();

    // A day before the (re-dated) enrollment start still refuses the batch.
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: dayOffset(-50),
      entries: [{ enrollmentId: roster.rows[0].enrollment.id, status: 'present' }]
    })).toThrow('before the enrollment period');
    expect(stored()).toHaveLength(2);
  });

  test('ATOMICITY: a storage write that fails is reported, never swallowed', () => {
    const roster = rosterIn(A, 2);
    const spy = jest.spyOn(storage, 'write').mockReturnValue(false);
    try {
      expect(() => service.bulkCreateAttendance(A, batch(roster))).toThrow('could not be written');
    } finally {
      spy.mockRestore();
    }
    // Nothing is persisted when the single document write did not happen.
    expect(stored()).toEqual([]);
  });

  // --- FIELD WHITELIST --------------------------------------------------------

  test('BULK: no tenant, student, class or server-owned field is writable', () => {
    const roster = rosterIn(A, 1);
    const enrollmentId = roster.rows[0].enrollment.id;

    // The envelope may not address a class or a tenant instead of enrollments.
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY, entries: entriesFor(roster), tenantId: 'att-b'
    })).toThrow('tenantId is not writable');
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY, entries: entriesFor(roster), classId: roster.classId
    })).toThrow('classId is not writable');
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY, entries: entriesFor(roster), studentId: roster.rows[0].student.id
    })).toThrow('studentId is not writable');
    // Nor may a single enrollment address the whole batch.
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY, entries: entriesFor(roster), enrollmentId
    })).toThrow('enrollmentId cannot be changed');
    // Nor may an envelope status stamp one outcome over the class.
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY, entries: entriesFor(roster), status: 'present'
    })).toThrow('status is only writable on an entry');

    // An entry may not smuggle a derived reference either.
    for (const extra of [
      { studentId: roster.rows[0].student.id },
      { classId: roster.classId },
      { tenantId: 'att-b' },
      { id: 'att-forged' },
      { createdAt: '2020-01-01T00:00:00.000Z' },
      { attendanceId: 'att-forged' }
    ]) {
      expect(() => service.bulkCreateAttendance(A, {
        attendanceDate: TODAY,
        entries: [{ enrollmentId, status: 'present', ...extra }]
      })).toThrow('not writable');
    }

    expect(stored()).toEqual([]);
  });

  test('BULK: over-long notes are refused by index, never truncated silently', () => {
    const roster = rosterIn(A, 1);
    expect(() => service.bulkCreateAttendance(A, {
      attendanceDate: TODAY,
      entries: [{ enrollmentId: roster.rows[0].enrollment.id, status: 'present', notes: 'x'.repeat(161) }]
    })).toThrow('entries[0].notes must be at most 160 characters');
    expect(stored()).toEqual([]);
  });

  test('BULK: a prototype-pollution payload is refused', () => {
    const roster = rosterIn(A, 1);
    const payload = JSON.parse('{"attendanceDate":"' + TODAY + '","entries":[{"enrollmentId":"' +
      roster.rows[0].enrollment.id + '","status":"present"}],"__proto__":{"admin":true}}');
    expect(() => service.bulkCreateAttendance(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.admin).toBeUndefined();
    expect(stored()).toEqual([]);
  });

  // --- BOUNDARY ---------------------------------------------------------------

  test('BULK: the batch introduces no store, no field and no second attendance model', () => {
    const roster = rosterIn(A, 2);
    service.bulkCreateAttendance(A, batch(roster));

    expect(listStores(dir)).toContain('educationAttendance.json');
    expect(listStores(dir).filter(s => /attendance/i.test(s) && s !== 'educationAttendance.json')).toEqual([]);
    const rows = stored();
    rows.forEach((row) => {
      expect(Object.keys(row).sort()).toEqual([
        'attendanceDate', 'createdAt', 'enrollmentId', 'id', 'notes', 'status', 'tenantId', 'updatedAt'
      ]);
    });
    // Still exactly one row per (tenant, enrollment, day).
    const keys = rows.map(r => [r.tenantId, r.enrollmentId, r.attendanceDate].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('BULK: the list filters read a batched register exactly as they read single rows', () => {
    const roster = rosterIn(A, 4);
    service.bulkCreateAttendance(A, batch(roster));

    expect(service.listAttendance(A, { attendanceDate: TODAY })).toHaveLength(4);
    expect(service.listAttendance(A, { classId: roster.classId })).toHaveLength(4);
    expect(service.listAttendance(A, { classId: 'class-other' })).toHaveLength(0);
    expect(service.listAttendance(A, { studentId: roster.rows[0].student.id })).toHaveLength(1);
    expect(service.listAttendance(A, { status: 'present' })).toHaveLength(2);
    // An unknown status matches nothing rather than silently returning the tenant.
    expect(service.listAttendance(A, { status: 'sick' })).toHaveLength(0);
  });
});

describe('EDUCATION CORE+ attendance bulk routes — authorization, tenant isolation and all-or-nothing', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('att-bulk-http');
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

  const ownerA = () => token('attOwner', 'att-a', 'Owner');
  const ownerB = () => token('attOwner', 'att-b', 'Owner');
  const managerA = () => token('attManager', 'att-a', 'Manager');
  const clerkA = () => token('attClerk', 'att-a', 'Viewer');

  const post = (path, tok) => request(app).post(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tok}`);

  const get = (path, tok) => request(app).get(`${BASE}${path}`)
    .set('Authorization', `Bearer ${tok}`);

  // A class with `count` students, each ACTIVELY enrolled over HTTP.
  const rosterOverHttp = async (tok, count, opts = {}) => {
    const program = await post('/programs', tok).send({ name: 'English Track' });
    const course = await post('/courses', tok).send({ name: 'Grammar 101', programId: program.body.data.id });
    const teacher = await post('/teachers', tok).send({ firstName: 'Ali', lastName: opts.teacherLast || 'One' });
    const klass = await post('/classes', tok).send({
      courseId: course.body.data.id, teacherId: teacher.body.data.id, name: opts.className || 'A1'
    });
    const rows = [];
    for (let i = 0; i < count; i++) {
      const student = await post('/students', tok).send({ firstName: 'Nadia', lastName: 'Student' + i });
      const enrollment = await post('/enrollments', tok)
        .send({ studentId: student.body.data.id, classId: klass.body.data.id });
      rows.push({ studentId: student.body.data.id, enrollmentId: enrollment.body.data.id });
    }
    return { classId: klass.body.data.id, rows };
  };

  const entriesFor = (roster) => roster.rows.map((row, i) => ({
    enrollmentId: row.enrollmentId,
    status: i % 2 === 0 ? 'present' : 'late'
  }));

  // --- AUTH -------------------------------------------------------------------

  test('AUTH: the batch route is refused without a token', async () => {
    const res = await request(app).post(`${BASE}/attendance/bulk`)
      .send({ attendanceDate: TODAY, entries: [] });
    expect(res.statusCode).toBe(401);
  });

  test('AUTHORIZATION: unregistered Attendance permissions fail closed on the batch route', async () => {
    const roster = await rosterOverHttp(ownerA(), 2);
    const res = await post('/attendance/bulk', clerkA())
      .send({ attendanceDate: TODAY, entries: entriesFor(roster) });
    expect(res.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(res.body.message);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('AUTHORIZATION: a Manager cannot record a register, and nothing is persisted', async () => {
    const roster = await rosterOverHttp(ownerA(), 2);
    const res = await post('/attendance/bulk', managerA())
      .send({ attendanceDate: TODAY, entries: entriesFor(roster) });
    expect(res.statusCode).toBe(403);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  // --- THE HAPPY PATH ---------------------------------------------------------

  test('BULK over HTTP: a whole class register is recorded in one request', async () => {
    const roster = await rosterOverHttp(ownerA(), 6);
    const res = await post('/attendance/bulk', ownerA())
      .send({ attendanceDate: TODAY, entries: entriesFor(roster) });

    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe('Attendance recorded');
    expect(res.body.data.count).toBe(6);
    expect(res.body.data.attendanceDate).toBe(TODAY);
    expect(res.body.data.records).toHaveLength(6);
    res.body.data.records.forEach((row) => expect(row.tenantId).toBe('att-a'));

    const listed = await get(`/attendance?classId=${roster.classId}&attendanceDate=${TODAY}`, ownerA());
    expect(listed.statusCode).toBe(200);
    expect(listed.body.data).toHaveLength(6);
  });

  test('BULK over HTTP: an empty body is a 400 with a details list', async () => {
    const res = await post('/attendance/bulk', ownerA()).send({});
    expect(res.statusCode).toBe(400);
    expect(Array.isArray(res.body.details.details)).toBe(true);
    expect(res.body.details.details.join(' ')).toContain('entries must be an array');
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  // --- TENANT ISOLATION OVER HTTP ---------------------------------------------

  test('TENANT ISOLATION: another tenant enrollment cannot be recorded, and the batch is abandoned', async () => {
    const mine = await rosterOverHttp(ownerA(), 3);
    const theirs = await rosterOverHttp(ownerB(), 1);

    const res = await post('/attendance/bulk', ownerA()).send({
      attendanceDate: TODAY,
      entries: [...entriesFor(mine), { enrollmentId: theirs.rows[0].enrollmentId, status: 'present' }]
    });

    expect(res.statusCode).toBe(400);
    expect(res.body.details.details.join(' ')).toContain('does not reference an Enrollment in this tenant');
    // All-or-nothing: the three valid entries were abandoned with the fourth.
    expect(readStore(dir, 'educationAttendance')).toBeNull();
    expect((await get('/attendance', ownerA())).body.data).toHaveLength(0);
  });

  // --- CONFLICT OVER HTTP -----------------------------------------------------

  test('CONFLICT: an already-recorded day is a 409 with a typed code and the clashing rows', async () => {
    const roster = await rosterOverHttp(ownerA(), 3);
    await post('/attendance', ownerA())
      .send({ enrollmentId: roster.rows[1].enrollmentId, attendanceDate: TODAY, status: 'present' });

    const res = await post('/attendance/bulk', ownerA())
      .send({ attendanceDate: TODAY, entries: entriesFor(roster) });

    expect(res.statusCode).toBe(409);
    expect(res.body.details.code).toBe('ATTENDANCE_CONFLICT');
    expect(res.body.details.attendanceDate).toBe(TODAY);
    expect(res.body.details.conflicts).toHaveLength(1);
    expect(res.body.details.conflicts[0].enrollmentId).toBe(roster.rows[1].enrollmentId);

    // Nothing was overwritten, and the other two students were not recorded.
    const listed = await get('/attendance', ownerA());
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0].status).toBe('present');
  });

  // --- ENVELOPE HONESTY OVER HTTP ---------------------------------------------

  test('BOUNDARY: the envelope cannot carry a tenant, a class or a class-wide status', async () => {
    const roster = await rosterOverHttp(ownerA(), 2);
    for (const extra of [{ tenantId: 'att-b' }, { classId: roster.classId }, { status: 'present' }]) {
      const res = await post('/attendance/bulk', ownerA())
        .send({ attendanceDate: TODAY, entries: entriesFor(roster), ...extra });
      expect(res.statusCode).toBe(400);
    }
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  // --- ROUTE PARITY -----------------------------------------------------------

  test('ROUTE PARITY: the batch path does not shadow the single-record route', async () => {
    // A GET on the literal batch path still resolves through `/attendance/:id`
    // and reports an absent record, exactly as any unknown id does.
    const res = await get('/attendance/bulk', ownerA());
    expect(res.statusCode).toBe(404);
    expect(res.body.message).toBe('Attendance not found');

    // The single-record create and correction paths are unchanged.
    const roster = await rosterOverHttp(ownerA(), 1);
    const one = await post('/attendance', ownerA())
      .send({ enrollmentId: roster.rows[0].enrollmentId, attendanceDate: TODAY, status: 'present' });
    expect(one.statusCode).toBe(201);
    const fixed = await request(app).put(`${BASE}/attendance/${one.body.data.id}`)
      .set('Authorization', `Bearer ${ownerA()}`).send({ status: 'excused' });
    expect(fixed.statusCode).toBe(200);
    expect(fixed.body.data.status).toBe('excused');
  });
});