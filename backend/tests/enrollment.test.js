'use strict';

// STU-7 Education Enrollment records — regression suite (Device 2).
//
// Enrollment is the RELATIONSHIP between a Student and a Class, and this suite
// pins the three contracts STU-7 locks down:
//
//   1. IMMUTABILITY. `studentId` and `classId` are a historical fact. They are
//      never reassigned and never cleared — not even to another same-tenant
//      pair. Moving a student is `withdraw` + `create`, never an edit. The
//      omitted-vs-supplied distinction is made with an own-property check, so
//      null, undefined, '' and whitespace are all caught as attempts to change
//      the relationship rather than mistaken for an omission.
//   2. LIFECYCLE. Exactly `active` and `withdrawn`. No inactive, no archived, no
//      financial/grading/scheduling state. Withdrawal is non-destructive and
//      idempotent, and a repeated withdrawal must NOT move the original
//      `withdrawnAt`.
//   3. UNIQUENESS. At most one ACTIVE enrollment per (tenant, student, class).
//      Withdrawal releases the pair; re-enrollment appends a NEW row and leaves
//      the withdrawn one intact.
//
// It also pins what the Enrollment deliberately does NOT do: it never re-walks
// the Class chain. A Course, Program, Teacher or Center may be archived behind a
// still-valid Class and existing AND new Enrollments are unaffected.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore, listStores } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'enr-a', name: 'Enrollment Tenant A', code: 'ENRA', active: true },
  { id: 'enr-b', name: 'Enrollment Tenant B', code: 'ENRB', active: true },
  { id: 'enr-retired', name: 'Retired Enrollment Tenant', code: 'ENRR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'enrOwner', password, role: 'Owner', fullName: 'Enrollment Owner',
      tenantIds: ['enr-a', 'enr-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Enrollment permissions EXPLICITLY, so
      // the suite proves a registered, explicitly granted permission is honoured.
      id: 'u-clerk', username: 'enrClerk', password, role: 'Viewer', fullName: 'Enrollment Clerk',
      permissions: ['education.enrollments.view', 'education.enrollments.edit'],
      tenantIds: ['enr-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding an Enrollment permission the registry does
      // NOT know, so the suite proves an unregistered permission still fails
      // closed rather than being honoured because a client record asked for it.
      id: 'u-stranger', username: 'enrStranger', password, role: 'Viewer', fullName: 'Enrollment Stranger',
      permissions: ['education.enrollments.export'],
      tenantIds: ['enr-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'enrManager', password, role: 'Manager', fullName: 'Enrollment Manager',
      tenantIds: ['enr-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-7 enrollment.service — immutable relationship, lifecycle and uniqueness', () => {
  let dir;
  let service;
  let students;
  let classes;
  let courses;
  let programs;
  let teachers;
  let centers;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('enr-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/enrollment.service');
    students = require('../services/student.service');
    classes = require('../services/class.service');
    courses = require('../services/course.service');
    programs = require('../services/program.service');
    teachers = require('../services/teacher.service');
    centers = require('../services/center.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'enr-a' };
  const B = { tenantId: 'enr-b' };

  // NOTE: the parent services treat an explicitly-present `undefined` as a
  // supplied non-string value, so these helpers only ever include a key when a
  // real value is given.
  const studentIn = (ctx, opts = {}) => {
    const input = { firstName: opts.first || 'Nadia', lastName: opts.last || 'Hassan' };
    if (opts.status) input.status = opts.status;
    return students.createStudent(ctx, input);
  };

  const teacherIn = (ctx, opts = {}) => {
    const input = { firstName: 'Ali', lastName: opts.last || 'One' };
    if (opts.status) input.status = opts.status;
    return teachers.createTeacher(ctx, input);
  };

  // Builds Center -> Program -> Course -> Class plus a Teacher in one tenant.
  // `opts.centerId` is optional and `opts.classStatus` may be 'inactive'.
  const chainIn = (ctx, opts = {}) => {
    const programInput = { name: opts.programName || 'English Track' };
    if (opts.centerId) programInput.centerId = opts.centerId;
    const program = programs.createProgram(ctx, programInput);
    const course = courses.createCourse(ctx, { programId: program.id, name: opts.courseName || 'Grammar 101' });
    const teacher = teacherIn(ctx, { last: opts.teacherLast || 'One' });
    const classInput = { courseId: course.id, teacherId: teacher.id, name: opts.className || 'A1' };
    if (opts.classStatus) classInput.status = opts.classStatus;
    const klass = classes.createClass(ctx, classInput);
    return { program, course, teacher, klass };
  };

  // A ready-to-use (student, class) pair in one tenant.
  const pairIn = (ctx, opts = {}) => {
    const chain = chainIn(ctx, opts);
    const student = studentIn(ctx, { last: opts.studentLast || 'Hassan', status: opts.studentStatus });
    return { ...chain, student, classId: chain.klass.id };
  };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listEnrollments(null)).toThrow('Tenant context is required');
    expect(() => service.listEnrollments({})).toThrow('Tenant context is required');
    expect(() => service.getEnrollment(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createEnrollment(null, { studentId: 's', classId: 'c' })).toThrow('Tenant context is required');
    expect(() => service.updateEnrollment(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.withdrawEnrollment(null, 'x')).toThrow('Tenant context is required');
  });

  // --- MODEL ---------------------------------------------------------------

  test('create requires BOTH studentId and classId', () => {
    expect(() => service.createEnrollment(A, { classId: 'c' })).toThrow('studentId is required');
    expect(() => service.createEnrollment(A, { studentId: 's' })).toThrow('classId is required');
    expect(() => service.createEnrollment(A, { studentId: '  ', classId: 'c' })).toThrow('studentId is required');
    expect(() => service.createEnrollment(A, { studentId: 's', classId: '   ' })).toThrow('classId is required');
    expect(() => service.createEnrollment(A, 'nope')).toThrow('request body must be a JSON object');
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('create stamps a complete server-owned record', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId });

    expect(created.tenantId).toBe('enr-a');
    expect(created.studentId).toBe(student.id);
    expect(created.classId).toBe(classId);
    expect(created.status).toBe('active');
    expect(created.withdrawnAt).toBeNull();
    expect(created.notes).toBe('');
    expect(typeof created.id).toBe('string');
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.enrolledAt).toBe(created.createdAt);
    expect(created.updatedAt).toBe(created.createdAt);
    // Exactly the ten contracted keys — nothing speculative.
    expect(Object.keys(created).sort()).toEqual([
      'classId', 'createdAt', 'enrolledAt', 'id', 'notes',
      'status', 'studentId', 'tenantId', 'updatedAt', 'withdrawnAt'
    ]);
  });

  test('generated ids are unique across many enrollments', () => {
    const chain = chainIn(A);
    const ids = new Set();
    for (let i = 0; i < 5; i++) {
      const student = studentIn(A, { last: 'S' + i });
      ids.add(service.createEnrollment(A, { studentId: student.id, classId: chain.klass.id }).id);
    }
    expect(ids.size).toBe(5);
  });

  test('notes is optional, trimmed and length-capped by rejection', () => {
    const { student, classId } = pairIn(A);
    expect(service.createEnrollment(A, { studentId: student.id, classId }).notes).toBe('');

    const second = studentIn(A, { last: 'Second' });
    expect(service.createEnrollment(A, { studentId: second.id, classId, notes: '  moved from Cairo  ' }).notes)
      .toBe('moved from Cairo');

    const third = studentIn(A, { last: 'Third' });
    expect(() => service.createEnrollment(A, { studentId: third.id, classId, notes: 'x'.repeat(161) }))
      .toThrow('notes must be at most 160 characters');
    expect(service.createEnrollment(A, { studentId: third.id, classId, notes: 'y'.repeat(160) }).notes)
      .toHaveLength(160);
  });

  test('server-owned lifecycle fields cannot be client-controlled', () => {
    const { student, classId } = pairIn(A);
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt', 'updatedAt']) {
      expect(() => service.createEnrollment(A, { studentId: student.id, classId, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    // status, enrolledAt and withdrawnAt are server-owned too: an Enrollment is
    // never activated, retired or back-dated by a client write.
    for (const field of ['status', 'enrolledAt', 'withdrawnAt']) {
      expect(() => service.createEnrollment(A, { studentId: student.id, classId, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('no back-dating is possible and the server clock is authoritative', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId });
    const before = Date.now();
    expect(new Date(created.enrolledAt).getTime()).toBeGreaterThan(before - 60000);
    expect(new Date(created.enrolledAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    // Any attempt to rewrite it is refused outright.
    expect(() => service.updateEnrollment(A, created.id, { enrolledAt: '2000-01-01T00:00:00.000Z' }))
      .toThrow('enrolledAt is not writable');
    expect(() => service.updateEnrollment(A, created.id, { withdrawnAt: '2000-01-01T00:00:00.000Z' }))
      .toThrow('withdrawnAt is not writable');
    expect(service.getEnrollment(A, created.id).enrolledAt).toBe(created.enrolledAt);
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const { student, classId } = pairIn(A);
    const payload = JSON.parse('{"studentId":"' + student.id + '","classId":"' + classId + '","__proto__":{"polluted":"yes"}}');
    expect(() => service.createEnrollment(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();

    expect(() => service.updateEnrollment(A, 'x', { constructor: 'y' })).toThrow('constructor is not allowed');
    expect(() => service.updateEnrollment(A, 'x', { prototype: 'y' })).toThrow('prototype is not allowed');
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('no scheduling, grading, attendance or financial field is accepted', () => {
    const { student, classId } = pairIn(A);
    const futureFields = [
      'attendance', 'attendanceId', 'attendanceIds',
      'grade', 'grades', 'score', 'exam', 'exams', 'result', 'mark',
      'payment', 'tuition', 'billing', 'invoice', 'salary', 'payroll',
      'schedule', 'scheduling', 'dayOfWeek', 'startTime', 'endTime', 'room', 'recurrence',
      'capacity', 'certificate', 'guardianId', 'guardianIds'
    ];
    for (const field of futureFields) {
      expect(() => service.createEnrollment(A, { studentId: student.id, classId, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('duplicate-ownership and denormalization fields are refused', () => {
    const { student, classId } = pairIn(A);
    // Everything behind the Class is DERIVED through classId; a second
    // reference could silently disagree with the Class.
    for (const field of ['courseId', 'programId', 'teacherId', 'centerId', 'academicYear', 'studentIds', 'classIds']) {
      expect(() => service.createEnrollment(A, { studentId: student.id, classId, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    const created = service.createEnrollment(A, { studentId: student.id, classId });
    for (const field of ['courseId', 'programId', 'teacherId', 'centerId', 'studentIds', 'classIds']) {
      expect(() => service.updateEnrollment(A, created.id, { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  // --- STUDENT ELIGIBILITY -------------------------------------------------

  test('STUDENT: a same-tenant active Student is accepted', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId });
    expect(created.studentId).toBe(student.id);
    expect(created.status).toBe('active');
  });

  test('STUDENT: a same-tenant inactive Student is still accepted', () => {
    const { student, classId } = pairIn(A, { studentStatus: 'inactive' });
    expect(students.getStudent(A, student.id).status).toBe('inactive');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).studentId).toBe(student.id);
  });

  test('STUDENT: an archived Student is refused for a new Enrollment', () => {
    const { student, classId } = pairIn(A);
    students.archiveStudent(A, student.id);
    expect(() => service.createEnrollment(A, { studentId: student.id, classId }))
      .toThrow('studentId must reference a non-archived Student');
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('STUDENT: a nonexistent Student is refused', () => {
    const { classId } = pairIn(A);
    expect(() => service.createEnrollment(A, { studentId: 'stu-nope', classId }))
      .toThrow('studentId does not reference a Student in this tenant');
  });

  test('STUDENT: a cross-tenant Student is refused and left untouched', () => {
    const local = pairIn(A);
    const foreign = studentIn(B, { last: 'Foreign' });
    expect(() => service.createEnrollment(A, { studentId: foreign.id, classId: local.classId }))
      .toThrow('studentId does not reference a Student in this tenant');
    expect(service.listEnrollments(A)).toHaveLength(0);
    expect(students.getStudent(B, foreign.id)).not.toBeNull();
  });

  test('STUDENT: a foreign and a nonexistent Student are indistinguishable', () => {
    const { classId } = pairIn(A);
    const foreign = studentIn(B, { last: 'Foreign' });
    const read = id => {
      try { service.createEnrollment(A, { studentId: id, classId }); } catch (e) { return e.message; }
      return null;
    };
    expect(read(foreign.id)).toBe(read('stu-does-not-exist'));
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('STUDENT: archiving a Student preserves its existing Enrollment unchanged', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId, notes: 'keep me' });
    students.archiveStudent(A, student.id);

    const after = service.getEnrollment(A, created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('active');
    expect(after.studentId).toBe(student.id);
    expect(after.notes).toBe('keep me');
    // The Student store was not modified by the read path either.
    expect(students.getStudent(A, student.id).status).toBe('archived');
  });

  // --- CLASS ELIGIBILITY ---------------------------------------------------

  test('CLASS: a same-tenant active Class is accepted', () => {
    const { student, classId } = pairIn(A);
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: a same-tenant inactive Class is still accepted', () => {
    const { student, classId } = pairIn(A, { classStatus: 'inactive' });
    expect(classes.getClass(A, classId).status).toBe('inactive');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: an archived Class is refused for a new Enrollment', () => {
    const { student, classId } = pairIn(A);
    classes.archiveClass(A, classId);
    expect(() => service.createEnrollment(A, { studentId: student.id, classId }))
      .toThrow('classId must reference a non-archived Class');
    expect(service.listEnrollments(A)).toHaveLength(0);
  });

  test('CLASS: a nonexistent Class is refused', () => {
    const { student } = pairIn(A);
    expect(() => service.createEnrollment(A, { studentId: student.id, classId: 'cls-nope' }))
      .toThrow('classId does not reference a Class in this tenant');
  });

  test('CLASS: a cross-tenant Class is refused and left untouched', () => {
    const local = pairIn(A);
    const foreign = pairIn(B, { className: 'Foreign' });
    expect(() => service.createEnrollment(A, { studentId: local.student.id, classId: foreign.classId }))
      .toThrow('classId does not reference a Class in this tenant');
    expect(service.listEnrollments(A)).toHaveLength(0);
    expect(classes.getClass(B, foreign.classId)).not.toBeNull();
  });

  test('CLASS: a foreign and a nonexistent Class are indistinguishable', () => {
    const { student } = pairIn(A);
    const foreign = pairIn(B, { className: 'Foreign' });
    const read = id => {
      try { service.createEnrollment(A, { studentId: student.id, classId: id }); } catch (e) { return e.message; }
      return null;
    };
    expect(read(foreign.classId)).toBe(read('cls-does-not-exist'));
  });

  test('CLASS: an archived Course behind a still-valid Class does NOT block Enrollment', () => {
    const { student, classId, course } = pairIn(A);
    courses.archiveCourse(A, course.id);
    // The Class is the authoritative parent and stays active, so the Enrollment
    // is valid. The Course/Program chain is deliberately never re-walked.
    expect(classes.getClass(A, classId).status).toBe('active');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: an archived Program behind a still-valid Class does NOT block Enrollment', () => {
    const { student, classId, program } = pairIn(A);
    programs.archiveProgram(A, program.id);
    expect(classes.getClass(A, classId).status).toBe('active');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: an archived Teacher behind a still-valid Class does NOT block Enrollment', () => {
    const { student, classId, teacher } = pairIn(A);
    teachers.archiveTeacher(A, teacher.id);
    expect(classes.getClass(A, classId).status).toBe('active');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: an archived Center behind a still-valid Class does NOT block Enrollment', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { student, classId } = pairIn(A, { centerId: center.id });
    centers.archiveCenter(A, center.id);
    expect(classes.getClass(A, classId).status).toBe('active');
    expect(service.createEnrollment(A, { studentId: student.id, classId }).classId).toBe(classId);
  });

  test('CLASS: archiving the Class preserves its existing Enrollment and blocks new ones', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId });
    classes.archiveClass(A, classId);

    const after = service.getEnrollment(A, created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('active');
    expect(after.classId).toBe(classId);

    const other = studentIn(A, { last: 'Second' });
    expect(() => service.createEnrollment(A, { studentId: other.id, classId }))
      .toThrow('classId must reference a non-archived Class');
  });

  test('a rejected parent never writes a partial record', () => {
    const { student, classId } = pairIn(A);
    const foreign = studentIn(B, { last: 'Foreign' });
    expect(() => service.createEnrollment(A, { studentId: foreign.id, classId, notes: 'ghost' }))
      .toThrow('studentId does not reference a Student in this tenant');
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  // --- IMMUTABILITY --------------------------------------------------------

  describe('IMMUTABILITY: studentId and classId can never be changed or cleared', () => {
    let record;
    let other;
    let foreign;
    let secondStudent;
    let secondClass;

    beforeEach(() => {
      const first = pairIn(A, { studentLast: 'First', className: 'First' });
      record = service.createEnrollment(A, { studentId: first.student.id, classId: first.classId });
      other = pairIn(A, { studentLast: 'Other', className: 'Other', programName: 'Math Track' });
      secondStudent = other.student.id;
      secondClass = other.classId;
      foreign = pairIn(B, { studentLast: 'Foreign', className: 'Foreign' });
    });

    const assertUnchanged = () => {
      const stored = service.getEnrollment(A, record.id);
      expect(stored.studentId).toBe(record.studentId);
      expect(stored.classId).toBe(record.classId);
      expect(stored.status).toBe('active');
    };

    test('a valid same-tenant studentId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: secondStudent }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('a valid same-tenant classId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { classId: secondClass }))
        .toThrow('classId cannot be changed');
      assertUnchanged();
    });

    test('a foreign studentId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: foreign.student.id }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('a foreign classId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { classId: foreign.classId }))
        .toThrow('classId cannot be changed');
      assertUnchanged();
    });

    test('a nonexistent studentId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: 'stu-nope' }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('a nonexistent classId replacement is rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { classId: 'cls-nope' }))
        .toThrow('classId cannot be changed');
      assertUnchanged();
    });

    test('a null studentId is rejected, not treated as an omission', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: null }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('an undefined studentId is rejected, not treated as an omission', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: undefined }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('an empty-string classId is rejected, not treated as an omission', () => {
      expect(() => service.updateEnrollment(A, record.id, { classId: '' }))
        .toThrow('classId cannot be changed');
      assertUnchanged();
    });

    test('a whitespace-only studentId is rejected, not treated as an omission', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: '   ' }))
        .toThrow('studentId cannot be changed');
      assertUnchanged();
    });

    test('a whitespace-only classId is rejected, not treated as an omission', () => {
      expect(() => service.updateEnrollment(A, record.id, { classId: '   ' }))
        .toThrow('classId cannot be changed');
      assertUnchanged();
    });

    test('both relationships supplied together are still fully rejected', () => {
      expect(() => service.updateEnrollment(A, record.id, { studentId: secondStudent, classId: secondClass, notes: 'x' }))
        .toThrow('studentId cannot be changed; classId cannot be changed');
      assertUnchanged();
      expect(service.getEnrollment(A, record.id).notes).toBe('');
    });

    test('a rejected immutability attempt leaves the persisted JSON byte-for-byte unchanged', () => {
      const before = fs.readFileSync(dir + '/educationEnrollments.json', 'utf8');
      for (const bad of [secondStudent, foreign.student.id, 'stu-nope', null, undefined, '', '   ']) {
        try { service.updateEnrollment(A, record.id, { studentId: bad }); } catch (_) {}
      }
      for (const bad of [secondClass, foreign.classId, 'cls-nope', null, undefined, '', '   ']) {
        try { service.updateEnrollment(A, record.id, { classId: bad }); } catch (_) {}
      }
      expect(fs.readFileSync(dir + '/educationEnrollments.json', 'utf8')).toBe(before);
    });

    test('omitting both relationships allows a legitimate notes-only update', () => {
      const updated = service.updateEnrollment(A, record.id, { notes: 'moved to room 4' });
      expect(updated.notes).toBe('moved to room 4');
      expect(updated.studentId).toBe(record.studentId);
      expect(updated.classId).toBe(record.classId);
      expect(updated.updatedAt).not.toBe(record.updatedAt);
      expect(updated.createdAt).toBe(record.createdAt);
    });

    test('an omitted notes key preserves the existing value', () => {
      service.updateEnrollment(A, record.id, { notes: 'original' });
      const updated = service.updateEnrollment(A, record.id, {});
      expect(updated.notes).toBe('original');
      expect(service.updateEnrollment(A, record.id, { notes: '   ' }).notes).toBe('');
    });
  });

  // --- UNIQUENESS ----------------------------------------------------------

  describe('UNIQUENESS: one active enrollment per (tenant, student, class)', () => {
    let student;
    let classId;

    beforeEach(() => {
      const chain = chainIn(A);
      classId = chain.klass.id;
      student = studentIn(A, { last: 'Solo' });
    });

    test('a duplicate active pair raises the typed conflict', () => {
      service.createEnrollment(A, { studentId: student.id, classId });
      let thrown = null;
      try {
        service.createEnrollment(A, { studentId: student.id, classId });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).not.toBeNull();
      expect(thrown).toBeInstanceOf(service.EnrollmentConflictError);
      expect(thrown.conflict).toBe(true);
      expect(thrown.code).toBe('ENROLLMENT_CONFLICT');
      expect(service.listEnrollments(A)).toHaveLength(1);
    });

    test('two active rows for the same triple can never exist on disk', () => {
      service.createEnrollment(A, { studentId: student.id, classId });
      for (let i = 0; i < 3; i++) {
        try { service.createEnrollment(A, { studentId: student.id, classId }); } catch (_) {}
      }
      const stored = readStore(dir, 'educationEnrollments').enrollments;
      const active = stored.filter(e => e.status === 'active' && e.studentId === student.id && e.classId === classId);
      expect(active).toHaveLength(1);
      expect(stored).toHaveLength(1);
    });

    test('the same pair in a different tenant is allowed', () => {
      const foreign = pairIn(B, { studentLast: 'Solo', className: 'Foreign' });
      const a = service.createEnrollment(A, { studentId: student.id, classId });
      const b = service.createEnrollment(B, { studentId: foreign.student.id, classId: foreign.classId });
      expect(a.tenantId).toBe('enr-a');
      expect(b.tenantId).toBe('enr-b');
      expect(a.id).not.toBe(b.id);
    });

    test('a Student may hold several active enrollments in different Classes', () => {
      const other = chainIn(A, { className: 'Second' });
      service.createEnrollment(A, { studentId: student.id, classId });
      expect(service.createEnrollment(A, { studentId: student.id, classId: other.klass.id }).classId)
        .toBe(other.klass.id);
      expect(service.listEnrollments(A, { studentId: student.id })).toHaveLength(2);
    });

    test('a Class may hold several active enrollments for different Students', () => {
      service.createEnrollment(A, { studentId: student.id, classId });
      const second = studentIn(A, { last: 'Second' });
      expect(service.createEnrollment(A, { studentId: second.id, classId }).studentId).toBe(second.id);
      expect(service.listEnrollments(A, { classId })).toHaveLength(2);
    });

    test('an inactive Student and an inactive Class do not affect uniqueness', () => {
      const inactiveStudent = studentIn(A, { last: 'Inactive', status: 'inactive' });
      const inactiveClass = chainIn(A, { className: 'Dormant', classStatus: 'inactive' }).klass.id;
      const first = service.createEnrollment(A, { studentId: inactiveStudent.id, classId: inactiveClass });
      expect(() => service.createEnrollment(A, { studentId: inactiveStudent.id, classId: inactiveClass }))
        .toThrow('an active enrollment already exists for this student and class');
      expect(first.status).toBe('active');
    });

    test('withdrawal releases the pair and re-enrollment appends a NEW row', () => {
      const first = service.createEnrollment(A, { studentId: student.id, classId });
      const withdrawn = service.withdrawEnrollment(A, first.id);
      expect(withdrawn.status).toBe('withdrawn');

      const second = service.createEnrollment(A, { studentId: student.id, classId });
      expect(second.id).not.toBe(first.id);
      expect(second.status).toBe('active');
      expect(second.withdrawnAt).toBeNull();
      // The new row carries its OWN start instant and never inherits the
      // withdrawn row's. Two creations inside the same millisecond legitimately
      // share an ISO-8601 millisecond timestamp, so the invariant asserted here
      // is that the new window starts at or after the old one; the HTTP suite
      // proves strict inequality with a real clock tick.
      expect(new Date(second.enrolledAt).getTime()).toBeGreaterThanOrEqual(new Date(first.enrolledAt).getTime());

      // The withdrawn row is preserved intact, not deleted or mutated.
      const old = service.getEnrollment(A, first.id);
      expect(old).not.toBeNull();
      expect(old.status).toBe('withdrawn');
      expect(old.enrolledAt).toBe(first.enrolledAt);
      expect(old.withdrawnAt).toBe(withdrawn.withdrawnAt);
      expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(2);
    });

    test('a withdrawn row does not participate in uniqueness but is still listed', () => {
      const first = service.createEnrollment(A, { studentId: student.id, classId });
      service.withdrawEnrollment(A, first.id);
      service.createEnrollment(A, { studentId: student.id, classId });
      expect(service.listEnrollments(A, { status: 'active' })).toHaveLength(1);
      expect(service.listEnrollments(A, { status: 'withdrawn' })).toHaveLength(1);
    });

    test('a failed parent check does not reserve the pair', () => {
      const foreign = studentIn(B, { last: 'Foreign' });
      expect(() => service.createEnrollment(A, { studentId: foreign.id, classId }))
        .toThrow('studentId does not reference a Student in this tenant');
      expect(service.createEnrollment(A, { studentId: student.id, classId }).studentId).toBe(student.id);
    });
  });

  // --- LIFECYCLE: WITHDRAW -------------------------------------------------

  describe('LIFECYCLE: withdraw is non-destructive and idempotent', () => {
    let record;

    beforeEach(() => {
      const chain = chainIn(A);
      const student = studentIn(A, { last: 'Solo' });
      record = service.createEnrollment(A, {
        studentId: student.id, classId: chain.klass.id, notes: 'morning group'
      });
    });

    test('withdraw flips status, sets withdrawnAt and bumps updatedAt', () => {
      const withdrawn = service.withdrawEnrollment(A, record.id);
      expect(withdrawn.status).toBe('withdrawn');
      expect(typeof withdrawn.withdrawnAt).toBe('string');
      expect(withdrawn.withdrawnAt).toBe(withdrawn.updatedAt);
      expect(withdrawn.enrolledAt).toBe(record.enrolledAt);
      expect(withdrawn.createdAt).toBe(record.createdAt);
      expect(withdrawn.updatedAt).not.toBe(record.updatedAt);
    });

    test('withdraw preserves id, tenantId, both relationships and notes', () => {
      const withdrawn = service.withdrawEnrollment(A, record.id);
      expect(withdrawn.id).toBe(record.id);
      expect(withdrawn.tenantId).toBe('enr-a');
      expect(withdrawn.studentId).toBe(record.studentId);
      expect(withdrawn.classId).toBe(record.classId);
      expect(withdrawn.notes).toBe('morning group');
    });

    test('withdraw never deletes the row', () => {
      service.withdrawEnrollment(A, record.id);
      expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
      expect(service.getEnrollment(A, record.id)).not.toBeNull();
    });

    test('a second withdraw is idempotent and does NOT replace the original withdrawnAt', () => {
      const once = service.withdrawEnrollment(A, record.id);
      const twice = service.withdrawEnrollment(A, record.id);
      expect(twice.status).toBe('withdrawn');
      expect(twice.withdrawnAt).toBe(once.withdrawnAt);
      expect(twice.enrolledAt).toBe(once.enrolledAt);
      expect(twice.id).toBe(once.id);
      expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
    });

    test('a withdrawn Enrollment stays readable and its notes stay editable', () => {
      service.withdrawEnrollment(A, record.id);
      expect(service.getEnrollment(A, record.id).status).toBe('withdrawn');
      const updated = service.updateEnrollment(A, record.id, { notes: 'left in March' });
      expect(updated.notes).toBe('left in March');
      expect(updated.status).toBe('withdrawn');
      expect(updated.withdrawnAt).not.toBeNull();
    });

    test('a withdrawn Enrollment cannot be reactivated', () => {
      service.withdrawEnrollment(A, record.id);
      expect(() => service.updateEnrollment(A, record.id, { status: 'active' }))
        .toThrow('status is not writable');
      expect(service.getEnrollment(A, record.id).status).toBe('withdrawn');
    });

    test('no delete lifecycle exists on the service surface', () => {
      for (const forbidden of ['deleteEnrollment', 'removeEnrollment', 'archiveEnrollment', 'unenroll']) {
        expect(service[forbidden]).toBeUndefined();
      }
      expect(typeof service.withdrawEnrollment).toBe('function');
    });

    test('withdrawing an unknown or foreign id returns null', () => {
      expect(service.withdrawEnrollment(A, 'enr-nope')).toBeNull();
      expect(service.withdrawEnrollment(B, record.id)).toBeNull();
      expect(service.getEnrollment(A, record.id).status).toBe('active');
    });
  });

  // --- TENANT ISOLATION ----------------------------------------------------

  test('TENANT: a foreign tenant cannot read, update or withdraw an enrollment', () => {
    const { student, classId } = pairIn(A);
    const record = service.createEnrollment(A, { studentId: student.id, classId });

    expect(service.listEnrollments(B)).toHaveLength(0);
    expect(service.getEnrollment(B, record.id)).toBeNull();
    expect(service.updateEnrollment(B, record.id, { notes: 'hack' })).toBeNull();
    expect(service.withdrawEnrollment(B, record.id)).toBeNull();

    const still = service.getEnrollment(A, record.id);
    expect(still.notes).toBe('');
    expect(still.status).toBe('active');
  });

  test('TENANT: a body tenantId can never override the trusted tenant', () => {
    const { student, classId } = pairIn(A);
    expect(() => service.createEnrollment(A, { studentId: student.id, classId, tenantId: 'enr-b' }))
      .toThrow('tenantId is not writable');
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('TENANT: list filters never widen visibility to another tenant', () => {
    const a = pairIn(A, { studentLast: 'Same', className: 'Same' });
    const b = pairIn(B, { studentLast: 'Same', className: 'Same' });
    service.createEnrollment(A, { studentId: a.student.id, classId: a.classId, notes: 'tenant a' });
    service.createEnrollment(B, { studentId: b.student.id, classId: b.classId, notes: 'tenant b' });

    expect(service.listEnrollments(A)).toHaveLength(1);
    expect(service.listEnrollments(A)[0].notes).toBe('tenant a');
    // Foreign ids used as filters simply match nothing.
    expect(service.listEnrollments(A, { studentId: b.student.id })).toHaveLength(0);
    expect(service.listEnrollments(A, { classId: b.classId })).toHaveLength(0);
    expect(service.listEnrollments(A, { search: 'tenant b' })).toHaveLength(0);
  });

  // --- LIST / FILTERS ------------------------------------------------------

  test('list is tenant-scoped, chronological and returns defensive copies', () => {
    const chain = chainIn(A);
    const first = studentIn(A, { last: 'First' });
    const second = studentIn(A, { last: 'Second' });
    const foreign = pairIn(B, { studentLast: 'Foreign', className: 'Foreign' });
    service.createEnrollment(A, { studentId: first.id, classId: chain.klass.id, notes: 'first row' });
    service.createEnrollment(A, { studentId: second.id, classId: chain.klass.id, notes: 'second row' });
    service.createEnrollment(B, { studentId: foreign.student.id, classId: foreign.classId });

    const list = service.listEnrollments(A);
    expect(list).toHaveLength(2);
    expect(list.map(e => e.notes)).toEqual(['first row', 'second row']);
    list[0].notes = 'mutated';
    expect(service.listEnrollments(A)[0].notes).toBe('first row');
  });

  test('list filters by status, studentId, classId and notes-only search', () => {
    const one = chainIn(A, { className: 'One' });
    const two = chainIn(A, { className: 'Two', programName: 'Math Track' });
    const s1 = studentIn(A, { last: 'One' });
    const s2 = studentIn(A, { last: 'Two' });
    service.createEnrollment(A, { studentId: s1.id, classId: one.klass.id, notes: 'morning group' });
    service.createEnrollment(A, { studentId: s2.id, classId: two.klass.id, notes: 'evening group' });
    const withdrawn = service.listEnrollments(A)[0];
    service.withdrawEnrollment(A, withdrawn.id);

    expect(service.listEnrollments(A, { status: 'withdrawn' })).toHaveLength(1);
    expect(service.listEnrollments(A, { status: 'active' })).toHaveLength(1);
    expect(service.listEnrollments(A, { status: 'nonsense' })).toHaveLength(2);
    expect(service.listEnrollments(A, { studentId: s1.id })).toHaveLength(1);
    expect(service.listEnrollments(A, { classId: two.klass.id })).toHaveLength(1);
    expect(service.listEnrollments(A, { search: 'morning' })).toHaveLength(1);
    // Enrollment has no name or code: notes is the only searchable text.
    expect(service.listEnrollments(A, { search: 'enr-' })).toHaveLength(0);
  });

  test('derived filters resolve courseId, teacherId and programId through the Class', () => {
    const math = chainIn(A, { programName: 'Math Track', courseName: 'Algebra', className: 'Math A', teacherLast: 'Math' });
    const lang = chainIn(A, { programName: 'English Track', courseName: 'Grammar', className: 'Lang A', teacherLast: 'Lang' });
    const s1 = studentIn(A, { last: 'One' });
    const s2 = studentIn(A, { last: 'Two' });
    service.createEnrollment(A, { studentId: s1.id, classId: math.klass.id });
    service.createEnrollment(A, { studentId: s2.id, classId: lang.klass.id });

    expect(service.listEnrollments(A, { courseId: math.course.id })).toHaveLength(1);
    expect(service.listEnrollments(A, { courseId: math.course.id })[0].classId).toBe(math.klass.id);
    expect(service.listEnrollments(A, { teacherId: lang.teacher.id })).toHaveLength(1);
    expect(service.listEnrollments(A, { programId: math.program.id })).toHaveLength(1);
    expect(service.listEnrollments(A, { programId: lang.program.id })).toHaveLength(1);

    // No denormalized field is ever exposed.
    for (const field of ['courseId', 'programId', 'teacherId', 'centerId']) {
      expect(Object.prototype.hasOwnProperty.call(service.listEnrollments(A)[0], field)).toBe(false);
    }
  });

  test('derived filters read the parent lists in batches, never per enrollment', () => {
    const chain = chainIn(A, { className: 'A' });
    for (let i = 0; i < 4; i++) {
      service.createEnrollment(A, { studentId: studentIn(A, { last: 'S' + i }).id, classId: chain.klass.id });
    }
    const classSpy = jest.spyOn(classes, 'listClasses');
    const getClassSpy = jest.spyOn(classes, 'getClass');
    const courseSpy = jest.spyOn(courses, 'listCourses');
    const getCourseSpy = jest.spyOn(courses, 'getCourse');
    try {
      expect(service.listEnrollments(A, { programId: chain.program.id })).toHaveLength(4);
      expect(classSpy).toHaveBeenCalledTimes(1);
      expect(courseSpy).toHaveBeenCalledTimes(1);
      // No N+1 pattern: the per-record getters are never used for filtering.
      expect(getClassSpy).not.toHaveBeenCalled();
      expect(getCourseSpy).not.toHaveBeenCalled();
    } finally {
      classSpy.mockRestore();
      getClassSpy.mockRestore();
      courseSpy.mockRestore();
      getCourseSpy.mockRestore();
    }
  });

  test('an unknown or foreign derived filter value yields an empty list', () => {
    const local = pairIn(A);
    const foreign = pairIn(B, { programName: 'Foreign Track' });
    service.createEnrollment(A, { studentId: local.student.id, classId: local.classId });

    expect(service.listEnrollments(A, { programId: 'prg-nope' })).toHaveLength(0);
    expect(service.listEnrollments(A, { programId: foreign.program.id })).toHaveLength(0);
    expect(service.listEnrollments(A, { courseId: foreign.course.id })).toHaveLength(0);
    expect(service.listEnrollments(A, { teacherId: foreign.teacher.id })).toHaveLength(0);
  });

  // --- SCOPE / STORE -------------------------------------------------------

  test('Enrollment operations never write to any parent store', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { student, classId } = pairIn(A, { centerId: center.id });
    const record = service.createEnrollment(A, { studentId: student.id, classId, notes: 'x' });
    const parentKeys = [
      'educationCenters', 'educationPrograms', 'educationCourses',
      'educationTeachers', 'educationClasses', 'educationStudents'
    ];
    const before = parentKeys.map(k => fs.readFileSync(dir + '/' + k + '.json', 'utf8'));

    service.updateEnrollment(A, record.id, { notes: 'y' });
    service.withdrawEnrollment(A, record.id);

    parentKeys.forEach((k, idx) => {
      expect(fs.readFileSync(dir + '/' + k + '.json', 'utf8')).toBe(before[idx]);
    });
  });

  test('persistence uses the educationEnrollments store and nothing else', () => {
    const { student, classId } = pairIn(A);
    service.createEnrollment(A, { studentId: student.id, classId });
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
    expect(fs.readdirSync(dir).sort()).toEqual([
      'educationClasses.json',
      'educationCourses.json',
      'educationEnrollments.json',
      'educationPrograms.json',
      'educationStudents.json',
      'educationTeachers.json'
    ]);
  });

  test('an Enrollment carries no attendance, grading, scheduling or financial field', () => {
    const { student, classId } = pairIn(A);
    const created = service.createEnrollment(A, { studentId: student.id, classId });
    for (const key of [
      'attendance', 'attendanceId', 'grade', 'grades', 'score', 'exam', 'result', 'mark',
      'payment', 'tuition', 'billing', 'invoice', 'salary', 'payroll',
      'schedule', 'scheduling', 'dayOfWeek', 'startTime', 'endTime', 'room', 'recurrence',
      'capacity', 'certificate', 'guardianId', 'courseId', 'programId', 'teacherId',
      'centerId', 'studentIds', 'classIds', 'academicYear'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });

  test('the lifecycle exposes exactly active and withdrawn', () => {
    expect(service.ENROLLMENT_STATUSES).toEqual(['active', 'withdrawn']);
    for (const forbiddenStatus of ['inactive', 'archived', 'completed', 'cancelled', 'suspended', 'paid', 'unpaid']) {
      expect(service.ENROLLMENT_STATUSES).not.toContain(forbiddenStatus);
    }
  });

});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-7 enrollment routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('enr-http');
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

  const ownerA = () => token('enrOwner', 'enr-a', 'Owner');
  const ownerB = () => token('enrOwner', 'enr-b', 'Owner');
  const managerA = () => token('enrManager', 'enr-a', 'Manager');
  const clerkA = () => token('enrClerk', 'enr-a', 'Viewer');
  const strangerA = () => token('enrStranger', 'enr-a', 'Viewer');

  const createStudentIn = (lastName, tok, extra) => request(app)
    .post(`${BASE}/students`).set('Authorization', `Bearer ${tok}`)
    .send(Object.assign({ firstName: 'Nadia', lastName }, extra || {}));

  const createChainIn = async (tok, opts = {}) => {
    const program = await request(app).post(`${BASE}/programs`)
      .set('Authorization', `Bearer ${tok}`)
      .send(opts.centerId ? { name: opts.programName || 'English Track', centerId: opts.centerId }
                          : { name: opts.programName || 'English Track' });
    expect(program.statusCode).toBe(201);
    const course = await request(app).post(`${BASE}/courses`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ name: opts.courseName || 'Grammar 101', programId: program.body.data.id });
    expect(course.statusCode).toBe(201);
    const teacher = await request(app).post(`${BASE}/teachers`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ firstName: 'Ali', lastName: opts.teacherLast || 'One' });
    expect(teacher.statusCode).toBe(201);
    const klass = await request(app).post(`${BASE}/classes`)
      .set('Authorization', `Bearer ${tok}`)
      .send({ courseId: course.body.data.id, teacherId: teacher.body.data.id, name: opts.className || 'A1' });
    expect(klass.statusCode).toBe(201);
    return {
      programId: program.body.data.id,
      courseId: course.body.data.id,
      teacherId: teacher.body.data.id,
      classId: klass.body.data.id
    };
  };

  const create = (body, tok) =>
    request(app).post(`${BASE}/enrollments`).set('Authorization', `Bearer ${tok}`).send(body);

  const setup = async (tok, opts = {}) => {
    const chain = await createChainIn(tok, opts);
    const student = await createStudentIn(opts.studentLast || 'Hassan', tok);
    expect(student.statusCode).toBe(201);
    return { ...chain, studentId: student.body.data.id };
  };

  // --- AUTH ----------------------------------------------------------------

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/enrollments`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/enrollments/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/enrollments`).send({ studentId: 's', classId: 'c' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/enrollments/anything`).send({ notes: 'x' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/enrollments/anything/withdraw`)).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('enr-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/enrollments`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/enrollments`).send({ studentId: 's', classId: 'c' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Enrollment permissions fail closed, with no bypass', async () => {
    // The stranger explicitly holds education.enrollments.export in its user
    // record and is still refused: unknown permissions are not honoured because
    // a client record asked for them.
    const read = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${strangerA()}`);
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const chain = await setup(ownerA());
    const write = await create({ studentId: chain.studentId, classId: chain.classId }, clerkA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('AUTHORIZATION: an explicitly granted, registered Enrollment permission is honoured', async () => {
    // The clerk holds education.enrollments.view, which the registry now knows.
    const read = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(200);
  });

  test('AUTHORIZATION: a Manager cannot write, and nothing is persisted on refusal', async () => {
    const chain = await setup(ownerA());
    const res = await create({ studentId: chain.studentId, classId: chain.classId }, managerA());
    expect(res.statusCode).toBe(403);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('AUTHORIZATION: an Owner is admitted under the current registry behaviour', async () => {
    const chain = await setup(ownerA());
    expect((await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    const res = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(res.statusCode).toBe(201);
  });

  // --- CRUD ----------------------------------------------------------------

  test('CRUD: a privileged role performs the full lifecycle', async () => {
    const chain = await setup(ownerA());
    const created = await create({
      studentId: chain.studentId, classId: chain.classId, notes: 'morning group'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.message).toBe('Enrollment created');
    expect(created.body.data.tenantId).toBe('enr-a');
    expect(created.body.data.status).toBe('active');
    expect(created.body.data.withdrawnAt).toBeNull();
    expect(created.body.data.notes).toBe('morning group');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.message).toBe('Enrollment retrieved');
    expect(fetched.body.data.classId).toBe(chain.classId);

    const listed = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.message).toBe('Enrollments retrieved');
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/enrollments/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ notes: 'moved to room 4' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.message).toBe('Enrollment updated');
    expect(updated.body.data.notes).toBe('moved to room 4');
    expect(updated.body.data.studentId).toBe(chain.studentId);
    expect(updated.body.data.classId).toBe(chain.classId);

    const withdrawn = await request(app).patch(`${BASE}/enrollments/${id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(withdrawn.statusCode).toBe(200);
    expect(withdrawn.body.message).toBe('Enrollment withdrawn');
    expect(withdrawn.body.data.status).toBe('withdrawn');
    expect(typeof withdrawn.body.data.withdrawnAt).toBe('string');
  });

  test('CRUD: there is no DELETE route for enrollments', async () => {
    const chain = await setup(ownerA());
    const created = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    const res = await request(app).delete(`${BASE}/enrollments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(res.statusCode).toBe(404);
    // The record is still there: withdrawal is the only terminal operation.
    const still = await request(app).get(`${BASE}/enrollments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(still.statusCode).toBe(200);
  });

  test('VALIDATION: studentId and classId are required and failures create nothing', async () => {
    const chain = await setup(ownerA());
    expect((await create({ classId: chain.classId }, ownerA())).statusCode).toBe(400);
    expect((await create({ studentId: chain.studentId }, ownerA())).statusCode).toBe(400);
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect((await create({
      studentId: chain.studentId, classId: chain.classId, status: 'active'
    }, ownerA())).statusCode).toBe(400);
    expect((await create({
      studentId: chain.studentId, classId: chain.classId, status: 'withdrawn'
    }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('VALIDATION: server-owned fields answer 400 on create', async () => {
    const chain = await setup(ownerA());
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId',
                         'createdAt', 'updatedAt', 'status', 'enrolledAt', 'withdrawnAt']) {
      const res = await create({ studentId: chain.studentId, classId: chain.classId, [field]: 'x' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('VALIDATION: derived, future and financial fields answer 400 on create', async () => {
    const chain = await setup(ownerA());
    for (const field of ['courseId', 'programId', 'teacherId', 'centerId', 'academicYear',
                         'studentIds', 'classIds', 'attendance', 'attendanceId', 'grade',
                         'grades', 'score', 'exam', 'result', 'payment', 'tuition', 'billing',
                         'invoice', 'salary', 'payroll', 'schedule', 'dayOfWeek', 'startTime',
                         'endTime', 'room', 'recurrence', 'capacity', 'certificate',
                         'guardianId', 'guardianIds']) {
      const res = await create({ studentId: chain.studentId, classId: chain.classId, [field]: 'x' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('VALIDATION: a prototype-pollution payload is neutralized at the HTTP layer', async () => {
    const chain = await setup(ownerA());
    const raw = JSON.stringify({ studentId: chain.studentId, classId: chain.classId });
    const res = await request(app)
      .post(`${BASE}/enrollments`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('Content-Type', 'application/json')
      .send(raw.slice(0, -1) + ',"__proto__":{"polluted":"yes"}}');
    // Master-owned backend/middleware/security.js strips __proto__ before the
    // controller runs, so the service-level own-property check in
    // enrollment.service._validateEnrollment is defense in depth rather than
    // the first line of defence. Either answer is safe; pollution is not.
    expect([201, 400]).toContain(res.statusCode);
    if (res.statusCode === 400) expect(res.body.message).toMatch(/__proto__ is not allowed/);
    expect({}.polluted).toBeUndefined();

    const stored = readStore(dir, 'educationEnrollments');
    if (stored) {
      for (const record of stored.enrollments) {
        expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
        expect(record.polluted).toBeUndefined();
      }
    }
  });

  // --- RELATIONSHIPS OVER HTTP --------------------------------------------

  test('RELATIONSHIP: an unresolvable Student answers 400 and creates nothing', async () => {
    const chain = await setup(ownerA());
    const unknown = await create({ studentId: 'stu-nope', classId: chain.classId }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/studentId does not reference a Student in this tenant/);

    const foreign = await setup(ownerB());
    const foreignRes = await create({ studentId: foreign.studentId, classId: chain.classId }, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    // Existence of another tenant's Student is NOT leaked.
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('RELATIONSHIP: an unresolvable Class answers 400 identically', async () => {
    const chain = await setup(ownerA());
    const unknown = await create({ studentId: chain.studentId, classId: 'cls-nope' }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/classId does not reference a Class in this tenant/);

    const foreign = await createChainIn(ownerB(), { className: 'Foreign' });
    const foreignRes = await create({ studentId: chain.studentId, classId: foreign.classId }, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('RELATIONSHIP: an archived Student is refused for a new Enrollment', async () => {
    const chain = await setup(ownerA());
    const archived = await request(app).patch(`${BASE}/students/${chain.studentId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const res = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/studentId must reference a non-archived Student/);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('RELATIONSHIP: an archived Class is refused for a new Enrollment', async () => {
    const chain = await setup(ownerA());
    const archived = await request(app).patch(`${BASE}/classes/${chain.classId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const res = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/classId must reference a non-archived Class/);
    expect(readStore(dir, 'educationEnrollments')).toBeNull();
  });

  test('RELATIONSHIP: an archived Course behind a still-valid Class does NOT block Enrollment', async () => {
    const chain = await setup(ownerA());
    await request(app).patch(`${BASE}/courses/${chain.courseId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/programs/${chain.programId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/teachers/${chain.teacherId}/archive`).set('Authorization', `Bearer ${ownerA()}`);

    const res = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(res.statusCode).toBe(201);
    expect(res.body.data.classId).toBe(chain.classId);
  });

  test('RELATIONSHIP: an archived Center behind a still-valid Class does NOT block Enrollment', async () => {
    const center = await request(app).post(`${BASE}/centers`)
      .set('Authorization', `Bearer ${ownerA()}`).send({ name: 'Cairo Main' });
    const chain = await setup(ownerA(), { centerId: center.body.data.id });
    await request(app).patch(`${BASE}/centers/${center.body.data.id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);

    const res = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(res.statusCode).toBe(201);
  });

  test('RELATIONSHIP: archiving a Student, Class or Course preserves the Enrollment', async () => {
    const chain = await setup(ownerA());
    const created = await create({ studentId: chain.studentId, classId: chain.classId, notes: 'keep' }, ownerA());
    const id = created.body.data.id;

    await request(app).patch(`${BASE}/students/${chain.studentId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/classes/${chain.classId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/courses/${chain.courseId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/programs/${chain.programId}/archive`).set('Authorization', `Bearer ${ownerA()}`);

    const still = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(still.statusCode).toBe(200);
    expect(still.body.data.status).toBe('active');
    expect(still.body.data.studentId).toBe(chain.studentId);
    expect(still.body.data.classId).toBe(chain.classId);
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
  });

  // --- IMMUTABILITY OVER HTTP ----------------------------------------------

  describe('IMMUTABILITY: PUT cannot change the relationship', () => {
    let id;
    let original;
    let originalStudentId;
    let originalClassId;
    let other;
    let foreign;

    beforeEach(async () => {
      const chain = await setup(ownerA());
      const created = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
      expect(created.statusCode).toBe(201);
      id = created.body.data.id;
      original = created.body.data;
      originalStudentId = original.studentId;
      originalClassId = original.classId;
      other = await setup(ownerA(), { studentLast: 'Other', className: 'Other', programName: 'Math Track' });
      foreign = await setup(ownerB(), { studentLast: 'Foreign', className: 'Foreign' });
    });

    const put = body => request(app).put(`${BASE}/enrollments/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`).send(body);

    const assertUnchanged = async () => {
      const current = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(current.statusCode).toBe(200);
      // The relationship, the lifecycle and the timestamps are all untouched.
      expect(current.body.data.studentId).toBe(originalStudentId);
      expect(current.body.data.classId).toBe(originalClassId);
      expect(current.body.data.status).toBe('active');
      expect(current.body.data.enrolledAt).toBe(original.enrolledAt);
      expect(current.body.data.withdrawnAt).toBeNull();
      expect(current.body.data.notes).toBe(original.notes);
      expect(current.body.data.createdAt).toBe(original.createdAt);
      // And the same is true of the persisted JSON, not just the response.
      const stored = readStore(dir, 'educationEnrollments').enrollments[0];
      expect(stored.studentId).toBe(originalStudentId);
      expect(stored.classId).toBe(originalClassId);
      expect(stored.status).toBe('active');
      expect(stored.withdrawnAt).toBeNull();
      expect(stored.enrolledAt).toBe(original.enrolledAt);
    };

    test('PUT with a valid same-tenant studentId answers 400 and changes nothing', async () => {
      const res = await put({ studentId: other.studentId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/studentId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a valid same-tenant classId answers 400 and changes nothing', async () => {
      const res = await put({ classId: other.classId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/classId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a cross-tenant studentId answers 400 and changes nothing', async () => {
      const res = await put({ studentId: foreign.studentId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/studentId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a cross-tenant classId answers 400 and changes nothing', async () => {
      const res = await put({ classId: foreign.classId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/classId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a nonexistent studentId answers 400 and changes nothing', async () => {
      const res = await put({ studentId: 'stu-nope' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/studentId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a nonexistent classId answers 400 and changes nothing', async () => {
      const res = await put({ classId: 'cls-nope' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/classId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with studentId = null answers 400 and changes nothing', async () => {
      const res = await put({ studentId: null });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/studentId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with classId = "" answers 400 and changes nothing', async () => {
      const res = await put({ classId: '' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/classId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT with a whitespace-only studentId answers 400 and changes nothing', async () => {
      const res = await put({ studentId: '   ' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/studentId cannot be changed/);
      await assertUnchanged();
    });

    test('PUT without either relationship succeeds as a notes-only update', async () => {
      const res = await put({ notes: 'moved to room 4' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.notes).toBe('moved to room 4');
      expect(res.body.data.status).toBe('active');
    });

    test('PUT cannot reactivate a withdrawn Enrollment', async () => {
      await request(app).patch(`${BASE}/enrollments/${id}/withdraw`).set('Authorization', `Bearer ${ownerA()}`);
      const res = await put({ status: 'active' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/status is not writable/);
      const current = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(current.body.data.status).toBe('withdrawn');
    });
  });

  // --- UNIQUENESS / LIFECYCLE OVER HTTP ------------------------------------

  test('UNIQUENESS: a duplicate active pair answers 409 with ENROLLMENT_CONFLICT', async () => {
    const chain = await setup(ownerA());
    const first = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/an active enrollment already exists/);
    expect(dup.body.details.code).toBe('ENROLLMENT_CONFLICT');
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
  });

  test('UNIQUENESS: the same pair is allowed independently in another tenant', async () => {
    const local = await setup(ownerA());
    const foreign = await setup(ownerB(), { studentLast: 'Solo', className: 'Foreign' });

    const a = await create({ studentId: local.studentId, classId: local.classId }, ownerA());
    expect(a.statusCode).toBe(201);
    const b = await create({ studentId: foreign.studentId, classId: foreign.classId }, ownerB());
    expect(b.statusCode).toBe(201);
    expect(b.body.data.tenantId).toBe('enr-b');
  });

  test('LIFECYCLE: withdrawal releases the pair and re-enrollment creates a new row', async () => {
    const chain = await setup(ownerA());
    const first = await create({ studentId: chain.studentId, classId: chain.classId, notes: 'first' }, ownerA());
    const withdrawn = await request(app).patch(`${BASE}/enrollments/${first.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(withdrawn.statusCode).toBe(200);

    // A real clock tick, so the new row provably carries its own start instant
    // rather than reusing the withdrawn window's timestamp.
    await new Promise(resolve => setTimeout(resolve, 5));

    const second = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    expect(second.statusCode).toBe(201);
    expect(second.body.data.id).not.toBe(first.body.data.id);
    expect(second.body.data.withdrawnAt).toBeNull();
    expect(second.body.data.enrolledAt).not.toBe(withdrawn.body.data.enrolledAt);
    expect(second.body.data.enrolledAt).not.toBe(withdrawn.body.data.withdrawnAt);

    // The withdrawn row survives intact.
    const old = await request(app).get(`${BASE}/enrollments/${first.body.data.id}`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(old.statusCode).toBe(200);
    expect(old.body.data.status).toBe('withdrawn');
    expect(old.body.data.notes).toBe('first');
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(2);
  });

  test('LIFECYCLE: a repeated withdrawal is safe and does not move withdrawnAt', async () => {
    const chain = await setup(ownerA());
    const created = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    const once = await request(app).patch(`${BASE}/enrollments/${created.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    const twice = await request(app).patch(`${BASE}/enrollments/${created.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(twice.statusCode).toBe(200);
    expect(twice.body.data.status).toBe('withdrawn');
    expect(twice.body.data.withdrawnAt).toBe(once.body.data.withdrawnAt);
    expect(readStore(dir, 'educationEnrollments').enrollments).toHaveLength(1);
  });

  // --- LIST FILTERS OVER HTTP ----------------------------------------------

  test('LIST: every declared filter works over HTTP', async () => {
    const first = await setup(ownerA(), { className: 'One', programName: 'Math Track', courseName: 'Algebra' });
    const second = await setup(ownerA(), { className: 'Two', programName: 'English Track', courseName: 'Grammar', studentLast: 'Second' });
    await create({ studentId: first.studentId, classId: first.classId, notes: 'morning group' }, ownerA());
    await create({ studentId: second.studentId, classId: second.classId, notes: 'evening group' }, ownerA());

    const call = async qs => {
      const res = await request(app).get(`${BASE}/enrollments${qs}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(res.statusCode).toBe(200);
      return res.body.data;
    };

    expect(await call('')).toHaveLength(2);
    expect(await call('?status=active')).toHaveLength(2);
    expect(await call(`?studentId=${first.studentId}`)).toHaveLength(1);
    expect(await call(`?classId=${second.classId}`)).toHaveLength(1);
    expect(await call(`?courseId=${first.courseId}`)).toHaveLength(1);
    expect(await call(`?teacherId=${first.teacherId}`)).toHaveLength(1);
    expect(await call(`?programId=${second.programId}`)).toHaveLength(1);
    expect(await call('?programId=prg-nope')).toHaveLength(0);
    expect(await call('?search=morning')).toHaveLength(1);
    // No denormalized field is ever returned.
    expect(Object.prototype.hasOwnProperty.call((await call(''))[0], 'courseId')).toBe(false);
  });

  // --- TENANT OVER HTTP ----------------------------------------------------

  test('TENANT: tenant B cannot read, update or withdraw tenant A enrollments', async () => {
    const chain = await setup(ownerA());
    const created = await create({ studentId: chain.studentId, classId: chain.classId, notes: 'A only' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    expect((await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ notes: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/enrollments/${id}/withdraw`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.notes).toBe('A only');
    expect(stillA.body.data.status).toBe('active');
  });

  test('TENANT: a foreign enrollment id is indistinguishable from a nonexistent one', async () => {
    const missing = await request(app).get(`${BASE}/enrollments/enr-nope`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.body.message).toBe('Enrollment not found');
  });

  test('TENANT: tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const chain = await setup(ownerA());
    const created = await create({ studentId: chain.studentId, classId: chain.classId, notes: 'A only' }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/enrollments/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'enr-b')
        .set('companyId', 'enr-b')
        .send({ notes: 'A only', [field]: 'enr-b' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }

    const still = await request(app).get(`${BASE}/enrollments/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(still.body.data.tenantId).toBe('enr-a');
    const listB = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('TENANT: query and header tenant values never alter isolation', async () => {
    const chain = await setup(ownerA());
    await create({ studentId: chain.studentId, classId: chain.classId, notes: 'morning group' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/enrollments?tenantId=enr-b&companyId=enr-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'enr-b')
      .set('companyId', 'enr-b')
      .set('branchId', 'enr-b')
      .set('X-Tenant-Id', 'enr-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('enr-a');

    const verifyB = await request(app).get(`${BASE}/enrollments?tenantId=enr-a&search=morning`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('TENANT: a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'enrOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/enrollments`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('TENANT: an inactive tenant never inherits live tenant data', async () => {
    const chain = await setup(ownerA());
    await create({ studentId: chain.studentId, classId: chain.classId, notes: 'live' }, ownerA());
    const res = await request(app).get(`${BASE}/enrollments`)
      .set('Authorization', `Bearer ${token('enrOwner', 'enr-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  // --- SECURITY / SCOPE / REGRESSION ---------------------------------------

  test('no error response leaks internals', async () => {
    const missing = await request(app).get(`${BASE}/enrollments/no-such-id`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    const text = JSON.stringify(missing.body);
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('enr-a');
  });

  test('STORE: only the educationEnrollments store is introduced, and withdrawal touches nothing else', async () => {
    const chain = await setup(ownerA());
    const before = listStores(dir).sort();
    const parentBefore = ['educationStudents', 'educationClasses', 'educationCourses', 'educationPrograms', 'educationTeachers']
      .map(k => fs.readFileSync(dir + '/' + k + '.json', 'utf8'));

    const created = await create({ studentId: chain.studentId, classId: chain.classId }, ownerA());
    const added = listStores(dir).filter(f => !before.includes(f));
    expect(added).toEqual(['educationEnrollments.json']);

    await request(app).put(`${BASE}/enrollments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${ownerA()}`).send({ notes: 'x' });
    await request(app).patch(`${BASE}/enrollments/${created.body.data.id}/withdraw`)
      .set('Authorization', `Bearer ${ownerA()}`);

    ['educationStudents', 'educationClasses', 'educationCourses', 'educationPrograms', 'educationTeachers']
      .forEach((k, idx) => {
        expect(fs.readFileSync(dir + '/' + k + '.json', 'utf8')).toBe(parentBefore[idx]);
      });
  });

  test('REGRESSION: the earlier Education routes are not shadowed', async () => {
    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    expect(caps.statusCode).toBe(200);
    for (const key of ['students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance', 'scheduling', 'grading']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(true);
    }
    expect(caps.body.data.find(c => c.key === 'scheduling').phase).toBe('STU-9');
    expect(caps.body.data.find(c => c.key === 'grading').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'grading').phase).toBe('STU-10');

    for (const route of ['students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance', 'scheduling', 'grading']) {
      expect((await request(app).get(`${BASE}/${route}`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    }
    expect((await request(app).get(`${BASE}/pack`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
  });

  test('Enrollment routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/enrollments').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).get('/api/v1/tenant/enrollments').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
  });
});

// Restore env so other suites are unaffected.
afterAll(() => {
  const mapping = {
    ENABLE_TENANT_CARRY: 'CARRY',
    ENABLE_TENANT_ROLES: 'ROLES',
    AUTH_REQUIRED: 'AUTH',
    DIGITRONICS_DATA_DIR: 'DATA'
  };
  for (const [envKey, origKey] of Object.entries(mapping)) {
    const orig = ORIGINAL_ENV[origKey];
    if (orig === undefined) delete process.env[envKey];
    else process.env[envKey] = orig;
  }
});
