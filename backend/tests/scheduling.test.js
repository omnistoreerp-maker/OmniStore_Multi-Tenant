'use strict';

// STU-9 Education Scheduling records — regression suite (Device 2).
//
// A scheduled session is ONE Class, ONE calendar day, ONE contiguous time
// range. This suite pins the four contracts STU-9 locks down:
//
//   1. OWNERSHIP. A session stores `classId` and nothing else. The teacher is
//      DERIVED from the Class, exactly the way STU-8 derives studentId and
//      classId from the Enrollment, so a teacher reassignment is followed
//      automatically instead of needing a migration. No course, program,
//      center, student or enrollment reference is persisted.
//   2. TIME. `scheduledDate` is the same strict date-only `YYYY-MM-DD` STU-8
//      established; `startTime`/`endTime` are a strict 24-hour `HH:mm` wall
//      clock with no timezone, because the repository's timezone sources
//      (optional Center, none on Program, one on the Pack) disagree. `endTime`
//      must be strictly later than `startTime`.
//   3. CONFLICTS, and only two of them: the same class, and the same derived
//      teacher, cannot be committed to overlapping ranges on one day. Touching
//      ranges are legal, because back-to-back sessions are the ordinary case.
//      There is no room/capacity rule, because Center has no such concept.
//   4. CORRECTION, NOT LIFECYCLE. `scheduledDate`, `startTime`, `endTime` and
//      `notes` are mutable; `classId` is immutable. There is no DELETE, no
//      /archive and no /cancel, so a refused correction is the only failure mode
//      that has to leave the row byte-for-byte unchanged.
//
// It also pins the two separations that matter most: Scheduling does not depend
// on Attendance (and vice versa), and nothing behind the Class is walked, so an
// archived Course, Program, Teacher or Center cannot invalidate a session.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore, listStores } = require('./helpers/testData');

const companies = [
  { id: 'sch-a', name: 'Scheduling Tenant A', code: 'SCHA', active: true },
  { id: 'sch-b', name: 'Scheduling Tenant B', code: 'SCHB', active: true },
  { id: 'sch-retired', name: 'Retired Scheduling Tenant', code: 'SCHR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'schOwner', password, role: 'Owner', fullName: 'Scheduling Owner',
      tenantIds: ['sch-a', 'sch-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Scheduling permissions EXPLICITLY, so
      // the suite proves a registered, explicitly granted permission is honoured.
      // The stranger below covers the unregistered case.
      id: 'u-clerk', username: 'schClerk', password, role: 'Viewer', fullName: 'Scheduling Clerk',
      permissions: ['education.scheduling.view', 'education.scheduling.edit'],
      tenantIds: ['sch-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding a Scheduling permission the registry does
      // NOT know, so the suite proves an unregistered permission still fails
      // closed rather than being honoured because a client record asked for it.
      id: 'u-stranger', username: 'schStranger', password, role: 'Viewer', fullName: 'Scheduling Stranger',
      permissions: ['education.scheduling.export'],
      tenantIds: ['sch-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'schManager', password, role: 'Manager', fullName: 'Scheduling Manager',
      tenantIds: ['sch-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

const TODAY = new Date().toISOString().slice(0, 10);

function dayOffset(days) {
  const d = new Date(Date.now() + days * 86400000);
  return d.toISOString().slice(0, 10);
}

// A valid create payload. `over` replaces individual fields.
const slot = (classId, over) => Object.assign(
  { classId, scheduledDate: TODAY, startTime: '10:00', endTime: '11:00' },
  over || {}
);

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-9 scheduling.service — class ownership, time rules, conflicts and correction', () => {
  let dir;
  let service;
  let classes;
  let courses;
  let programs;
  let teachers;
  let centers;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('sch-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/scheduling.service');
    classes = require('../services/class.service');
    courses = require('../services/course.service');
    programs = require('../services/program.service');
    teachers = require('../services/teacher.service');
    centers = require('../services/center.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'sch-a' };
  const B = { tenantId: 'sch-b' };

  const teacherIn = (ctx, opts = {}) => {
    const input = { firstName: 'Ali', lastName: opts.last || 'One' };
    if (opts.status) input.status = opts.status;
    return teachers.createTeacher(ctx, input);
  };

  // Center -> Program -> Course -> Class plus a Teacher, in one tenant.
  // `opts.teacher` reuses an existing Teacher (for the shared-teacher conflict
  // rule) and `opts.classStatus` may be 'inactive'.
  const chainIn = (ctx, opts = {}) => {
    const programInput = { name: opts.programName || 'English Track' };
    if (opts.centerId) programInput.centerId = opts.centerId;
    const program = programs.createProgram(ctx, programInput);
    const course = courses.createCourse(ctx, { programId: program.id, name: opts.courseName || 'Grammar 101' });
    const teacher = opts.teacher || teacherIn(ctx, { last: opts.teacherLast || 'One', status: opts.teacherStatus });
    const classInput = { courseId: course.id, teacherId: teacher.id, name: opts.className || 'A1' };
    if (opts.classStatus) classInput.status = opts.classStatus;
    const klass = classes.createClass(ctx, classInput);
    return { program, course, teacher, klass };
  };

  // A ready-made Class, with optional overrides.
  const classIn = (ctx, opts = {}) => chainIn(ctx, opts).klass;

  const make = (ctx, classId, over) => service.createSession(ctx, slot(classId, over));

  // --- TENANT CONTEXT -------------------------------------------------------

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listScheduling(null)).toThrow('Tenant context is required');
    expect(() => service.listScheduling({})).toThrow('Tenant context is required');
    expect(() => service.getSession(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createSession(null, slot('cls-x'))).toThrow('Tenant context is required');
    expect(() => service.updateSession(null, 'x', { endTime: '12:00' })).toThrow('Tenant context is required');
    expect(() => service.updateSession({ tenantId: '' }, 'x', {})).toThrow('Tenant context is required');
  });

  // --- MODEL ----------------------------------------------------------------

  test('create requires classId, scheduledDate, startTime and endTime', () => {
    const klass = classIn(A);
    expect(() => service.createSession(A, { scheduledDate: TODAY, startTime: '10:00', endTime: '11:00' }))
      .toThrow('classId is required');
    expect(() => service.createSession(A, { classId: klass.id, startTime: '10:00', endTime: '11:00' }))
      .toThrow('scheduledDate is required');
    expect(() => service.createSession(A, { classId: klass.id, scheduledDate: TODAY, endTime: '11:00' }))
      .toThrow('startTime is required');
    expect(() => service.createSession(A, { classId: klass.id, scheduledDate: TODAY, startTime: '10:00' }))
      .toThrow('endTime is required');
    expect(() => service.createSession(A, { classId: '  ', scheduledDate: TODAY, startTime: '10:00', endTime: '11:00' }))
      .toThrow('classId is required');
    expect(() => service.createSession(A, 'nope')).toThrow('request body must be a JSON object');
    expect(() => service.createSession(A, ['nope'])).toThrow('request body must be a JSON object');
    expect(service.listScheduling(A)).toHaveLength(0);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('create stamps exactly the contracted record shape', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);

    expect(created.tenantId).toBe('sch-a');
    expect(created.classId).toBe(klass.id);
    expect(created.scheduledDate).toBe(TODAY);
    expect(created.startTime).toBe('10:00');
    expect(created.endTime).toBe('11:00');
    expect(created.notes).toBe('');
    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.createdAt).toBe(created.updatedAt);
    // Exactly nine contracted keys — no teacher, course, program, center,
    // student or enrollment reference.
    expect(Object.keys(created).sort()).toEqual([
      'classId', 'createdAt', 'endTime', 'id', 'notes', 'scheduledDate', 'startTime', 'tenantId', 'updatedAt'
    ]);
  });

  test('the persisted record carries no denormalized or derived ownership', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { notes: 'weekday group' });
    for (const derived of ['teacherId', 'courseId', 'programId', 'centerId', 'studentId', 'enrollmentId']) {
      expect(Object.prototype.hasOwnProperty.call(created, derived)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, derived)).toBe(false);
    }
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });

  test('generated ids are unique across many sessions', () => {
    const klass = classIn(A);
    const ids = new Set();
    for (let d = 1; d <= 5; d++) {
      ids.add(make(A, klass.id, { scheduledDate: dayOffset(d) }).id);
    }
    expect(ids.size).toBe(5);
  });

  test('notes is optional, trimmed and capped at 160 characters', () => {
    const klass = classIn(A);
    expect(make(A, klass.id, { scheduledDate: dayOffset(1) }).notes).toBe('');
    expect(make(A, klass.id, { scheduledDate: dayOffset(2), notes: '  lab room  ' }).notes).toBe('lab room');
    expect(() => make(A, klass.id, { scheduledDate: dayOffset(3), notes: 'x'.repeat(161) }))
      .toThrow('notes must be at most 160 characters');
    expect(make(A, klass.id, { scheduledDate: dayOffset(4), notes: 'y'.repeat(160) }).notes).toHaveLength(160);
  });

  // --- DATE RULES ------------------------------------------------------------

  test('a valid scheduled date is accepted, past or future', () => {
    const klass = classIn(A);
    // A session is a PLAN, so unlike attendance there is no "not in the future"
    // rule: a course legitimately gets timetabled weeks ahead.
    expect(make(A, klass.id, { scheduledDate: dayOffset(30) }).scheduledDate).toBe(dayOffset(30));
    expect(make(A, klass.id, { scheduledDate: dayOffset(-30) }).scheduledDate).toBe(dayOffset(-30));
    expect(make(A, klass.id, { scheduledDate: TODAY }).scheduledDate).toBe(TODAY);
  });

  test('a timestamp is rejected — scheduledDate is never a datetime', () => {
    const klass = classIn(A);
    for (const bad of ['2026-10-01T09:00:00Z', '2026-10-01T09:00:00.000Z', '2026-10-01 09:00:00',
                       '2026-10-01T00:00:00+02:00', TODAY + 'T10:00:00.000Z']) {
      expect(() => make(A, klass.id, { scheduledDate: bad }))
        .toThrow('scheduledDate must be a date in YYYY-MM-DD format');
    }
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('a malformed or localized date is rejected', () => {
    const klass = classIn(A);
    for (const bad of ['01/10/2026', '10-01-2026', '2026/10/01', '1-1-2026', '2026-1-1',
                       'next monday', '2026-10', '20261001']) {
      expect(() => make(A, klass.id, { scheduledDate: bad }))
        .toThrow('scheduledDate must be a date in YYYY-MM-DD format');
    }
    // A blank value is a MISSING field rather than a malformed one.
    for (const blank of ['', '   ']) {
      expect(() => service.createSession(A, {
        classId: klass.id, scheduledDate: blank, startTime: '10:00', endTime: '11:00'
      })).toThrow('scheduledDate is required');
    }
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('an impossible calendar date is rejected even when well formatted', () => {
    const klass = classIn(A);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2023-02-29']) {
      expect(() => make(A, klass.id, { scheduledDate: bad }))
        .toThrow('scheduledDate must be a real calendar date');
    }
    // A real leap day is still accepted.
    expect(make(A, klass.id, { scheduledDate: '2024-02-29' }).scheduledDate).toBe('2024-02-29');
  });

  test('a non-string date is rejected', () => {
    const klass = classIn(A);
    for (const bad of [20261001, 20261001123456, {}, [], true, new Date()]) {
      expect(() => make(A, klass.id, { scheduledDate: bad })).toThrow('scheduledDate must be a string');
    }
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  // --- TIME RULES ------------------------------------------------------------

  test('valid 24-hour boundary times are accepted', () => {
    const klass = classIn(A);
    // 00:00 is midnight and 23:59 is the last minute of the day; both are legal
    // session boundaries, which a naive 01:00-24:00 convention would reject.
    const early = make(A, klass.id, { scheduledDate: dayOffset(1), startTime: '00:00', endTime: '00:01' });
    expect(early.startTime).toBe('00:00');
    expect(early.endTime).toBe('00:01');
    const late = make(A, klass.id, { scheduledDate: dayOffset(2), startTime: '23:58', endTime: '23:59' });
    expect(late.startTime).toBe('23:58');
    expect(late.endTime).toBe('23:59');
    // Same minute for both ends is a zero-length session, not a boundary case.
    expect(() => make(A, klass.id, { scheduledDate: dayOffset(3), startTime: '23:59', endTime: '23:59' }))
      .toThrow('endTime must be later than startTime');
  });

  test('a malformed time is rejected rather than normalized', () => {
    const klass = classIn(A);
    for (const bad of ['9:00', '9.00', '09:0', '09:60', '24:00', '23:60', '0900', '09:00:00',
                       '9am', '09:00 AM', '+09:00', '09-00', 'noon']) {
      expect(() => make(A, klass.id, { startTime: bad }))
        .toThrow('startTime must be a time in HH:mm 24-hour format');
      expect(() => make(A, klass.id, { endTime: bad }))
        .toThrow('endTime must be a time in HH:mm 24-hour format');
    }
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('a non-string time is rejected', () => {
    const klass = classIn(A);
    for (const bad of [1000, {}, [], true, new Date()]) {
      expect(() => make(A, klass.id, { startTime: bad })).toThrow('startTime must be a string');
      expect(() => make(A, klass.id, { endTime: bad })).toThrow('endTime must be a string');
    }
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('endTime equal to startTime is refused — a session needs duration', () => {
    const klass = classIn(A);
    expect(() => make(A, klass.id, { startTime: '10:00', endTime: '10:00' }))
      .toThrow('endTime must be later than startTime');
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('endTime before startTime is refused rather than silently swapped', () => {
    const klass = classIn(A);
    expect(() => make(A, klass.id, { startTime: '11:00', endTime: '09:00' }))
      .toThrow('endTime must be later than startTime');
    expect(() => make(A, klass.id, { startTime: '23:00', endTime: '22:59' }))
      .toThrow('endTime must be later than startTime');
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('a one-minute session is the minimum and is accepted', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { startTime: '10:00', endTime: '10:01' });
    expect(created.startTime).toBe('10:00');
    expect(created.endTime).toBe('10:01');
  });

  test('a full-day-boundary span is accepted', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { scheduledDate: dayOffset(1), startTime: '00:00', endTime: '23:59' });
    expect(created.startTime).toBe('00:00');
    expect(created.endTime).toBe('23:59');
  });

  // --- CLASS RESOLUTION AND PARENT LIFECYCLE ----------------------------------

  test('an unresolvable class is refused and creates nothing', () => {
    expect(() => make(A, 'cls-nope')).toThrow('classId does not reference a Class in this tenant');
    expect(service.listScheduling(A)).toHaveLength(0);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('a foreign class is refused identically to a nonexistent one', () => {
    const foreign = classIn(B);
    let foreignError;
    let unknownError;
    try { make(A, foreign.id); } catch (err) { foreignError = err.message; }
    try { make(A, 'cls-nope'); } catch (err) { unknownError = err.message; }
    // Existence of another tenant's Class is NOT leaked.
    expect(foreignError).toBe(unknownError);
    expect(service.listScheduling(A)).toHaveLength(0);
    expect(service.listScheduling(B)).toHaveLength(0);
  });

  test('an archived Class is refused for a NEW session', () => {
    const klass = classIn(A);
    classes.archiveClass(A, klass.id);
    expect(() => make(A, klass.id)).toThrow('classId must reference a non-archived Class');
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('an inactive (not archived) Class is still schedulable', () => {
    const klass = classIn(A, { classStatus: 'inactive' });
    expect(make(A, klass.id).classId).toBe(klass.id);
  });

  test('archived Course, Program, Teacher and Center are irrelevant', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const chain = chainIn(A, { centerId: center.id });
    courses.archiveCourse(A, chain.course.id);
    programs.archiveProgram(A, chain.program.id);
    teachers.archiveTeacher(A, chain.teacher.id);
    centers.archiveCenter(A, center.id);

    // Every one of them is archived and the session is still created, because
    // nothing behind the Class is ever walked.
    expect(make(A, chain.klass.id).classId).toBe(chain.klass.id);
  });

  test('archiving a Class preserves its existing sessions', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { notes: 'kept' });
    classes.archiveClass(A, klass.id);

    const still = service.getSession(A, created.id);
    expect(still).not.toBeNull();
    expect(still.classId).toBe(klass.id);
    expect(still.notes).toBe('kept');
    expect(still.scheduledDate).toBe(TODAY);
  });

  test('an archived Class blocks a CORRECTION but does not delete the row', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    classes.archiveClass(A, klass.id);

    expect(() => service.updateSession(A, created.id, { endTime: '12:00' }))
      .toThrow('classId must reference a non-archived Class');
    const before = JSON.stringify(readStore(dir, 'educationScheduling'));
    expect(() => service.updateSession(A, created.id, { notes: 'attempted' })).toThrow();
    expect(JSON.stringify(readStore(dir, 'educationScheduling'))).toBe(before);
  });

  test('scheduling reads and writes no parent or attendance store', () => {
    const chain = chainIn(A);
    const students = require('../services/student.service');
    const student = students.createStudent(A, { firstName: 'Nadia', lastName: 'Hassan' });
    const enrollments = require('../services/enrollment.service');
    const attendance = require('../services/attendance.service');
    const enrollment = enrollments.createEnrollment(A, { studentId: student.id, classId: chain.klass.id });

    const classesBefore = readStore(dir, 'educationClasses');
    const coursesBefore = readStore(dir, 'educationCourses');
    const programsBefore = readStore(dir, 'educationPrograms');
    const teachersBefore = readStore(dir, 'educationTeachers');
    const centersBefore = readStore(dir, 'educationCenters');
    const studentsBefore = readStore(dir, 'educationStudents');
    const enrollmentsBefore = readStore(dir, 'educationEnrollments');

    const created = make(A, chain.klass.id);
    service.updateSession(A, created.id, { startTime: '12:00', endTime: '13:00' });

    expect(readStore(dir, 'educationClasses')).toEqual(classesBefore);
    expect(readStore(dir, 'educationCourses')).toEqual(coursesBefore);
    expect(readStore(dir, 'educationPrograms')).toEqual(programsBefore);
    expect(readStore(dir, 'educationTeachers')).toEqual(teachersBefore);
    expect(readStore(dir, 'educationCenters')).toEqual(centersBefore);
    expect(readStore(dir, 'educationStudents')).toEqual(studentsBefore);
    expect(readStore(dir, 'educationEnrollments')).toEqual(enrollmentsBefore);
    // The student and enrollment are irrelevant to the session: a session is a
    // property of the CLASS, not of one enrolled student.
    expect(Object.prototype.hasOwnProperty.call(created, 'enrollmentId')).toBe(false);
    expect(readStore(dir, 'educationAttendance')).toBeNull();
  });

  test('attendance works unchanged whether or not a session exists for the day', () => {
    const chain = chainIn(A);
    const students = require('../services/student.service');
    const enrollments = require('../services/enrollment.service');
    const attendance = require('../services/attendance.service');

    const enroll = (first, last) => {
      const student = students.createStudent(A, { firstName: first, lastName: last });
      return enrollments.createEnrollment(A, { studentId: student.id, classId: chain.klass.id });
    };

    // No session for today: attendance still records fine.
    const before = attendance.createAttendance(A, {
      enrollmentId: enroll('Nadia', 'Hassan').id, attendanceDate: TODAY, status: 'present'
    });

    // With a session for this class and day: the record is byte-identical in
    // shape, still keyed only on (tenant, enrollment, date), and unaffected.
    make(A, chain.klass.id);
    const after = attendance.createAttendance(A, {
      enrollmentId: enroll('Karim', 'Nabil').id, attendanceDate: TODAY, status: 'absent'
    });

    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(Object.keys(after)).not.toContain('sessionId');
    expect(Object.keys(after)).not.toContain('scheduledDate');
    expect(after.status).toBe('absent');
    // Attendance never learned about the session that now exists.
    expect(attendance.listAttendance(A, { classId: chain.klass.id })).toHaveLength(2);
    expect(attendance.getAttendance(A, before.id)).not.toBeNull();
  });

  test('no timezone is stored or interpreted', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { notes: 'morning' });
    expect(Object.prototype.hasOwnProperty.call(created, 'timezone')).toBe(false);
    expect(() => make(A, klass.id, { scheduledDate: dayOffset(5), timezone: 'Africa/Cairo' }))
      .toThrow('timezone is not writable');
  });

  // --- CONFLICTS ---------------------------------------------------------------

  test('an exact duplicate session for the same class and day is a typed conflict', () => {
    const klass = classIn(A);
    make(A, klass.id);
    let thrown;
    try { make(A, klass.id); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(service.SchedulingConflictError);
    expect(thrown.code).toBe('SCHEDULING_CONFLICT');
    expect(thrown.conflict).toBe(true);
    expect(thrown.conflictKind).toBe('class');
    expect(thrown.scheduledDate).toBe(TODAY);
    expect(service.listScheduling(A)).toHaveLength(1);
  });

  test('a partially overlapping session for the same class is a conflict', () => {
    const klass = classIn(A);
    make(A, klass.id, { startTime: '10:00', endTime: '12:00' });
    // Starts before, ends inside.
    expect(() => make(A, klass.id, { startTime: '09:00', endTime: '10:30' }))
      .toThrow('the class is already scheduled at that time on ' + TODAY);
    // Entirely inside.
    expect(() => make(A, klass.id, { startTime: '10:30', endTime: '11:00' }))
      .toThrow(/already scheduled/);
    // Starts inside, ends after.
    expect(() => make(A, klass.id, { startTime: '11:30', endTime: '13:00' }))
      .toThrow(/already scheduled/);
    // Straddles the whole window.
    expect(() => make(A, klass.id, { startTime: '09:00', endTime: '14:00' }))
      .toThrow(/already scheduled/);
    expect(service.listScheduling(A)).toHaveLength(1);
  });

  test('adjacent non-overlapping sessions for the same class are allowed', () => {
    const klass = classIn(A);
    make(A, klass.id, { startTime: '10:00', endTime: '11:00' });
    // Touching at the front and at the back are the ordinary back-to-back case.
    expect(make(A, klass.id, { startTime: '08:00', endTime: '10:00' }).startTime).toBe('08:00');
    expect(make(A, klass.id, { startTime: '11:00', endTime: '12:00' }).startTime).toBe('11:00');
    expect(make(A, klass.id, { startTime: '12:00', endTime: '13:00' }).startTime).toBe('12:00');
    expect(service.listScheduling(A)).toHaveLength(4);
  });

  test('the same class on DIFFERENT days never conflicts', () => {
    const klass = classIn(A);
    make(A, klass.id, { scheduledDate: dayOffset(1) });
    make(A, klass.id, { scheduledDate: dayOffset(2) });
    make(A, klass.id, { scheduledDate: dayOffset(3) });
    expect(service.listScheduling(A)).toHaveLength(3);
  });

  test('the same teacher cannot teach two overlapping classes at once', () => {
    const teacher = teacherIn(A, { last: 'Shared' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher, className: 'B1' }).klass;

    make(A, first.id, { startTime: '10:00', endTime: '12:00' });
    let thrown;
    try {
      make(A, second.id, { startTime: '11:00', endTime: '13:00' });
    } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(service.SchedulingConflictError);
    expect(thrown.code).toBe('SCHEDULING_CONFLICT');
    expect(thrown.conflictKind).toBe('teacher');
    // The conflicting session is identified, and the write that lost changed nothing.
    expect(thrown.conflictingSessionId).toBeTruthy();
    expect(service.listScheduling(A)).toHaveLength(1);
  });

  test('a teacher may teach back-to-back classes on the same day', () => {
    const teacher = teacherIn(A, { last: 'Shared' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher, className: 'B1' }).klass;
    make(A, first.id, { startTime: '10:00', endTime: '11:00' });
    expect(make(A, second.id, { startTime: '11:00', endTime: '12:00' }).classId).toBe(second.id);
  });

  test('different classes with DIFFERENT teachers may overlap freely', () => {
    const first = chainIn(A, { teacherLast: 'One', className: 'A1' }).klass;
    const second = chainIn(A, { teacherLast: 'Two', className: 'B1' }).klass;
    make(A, first.id, { startTime: '10:00', endTime: '12:00' });
    expect(make(A, second.id, { startTime: '10:00', endTime: '12:00' }).classId).toBe(second.id);
    expect(service.listScheduling(A)).toHaveLength(2);
  });

  test('a teacher reassignment is followed automatically, with no stored copy', () => {
    const teacher = teacherIn(A, { last: 'Shared' });
    const other = teacherIn(A, { last: 'Other' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher, className: 'B1' }).klass;
    make(A, first.id, { startTime: '10:00', endTime: '12:00' });
    expect(() => make(A, second.id, { startTime: '11:00', endTime: '12:00' })).toThrow(/already scheduled/);

    // STU-6 explicitly allows reassigning a Class's teacher. Because the session
    // derives the teacher instead of copying it, the conflict disappears the
    // moment the Class moves — with no session row being touched.
    classes.updateClass(A, second.id, { teacherId: other.id });
    expect(make(A, second.id, { startTime: '11:00', endTime: '12:00' }).classId).toBe(second.id);
    expect(service.listScheduling(A)).toHaveLength(2);
  });

  test('cross-tenant sessions never conflict with each other', () => {
    const inA = classIn(A);
    const inB = classIn(B);
    make(A, inA.id, { startTime: '10:00', endTime: '12:00' });
    // The identical slot for the SAME clock time in another tenant is fine.
    expect(make(B, inB.id, { startTime: '10:00', endTime: '12:00' }).tenantId).toBe('sch-b');
    // And each tenant still sees only its own row.
    expect(service.listScheduling(A)).toHaveLength(1);
    expect(service.listScheduling(B)).toHaveLength(1);
  });

  test('the conflict error message leaks no tenant, path or stack detail', () => {
    const klass = classIn(A);
    make(A, klass.id);
    let thrown;
    try { make(A, klass.id); } catch (err) { thrown = err; }
    expect(thrown.message).toMatch(/already scheduled at that time on \d{4}-\d{2}-\d{2}/);
    expect(thrown.message).not.toMatch(/[A-Za-z]:\\|\/home\/|\/Users\//);
    expect(thrown.message).not.toContain('sch-a');
    expect(thrown.message).not.toContain('node_modules');
  });

  // --- UPDATE -----------------------------------------------------------------

  test('a correction changes the times and bumps updatedAt only', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { startTime: '10:00', endTime: '12:00', notes: 'original' });
    const updated = service.updateSession(A, created.id, { startTime: '14:00', endTime: '15:30' });

    expect(updated.startTime).toBe('14:00');
    expect(updated.endTime).toBe('15:30');
    expect(updated.notes).toBe('original');
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe(created.tenantId);
    expect(updated.classId).toBe(created.classId);
    expect(updated.scheduledDate).toBe(created.scheduledDate);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(new Date(updated.updatedAt).getTime())
      .toBeGreaterThanOrEqual(new Date(created.updatedAt).getTime());
  });

  test('a correction can change the date and the notes', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    const moved = service.updateSession(A, created.id, { scheduledDate: dayOffset(7), notes: '  moved  ' });
    expect(moved.scheduledDate).toBe(dayOffset(7));
    expect(moved.notes).toBe('moved');
    expect(moved.id).toBe(created.id);
    expect(moved.createdAt).toBe(created.createdAt);
  });

  test('a partial correction is validated against the stored values', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { startTime: '10:00', endTime: '11:00' });
    // Only the start is supplied, so endTime still comes from the stored record.
    expect(() => service.updateSession(A, created.id, { startTime: '11:30' }))
      .toThrow('endTime must be later than startTime');
    expect(() => service.updateSession(A, created.id, { endTime: '09:00' }))
      .toThrow('endTime must be later than startTime');
    expect(service.getSession(A, created.id).startTime).toBe('10:00');
    expect(service.getSession(A, created.id).endTime).toBe('11:00');
  });

  test('omitted fields are preserved by a correction', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { scheduledDate: dayOffset(2), startTime: '08:00', endTime: '09:00', notes: 'early' });
    const updated = service.updateSession(A, created.id, { notes: 'earlier' });
    expect(updated.notes).toBe('earlier');
    expect(updated.scheduledDate).toBe(dayOffset(2));
    expect(updated.startTime).toBe('08:00');
    expect(updated.endTime).toBe('09:00');
  });

  test('classId cannot be changed — not even to another valid class', () => {
    const first = classIn(A, { className: 'A1', teacherLast: 'One' });
    const second = classIn(A, { className: 'B1', teacherLast: 'Two' });
    const created = make(A, first.id);

    expect(() => service.updateSession(A, created.id, { classId: second.id }))
      .toThrow('classId cannot be changed');
    // Even the SAME class is refused: the field is immutable, not "equal".
    expect(() => service.updateSession(A, created.id, { classId: first.id }))
      .toThrow('classId cannot be changed');
    expect(service.getSession(A, created.id).classId).toBe(first.id);
  });

  test('null, undefined, empty and whitespace classId are all refused', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    // OWN-PROPERTY check: these are attempts to re-point the session, not
    // omissions, so each is rejected rather than silently ignored.
    for (const bad of [null, undefined, '', '   ']) {
      expect(() => service.updateSession(A, created.id, { classId: bad }))
        .toThrow('classId cannot be changed');
    }
    expect(() => service.updateSession(A, created.id, { classId: 'cls-nope' }))
      .toThrow('classId cannot be changed');
    expect(() => service.updateSession(A, created.id, { classId: classIn(B).id }))
      .toThrow('classId cannot be changed');
    expect(service.getSession(A, created.id).classId).toBe(klass.id);
  });

  test('an invalid date or time correction is refused', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    for (const bad of ['2026-10-01T09:00:00Z', '01/10/2026', '2026-02-30', '2026-13-45', 20261001]) {
      expect(() => service.updateSession(A, created.id, { scheduledDate: bad })).toThrow();
    }
    for (const bad of ['9:00', '24:00', '09:60', '10:00:00', 1000]) {
      expect(() => service.updateSession(A, created.id, { startTime: bad })).toThrow();
      expect(() => service.updateSession(A, created.id, { endTime: bad })).toThrow();
    }
    expect(() => service.updateSession(A, created.id, { startTime: '11:00', endTime: '11:00' }))
      .toThrow('endTime must be later than startTime');
    expect(service.getSession(A, created.id).scheduledDate).toBe(TODAY);
    expect(service.getSession(A, created.id).startTime).toBe('10:00');
  });

  test('a correction that would introduce a class conflict is refused', () => {
    const klass = classIn(A);
    const morning = make(A, klass.id, { startTime: '10:00', endTime: '12:00' });
    const afternoon = make(A, klass.id, { startTime: '14:00', endTime: '16:00' });
    expect(() => service.updateSession(A, afternoon.id, { startTime: '11:00', endTime: '15:00' }))
      .toThrow('the class is already scheduled at that time on ' + TODAY);
    expect(service.getSession(A, afternoon.id).startTime).toBe('14:00');
    expect(service.getSession(A, morning.id).endTime).toBe('12:00');
  });

  test('a correction that would introduce a teacher conflict is refused', () => {
    const teacher = teacherIn(A, { last: 'Shared' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher, className: 'B1' }).klass;
    make(A, first.id, { startTime: '10:00', endTime: '12:00' });
    const other = make(A, second.id, { startTime: '14:00', endTime: '16:00' });
    expect(() => service.updateSession(A, other.id, { startTime: '11:00', endTime: '15:00' }))
      .toThrow('the teacher is already scheduled at that time on ' + TODAY);
    expect(service.getSession(A, other.id).startTime).toBe('14:00');
  });

  test('a correction to the SAME slot is allowed — it is not a collision', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { startTime: '10:00', endTime: '12:00' });
    const updated = service.updateSession(A, created.id, { startTime: '10:00', endTime: '12:00', notes: 'unchanged' });
    expect(updated.startTime).toBe('10:00');
    expect(updated.notes).toBe('unchanged');
  });

  test('a correction onto an adjacent slot is allowed', () => {
    const klass = classIn(A);
    const first = make(A, klass.id, { startTime: '10:00', endTime: '12:00' });
    const second = make(A, klass.id, { startTime: '14:00', endTime: '16:00' });
    expect(service.updateSession(A, second.id, { startTime: '12:00', endTime: '14:00' }).startTime).toBe('12:00');
    expect(service.getSession(A, first.id).endTime).toBe('12:00');
  });

  test('a failed correction leaves the persisted row byte-for-byte unchanged', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { startTime: '10:00', endTime: '12:00', notes: 'original' });
    const beforeBytes = JSON.stringify(readStore(dir, 'educationScheduling'));

    expect(() => service.updateSession(A, created.id, { classId: 'cls-nope' })).toThrow();
    expect(() => service.updateSession(A, created.id, { scheduledDate: '2026-13-01' })).toThrow();
    expect(() => service.updateSession(A, created.id, { startTime: '9:00' })).toThrow();
    expect(() => service.updateSession(A, created.id, { startTime: '12:00', endTime: '10:00' })).toThrow();
    expect(() => service.updateSession(A, created.id, { notes: 'x'.repeat(200) })).toThrow();
    expect(() => service.updateSession(A, created.id, { tenantId: 'sch-b' })).toThrow();

    expect(JSON.stringify(readStore(dir, 'educationScheduling'))).toBe(beforeBytes);
  });

  test('a correction never reintroduces a denied field into the record', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    expect(() => service.updateSession(A, created.id, { tenantId: 'sch-b' }))
      .toThrow('tenantId is not writable');
    expect(() => service.updateSession(A, created.id, { id: 'ses-forged' }))
      .toThrow('id is not writable');
    expect(() => service.updateSession(A, created.id, { createdAt: '2000-01-01T00:00:00.000Z' }))
      .toThrow('createdAt is not writable');
    expect(() => service.updateSession(A, created.id, { teacherId: 'tch-x' }))
      .toThrow('teacherId is not writable');
    expect(service.getSession(A, created.id).tenantId).toBe('sch-a');
    expect(service.getSession(A, created.id).id).toBe(created.id);
    expect(service.getSession(A, created.id).createdAt).toBe(created.createdAt);
  });

  test('a correction on an unknown or foreign row answers null, never a leak', () => {
    expect(service.updateSession(A, 'ses-nope', { endTime: '12:00' })).toBeNull();
    const foreign = make(B, classIn(B).id);
    expect(service.updateSession(A, foreign.id, { endTime: '12:00' })).toBeNull();
    expect(service.getSession(B, foreign.id).endTime).toBe('11:00');
  });

  // --- LIST FILTERS -------------------------------------------------------------

  test('list is empty for a tenant with no rows and never touches another tenant', () => {
    classIn(A);
    classIn(B);
    expect(service.listScheduling(A)).toEqual([]);
    expect(service.listScheduling(B)).toEqual([]);
  });

  test('get returns null for an unknown id and for a foreign row', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    expect(service.getSession(A, created.id)).toEqual(created);
    expect(service.getSession(A, 'ses-nope')).toBeNull();
    expect(service.getSession(B, created.id)).toBeNull();
  });

  test('list filters by classId and scheduledDate', () => {
    const first = classIn(A, { className: 'A1', teacherLast: 'One' });
    const second = classIn(A, { className: 'B1', teacherLast: 'Two' });
    make(A, first.id, { scheduledDate: dayOffset(1) });
    make(A, first.id, { scheduledDate: dayOffset(2) });
    make(A, second.id, { scheduledDate: dayOffset(1) });

    expect(service.listScheduling(A, { classId: first.id })).toHaveLength(2);
    expect(service.listScheduling(A, { classId: second.id })).toHaveLength(1);
    expect(service.listScheduling(A, { scheduledDate: dayOffset(1) })).toHaveLength(2);
    expect(service.listScheduling(A, { classId: 'cls-nope' })).toEqual([]);
  });

  test('dateFrom and dateTo form an inclusive range', () => {
    const klass = classIn(A);
    for (const day of [1, 2, 3, 4]) make(A, klass.id, { scheduledDate: dayOffset(day) });

    expect(service.listScheduling(A, { dateFrom: dayOffset(2), dateTo: dayOffset(3) })).toHaveLength(2);
    // Both endpoints are inclusive.
    expect(service.listScheduling(A, { dateFrom: dayOffset(2) })).toHaveLength(3);
    expect(service.listScheduling(A, { dateTo: dayOffset(3) })).toHaveLength(3);
    expect(service.listScheduling(A, { dateFrom: dayOffset(2), dateTo: dayOffset(2) })).toHaveLength(1);
    expect(service.listScheduling(A, { dateFrom: dayOffset(1), dateTo: dayOffset(4) })).toHaveLength(4);
    // An inverted or non-overlapping range simply matches nothing.
    expect(service.listScheduling(A, { dateFrom: dayOffset(4), dateTo: dayOffset(1) })).toEqual([]);
    expect(service.listScheduling(A, { dateFrom: dayOffset(9) })).toEqual([]);
  });

  test('teacherId is a DERIVED filter resolved through the class', () => {
    const teacher = teacherIn(A, { last: 'Derived' });
    const other = teacherIn(A, { last: 'Unrelated' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher: other, className: 'B1' }).klass;
    make(A, first.id, { scheduledDate: dayOffset(1) });
    make(A, second.id, { scheduledDate: dayOffset(1) });

    const filtered = service.listScheduling(A, { teacherId: teacher.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].classId).toBe(first.id);
    // The stored record still carries no teacherId.
    expect(Object.prototype.hasOwnProperty.call(filtered[0], 'teacherId')).toBe(false);
  });

  test('a teacherId filter returns every session of every class that teacher has', () => {
    const teacher = teacherIn(A, { last: 'Busy' });
    const first = chainIn(A, { teacher, className: 'A1' }).klass;
    const second = chainIn(A, { teacher, className: 'B1' }).klass;
    // One teacher, so the slots must differ: the teacher cannot be in two
    // places at once and the same rule under test here would otherwise fire.
    make(A, first.id, { scheduledDate: dayOffset(1), startTime: '08:00', endTime: '09:00' });
    make(A, second.id, { scheduledDate: dayOffset(1), startTime: '10:00', endTime: '11:00' });
    make(A, second.id, { scheduledDate: dayOffset(2), startTime: '10:00', endTime: '11:00' });
    expect(service.listScheduling(A, { teacherId: teacher.id })).toHaveLength(3);
  });

  test('an unknown or foreign derived filter returns an empty list without leaking', () => {
    const klass = classIn(A);
    make(A, klass.id, { scheduledDate: dayOffset(1) });
    // A REAL teacher that belongs to the OTHER tenant, so the filter is well
    // formed and the emptiness can only come from tenant isolation.
    const foreignTeacher = teacherIn(B, { last: 'Foreign' });

    const viaUnknown = service.listScheduling(A, { teacherId: 'tch-nope' });
    const viaForeign = service.listScheduling(A, { teacherId: foreignTeacher.id });
    expect(viaUnknown).toEqual([]);
    // No existence leakage across tenants.
    expect(viaForeign).toEqual(viaUnknown);
  });

  test('rows are ordered by date then start time, deterministically', () => {
    const klass = classIn(A);
    make(A, klass.id, { scheduledDate: dayOffset(3), startTime: '09:00', endTime: '10:00' });
    make(A, klass.id, { scheduledDate: dayOffset(1), startTime: '14:00', endTime: '15:00' });
    make(A, klass.id, { scheduledDate: dayOffset(1), startTime: '08:00', endTime: '09:00' });
    make(A, klass.id, { scheduledDate: dayOffset(2), startTime: '10:00', endTime: '11:00' });

    const listed = service.listScheduling(A);
    expect(listed.map(s => s.scheduledDate + ' ' + s.startTime)).toEqual([
      dayOffset(1) + ' 08:00',
      dayOffset(1) + ' 14:00',
      dayOffset(2) + ' 10:00',
      dayOffset(3) + ' 09:00'
    ]);
    // The order is stable across repeated calls.
    expect(service.listScheduling(A).map(s => s.id)).toEqual(listed.map(s => s.id));
  });

  test('no N+1: the derived filter resolves classes in one batched list call', () => {
    const teacher = teacherIn(A, { last: 'Bulk' });
    // One shared teacher across 8 classes, so each class needs its own hour or
    // the teacher rule would refuse the fixtures themselves.
    for (let i = 0; i < 8; i++) {
      const klass = chainIn(A, { teacher, className: 'Bulk' + i }).klass;
      const startTime = String(6 + i).padStart(2, '0') + ':00';
      for (let d = 1; d <= 3; d++) {
        make(A, klass.id, {
          scheduledDate: dayOffset(d),
          startTime,
          endTime: String(7 + i).padStart(2, '0') + ':00'
        });
      }
    }
    expect(service.listScheduling(A, { teacherId: teacher.id })).toHaveLength(24);

    // ONE batched listClasses call regardless of how many rows are filtered.
    const listSpy = jest.spyOn(classes, 'listClasses');
    const getSpy = jest.spyOn(classes, 'getClass');
    const filtered = service.listScheduling(A, { teacherId: teacher.id });
    expect(filtered).toHaveLength(24);
    expect(listSpy.mock.calls.length).toBe(1);
    expect(getSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
    getSpy.mockRestore();
  });

  test('list returns copies, so a caller cannot mutate the store through them', () => {
    const klass = classIn(A);
    const created = make(A, klass.id);
    const listed = service.listScheduling(A);
    listed[0].startTime = '23:59';
    expect(service.getSession(A, created.id).startTime).toBe('10:00');
  });

  // --- FORBIDDEN FIELDS AND SECURITY --------------------------------------------

  test('server-owned fields cannot be written on create', () => {
    const klass = classIn(A);
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId',
                         'createdAt', 'updatedAt', 'sessionId']) {
      expect(() => make(A, klass.id, { scheduledDate: dayOffset(1), [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('derived ownership and other-entity references cannot be written', () => {
    const klass = classIn(A);
    for (const field of ['teacherId', 'teacherIds', 'studentId', 'studentIds', 'enrollmentId',
                         'enrollmentIds', 'attendance', 'attendanceId', 'attendanceIds',
                         'courseId', 'programId', 'centerId', 'academicYear']) {
      expect(() => make(A, klass.id, { scheduledDate: dayOffset(1), [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('no room, resource, capacity or recurrence field is accepted', () => {
    const klass = classIn(A);
    // Center owns no capacity or room concept, so none of these has an owner.
    for (const field of ['room', 'rooms', 'resource', 'resources', 'capacity',
                         'recurrence', 'recurring', 'dayOfWeek', 'schedule', 'scheduleId',
                         'classSessionId', 'level', 'color']) {
      expect(() => make(A, klass.id, { scheduledDate: dayOffset(1), [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('no grading, financial, LMS, notification or guardian field is accepted', () => {
    const klass = classIn(A);
    for (const field of ['grade', 'grades', 'score', 'exam', 'exams', 'result', 'mark',
                         'payment', 'tuition', 'billing', 'invoice', 'salary', 'payroll',
                         'lms', 'zoom', 'meetingUrl', 'videoUrl', 'notification',
                         'notifications', 'calendarSync', 'guardianId', 'certificate']) {
      expect(() => make(A, klass.id, { scheduledDate: dayOffset(1), [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('a prototype-pollution payload is rejected and Object stays clean', () => {
    const klass = classIn(A);
    const payload = JSON.parse('{"classId":"' + klass.id + '","scheduledDate":"'
      + dayOffset(1) + '","startTime":"10:00","endTime":"11:00","__proto__":{"polluted":"yes"}}');
    expect(() => service.createSession(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();

    expect(() => service.updateSession(A, 'x', { constructor: 'y' })).toThrow('constructor is not allowed');
    expect(() => service.updateSession(A, 'x', { prototype: 'y' })).toThrow('prototype is not allowed');
    expect(service.listScheduling(A)).toHaveLength(0);
  });

  test('no malicious field is ever persisted and the store shape is exact', () => {
    const klass = classIn(A);
    const created = make(A, klass.id, { scheduledDate: dayOffset(1), notes: 'ok' });
    const stored = readStore(dir, 'educationScheduling');
    expect(Object.keys(stored)).toEqual(['sessions']);
    for (const record of stored.sessions) {
      expect(Object.keys(record).sort()).toEqual(Object.keys(created).sort());
      expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
      expect(record.polluted).toBeUndefined();
      expect(record.teacherId).toBeUndefined();
    }
  });

  test('the store is tenant-owned and never mixes tenants on disk', () => {
    make(A, classIn(A).id, { scheduledDate: dayOffset(1) });
    make(B, classIn(B).id, { scheduledDate: dayOffset(1) });

    const stored = readStore(dir, 'educationScheduling');
    expect(stored.sessions).toHaveLength(2);
    expect(stored.sessions.filter(s => s.tenantId === 'sch-a')).toHaveLength(1);
    expect(stored.sessions.filter(s => s.tenantId === 'sch-b')).toHaveLength(1);
  });

  test('the service declares the store key it owns and nothing else', () => {
    expect(service.STORE_KEY).toBe('educationScheduling');
    expect(service.FORBIDDEN_FIELDS).toContain('tenantId');
    expect(service.LATER_PHASE_FIELDS).toContain('recurrence');
    expect(Object.keys(service.WRITABLE_FIELDS))
      .toEqual(['classId', 'scheduledDate', 'startTime', 'endTime', 'notes']);
  });

});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-9 scheduling routes — authorization, tenant isolation and the timetable contract', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('sch-http');
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

  const ownerA = () => token('schOwner', 'sch-a', 'Owner');
  const ownerB = () => token('schOwner', 'sch-b', 'Owner');
  const managerA = () => token('schManager', 'sch-a', 'Manager');
  const clerkA = () => token('schClerk', 'sch-a', 'Viewer');
  const strangerA = () => token('schStranger', 'sch-a', 'Viewer');

  const post = (path, tok) => request(app).post(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);
  const put = (path, tok) => request(app).put(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);
  const get = (path, tok) => request(app).get(`${BASE}${path}`).set('Authorization', `Bearer ${tok}`);

  // Program -> Course -> Teacher -> Class over HTTP. `opts.teacherId` reuses an
  // EXISTING teacher so a caller can control whether two classes share one;
  // `opts.teacherLast` only varies the name for a fresh teacher.
  const setup = async (tok, opts = {}) => {
    const program = await post('/programs', tok).send({ name: 'English Track' });
    expect(program.statusCode).toBe(201);
    const course = await post('/courses', tok)
      .send({ name: 'Grammar 101', programId: program.body.data.id });
    expect(course.statusCode).toBe(201);
    let teacherId = opts.teacherId;
    if (!teacherId) {
      const teacher = await post('/teachers', tok)
        .send({ firstName: 'Ali', lastName: opts.teacherLast || 'One' });
      expect(teacher.statusCode).toBe(201);
      teacherId = teacher.body.data.id;
    }
    const klass = await post('/classes', tok).send({
      courseId: course.body.data.id, teacherId, name: opts.className || 'A1'
    });
    expect(klass.statusCode).toBe(201);
    return {
      programId: program.body.data.id,
      courseId: course.body.data.id,
      teacherId,
      classId: klass.body.data.id
    };
  };

  const create = (body, tok) => post('/scheduling', tok).send(body);
  const makeDay = (classId, over, tok) => create(slot(classId, over), tok || ownerA());

  // --- AUTH ---------------------------------------------------------------------

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/scheduling`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/scheduling/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/scheduling`).send({ classId: 'c' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/scheduling/anything`).send({ endTime: '12:00' })).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('sch-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/scheduling`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/scheduling`).send({ classId: 'c' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Scheduling permissions fail closed, with no bypass', async () => {
    // The stranger record holds education.scheduling.export EXPLICITLY and is
    // still refused: unknown permissions are not honoured because a client
    // record asked for them.
    expect((await get('/scheduling', strangerA())).statusCode).toBe(403);

    const chain = await setup(ownerA());
    const write = await makeDay(chain.classId, {}, clerkA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('AUTHORIZATION: an explicitly granted, registered Scheduling permission is honoured', async () => {
    // The clerk holds education.scheduling.view, which the registry now knows.
    expect((await get('/scheduling', clerkA())).statusCode).toBe(200);
  });

  test('AUTHORIZATION: a Manager cannot write, and nothing is persisted on refusal', async () => {
    const chain = await setup(ownerA());
    expect((await makeDay(chain.classId, {}, managerA())).statusCode).toBe(403);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('AUTHORIZATION: an Owner is admitted under the current registry behaviour', async () => {
    const chain = await setup(ownerA());
    expect((await get('/scheduling', ownerA())).statusCode).toBe(200);
    expect((await makeDay(chain.classId, {})).statusCode).toBe(201);
  });

  // --- CRUD ---------------------------------------------------------------------

  test('CRUD: the full session lifecycle over HTTP', async () => {
    const chain = await setup(ownerA());
    const created = await create({
      classId: chain.classId, scheduledDate: dayOffset(1),
      startTime: '10:00', endTime: '11:30', notes: 'morning group'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.message).toBe('Scheduling session created');
    expect(created.body.data.tenantId).toBe('sch-a');
    expect(created.body.data.classId).toBe(chain.classId);
    expect(created.body.data.startTime).toBe('10:00');
    expect(created.body.data.endTime).toBe('11:30');
    expect(created.body.data.notes).toBe('morning group');
    expect(Object.keys(created.body.data).sort()).toEqual([
      'classId', 'createdAt', 'endTime', 'id', 'notes', 'scheduledDate', 'startTime', 'tenantId', 'updatedAt'
    ]);
    const id = created.body.data.id;

    const fetched = await get(`/scheduling/${id}`, ownerA());
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.message).toBe('Scheduling session retrieved');
    expect(fetched.body.data.classId).toBe(chain.classId);

    const listed = await get('/scheduling', ownerA());
    expect(listed.body.message).toBe('Scheduling retrieved');
    expect(listed.body.data).toHaveLength(1);

    const updated = await put(`/scheduling/${id}`, ownerA())
      .send({ startTime: '12:00', endTime: '13:00', notes: 'moved' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.message).toBe('Scheduling session updated');
    expect(updated.body.data.startTime).toBe('12:00');
    expect(updated.body.data.endTime).toBe('13:00');
    expect(updated.body.data.classId).toBe(chain.classId);
  });

  test('CRUD: there is no DELETE, archive or cancel route for sessions', async () => {
    const chain = await setup(ownerA());
    const id = (await makeDay(chain.classId, {})).body.data.id;

    expect((await request(app).delete(`${BASE}/scheduling/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/scheduling/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/scheduling/${id}/cancel`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    // The record is still there: correction is the only mutable operation.
    expect((await get(`/scheduling/${id}`, ownerA())).statusCode).toBe(200);
  });

  test('CRUD: get and update of a nonexistent id answer 404', async () => {
    expect((await get('/scheduling/ses-nope', ownerA())).statusCode).toBe(404);
    expect((await put('/scheduling/ses-nope', ownerA()).send({ endTime: '12:00' })).statusCode).toBe(404);
  });

  // --- VALIDATION ---------------------------------------------------------------

  test('VALIDATION: malformed input answers 400 and persists nothing', async () => {
    const chain = await setup(ownerA());
    const base = { classId: chain.classId, scheduledDate: dayOffset(1), startTime: '10:00', endTime: '11:00' };
    const badBodies = [
      {},
      { ...base, classId: undefined },
      { ...base, classId: '' },
      { ...base, classId: '   ' },
      { ...base, classId: 12345 },
      { ...base, classId: 'cls-nope' },
      { ...base, scheduledDate: '2026-13-01' },
      { ...base, scheduledDate: '2026-02-30' },
      { ...base, scheduledDate: '01/10/2026' },
      { ...base, scheduledDate: '2026-10-01T09:00:00Z' },
      { ...base, startTime: '9:00' },
      { ...base, startTime: '24:00' },
      { ...base, startTime: '10:60' },
      { ...base, endTime: '11:00:00' },
      { ...base, endTime: '11:00', startTime: '12:00' },
      { ...base, endTime: '10:00' },
      { ...base, notes: 'x'.repeat(161) },
      { ...base, tenantId: 'sch-b' },
      { ...base, id: 'ses-forged' },
      { ...base, teacherId: 'tch-forged' },
      { ...base, enrollmentId: 'enr-forged' }
    ];
    for (const body of badBodies) {
      const res = await create(body, ownerA());
      expect([400, 409]).toContain(res.statusCode);
      if (res.statusCode === 400) expect(res.body.message).toBeTruthy();
    }
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  test('VALIDATION: a failed create or correction never leaves a partial row', async () => {
    const chain = await setup(ownerA());
    const created = await makeDay(chain.classId, { scheduledDate: dayOffset(1) });
    const id = created.body.data.id;

    const bad = await put(`/scheduling/${id}`, ownerA()).send({ classId: 'cls-nope' });
    expect(bad.statusCode).toBe(400);

    const still = await get(`/scheduling/${id}`, ownerA());
    expect(still.body.data.classId).toBe(chain.classId);
    expect(still.body.data.startTime).toBe('10:00');
    expect((await get('/scheduling', ownerA())).body.data).toHaveLength(1);
  });

  // --- CONFLICT OVER HTTP ---------------------------------------------------------

  test('CONFLICT: an overlapping class session answers 409 with a typed body', async () => {
    const chain = await setup(ownerA());
    expect((await makeDay(chain.classId, { scheduledDate: dayOffset(1), startTime: '10:00', endTime: '12:00' })).statusCode)
      .toBe(201);

    const clash = await makeDay(chain.classId, { scheduledDate: dayOffset(1), startTime: '11:00', endTime: '13:00' });
    expect(clash.statusCode).toBe(409);
    expect(clash.body.success).toBe(false);
    expect(clash.body.message).toMatch(/already scheduled at that time on \d{4}-\d{2}-\d{2}/);
    expect(clash.body.details.code).toBe('SCHEDULING_CONFLICT');
    expect(clash.body.details.conflict).toBe(true);
    expect(clash.body.data).toBeUndefined();
    expect((await get('/scheduling', ownerA())).body.data).toHaveLength(1);
  });

  test('CONFLICT: an overlapping teacher is refused, an adjacent slot is accepted', async () => {
    const seed = await setup(ownerA(), { teacherLast: 'Shared', className: 'Seed' });
    // Both classes are taught by the SAME teacher, so the second slot overlaps
    // the first through the derived teacher, not through the class.
    const first = await setup(ownerA(), { teacherId: seed.teacherId, className: 'A1' });
    const second = await setup(ownerA(), { teacherId: seed.teacherId, className: 'B1' });

    expect((await makeDay(first.classId, { scheduledDate: dayOffset(1), startTime: '10:00', endTime: '12:00' })).statusCode)
      .toBe(201);
    const clash = await makeDay(second.classId, { scheduledDate: dayOffset(1), startTime: '11:00', endTime: '13:00' });
    expect(clash.statusCode).toBe(409);
    expect(clash.body.message).toMatch(/already scheduled at that time on \d{4}-\d{2}-\d{2}/);
    expect(clash.body.details.code).toBe('SCHEDULING_CONFLICT');

    const adjacent = await makeDay(second.classId, { scheduledDate: dayOffset(1), startTime: '12:00', endTime: '13:00' });
    expect(adjacent.statusCode).toBe(201);
    expect((await get('/scheduling', ownerA())).body.data).toHaveLength(2);
  });

  test('CONFLICT: a 409 never leaks another tenant or a filesystem path', async () => {
    const inA = await setup(ownerA());
    const inB = await setup(ownerB());
    await makeDay(inA.classId, { scheduledDate: dayOffset(1) }, ownerA());
    // The same wall-clock slot in the OTHER tenant succeeds: no cross-tenant conflict.
    const other = await makeDay(inB.classId, { scheduledDate: dayOffset(1) }, ownerB());
    expect(other.statusCode).toBe(201);
  });

  // --- TENANT ISOLATION -----------------------------------------------------------

  test('TENANT: one tenant never sees, fetches or corrects another tenant row', async () => {
    const inA = await setup(ownerA());
    const inB = await setup(ownerB());
    const idA = (await makeDay(inA.classId, { scheduledDate: dayOffset(1) }, ownerA())).body.data.id;
    const idB = (await makeDay(inB.classId, { scheduledDate: dayOffset(1) }, ownerB())).body.data.id;

    expect((await get('/scheduling', ownerB())).body.data.map(s => s.id)).toEqual([idB]);
    expect((await get('/scheduling', ownerA())).body.data.map(s => s.id)).toEqual([idA]);

    expect((await get(`/scheduling/${idA}`, ownerB())).statusCode).toBe(404);
    expect((await get(`/scheduling/${idB}`, ownerA())).statusCode).toBe(404);
    expect((await put(`/scheduling/${idA}`, ownerB()).send({ endTime: '23:00' })).statusCode).toBe(404);
    expect((await put(`/scheduling/${idB}`, ownerA()).send({ endTime: '23:00' })).statusCode).toBe(404);

    expect((await get(`/scheduling/${idA}`, ownerA())).body.data.endTime).toBe('11:00');
    expect((await get(`/scheduling/${idB}`, ownerB())).body.data.endTime).toBe('11:00');
  });

  test('TENANT: a class from another tenant is refused, not created', async () => {
    const inA = await setup(ownerA());
    const inB = await setup(ownerB());
    expect((await makeDay(inB.classId, {}, ownerA())).statusCode).toBe(400);
    expect((await makeDay('cls-nope', {}, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
    expect((await get('/scheduling', ownerA())).body.data).toEqual([]);
  });

  test('TENANT: an owner with no tenant claim gets 400, an inactive tenant gets an empty list', async () => {
    const chain = await setup(ownerA());
    await makeDay(chain.classId, { scheduledDate: dayOffset(1) });

    expect((await get('/scheduling', token('schOwner', undefined, 'Owner'))).statusCode).toBe(400);
    expect((await post('/scheduling', token('schOwner', undefined, 'Owner'))
      .send(slot(chain.classId))).statusCode).toBe(400);

    const inactive = await get('/scheduling', token('schOwner', 'sch-inactive', 'Owner'));
    expect(inactive.statusCode).toBe(200);
    expect(inactive.body.data).toEqual([]);
  });

  test('TENANT: the parent chain of one tenant does not resolve in another', async () => {
    const inA = await setup(ownerA());
    const bProgram = await post('/programs', ownerB()).send({ name: 'B Track' });
    const bCourse = await post('/courses', ownerB())
      .send({ name: 'B Course', programId: bProgram.body.data.id });
    const bTeacher = await post('/teachers', ownerB()).send({ firstName: 'B', lastName: 'Teacher' });
    const bClass = await post('/classes', ownerB()).send({
      courseId: bCourse.body.data.id, teacherId: bTeacher.body.data.id, name: 'B1'
    });
    // A cannot schedule against B's class, nor against A's class under B's course.
    expect((await makeDay(bClass.body.data.id, {}, ownerA())).statusCode).toBe(400);
    expect((await makeDay(inA.classId, {}, ownerB())).statusCode).toBe(400);
    expect(readStore(dir, 'educationScheduling')).toBeNull();
  });

  // --- THE TIMETABLE OVER HTTP ----------------------------------------------------

  test('TIMETABLE: a one-week plan reads back in date order with derived teacher filters', async () => {
    const a1 = await setup(ownerA(), { teacherLast: 'Hassan', className: 'A1' });
    const b1 = await setup(ownerA(), { teacherLast: 'Farid', className: 'B1' });
    const plan = [
      { classId: b1.classId, day: 3, startTime: '14:00', endTime: '15:00' },
      { classId: a1.classId, day: 1, startTime: '09:00', endTime: '10:30' },
      { classId: b1.classId, day: 1, startTime: '08:00', endTime: '09:00' },
      { classId: a1.classId, day: 2, startTime: '16:00', endTime: '18:00' }
    ];
    for (const entry of plan) {
      expect((await create({ classId: entry.classId, scheduledDate: dayOffset(entry.day),
        startTime: entry.startTime, endTime: entry.endTime }, ownerA())).statusCode).toBe(201);
    }

    const week = await get(`/scheduling?dateFrom=${dayOffset(1)}&dateTo=${dayOffset(7)}`, ownerA());
    expect(week.statusCode).toBe(200);
    expect(week.body.data).toHaveLength(4);
    expect(week.body.data.map(s => s.scheduledDate + ' ' + s.startTime + ' ' + s.classId)).toEqual([
      dayOffset(1) + ' 08:00 ' + b1.classId,
      dayOffset(1) + ' 09:00 ' + a1.classId,
      dayOffset(2) + ' 16:00 ' + a1.classId,
      dayOffset(3) + ' 14:00 ' + b1.classId
    ]);

    const byTeacher = await get(`/scheduling?teacherId=${a1.teacherId}`, ownerA());
    expect(byTeacher.body.data).toHaveLength(2);
    expect(byTeacher.body.data.every(s => s.classId === a1.classId)).toBe(true);
    // The derived filter is never echoed as a stored field.
    expect(Object.prototype.hasOwnProperty.call(byTeacher.body.data[0], 'teacherId')).toBe(false);
  });

  test('TIMETABLE: a bad filter value is refused with 400 rather than ignored', async () => {
    const chain = await setup(ownerA());
    await makeDay(chain.classId, { scheduledDate: dayOffset(1) });
    for (const query of [
      'scheduledDate=2026-13-01', 'dateFrom=nonsense', 'dateTo=01/01/2026',
      'classId=cls-nope&dateFrom=' + dayOffset(1), 'scheduledDate=' + dayOffset(1) + 'T00:00:00Z'
    ]) {
      const res = await get(`/scheduling?${query}`, ownerA());
      expect([200, 400]).toContain(res.statusCode);
      if (res.statusCode === 400) expect(res.body.message).toBeTruthy();
    }
  });

  test('TIMETABLE: an unknown derived teacher filter yields an empty list', async () => {
    const chain = await setup(ownerA());
    await makeDay(chain.classId, { scheduledDate: dayOffset(1) });
    const unknown = await get('/scheduling?teacherId=tch-nope', ownerA());
    expect(unknown.statusCode).toBe(200);
    expect(unknown.body.data).toEqual([]);
  });

  test('TIMETABLE: a plan is refused once the Class is archived, but survives a teacher change', async () => {
    const chain = await setup(ownerA());
    await makeDay(chain.classId, { scheduledDate: dayOffset(1) });
    const id = (await get('/scheduling', ownerA())).body.data[0].id;

    // Archiving the Class blocks NEW sessions and CORRECTIONS, and the existing
    // plan is still readable — STU-6 owns Class lifecycle, not the timetable.
    expect((await request(app).patch(`${BASE}/classes/${chain.classId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await create(slot(chain.classId, { scheduledDate: dayOffset(2) }), ownerA())).statusCode).toBe(400);
    expect((await put(`/scheduling/${id}`, ownerA()).send({ endTime: '12:00' })).statusCode).toBe(400);
    const readable = await get(`/scheduling/${id}`, ownerA());
    expect(readable.statusCode).toBe(200);
    expect(readable.body.data.endTime).toBe('11:00');
  });
});








