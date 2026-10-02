'use strict';

// STU-6 Education Class records — regression suite (Device 2).
//
// Mirrors the STU-5 course suite and adds the three Class-specific contracts
// that STU-6 locks down:
//
//   1. BOTH relationships (`courseId`, `teacherId`) are REQUIRED, resolvable
//      only INSIDE the trusted tenant, and never CLEARABLE. A parent belonging
//      to another tenant is indistinguishable from one that does not exist, so
//      cross-tenant relationships fail closed without leaking existence.
//   2. A Course whose own Program is archived is refused for a NEW assignment,
//      while an existing Class survives that Program being archived later.
//   3. A Class stores NO programId and NO centerId. Both are DERIVED through
//      the Course, so contradictory relationship state is structurally
//      impossible rather than merely validated. `?programId=` is resolved
//      through the Course instead.
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
  { id: 'cls-a', name: 'Class Tenant A', code: 'CLSA', active: true },
  { id: 'cls-b', name: 'Class Tenant B', code: 'CLSB', active: true },
  { id: 'cls-retired', name: 'Retired Class Tenant', code: 'CLSR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'clsOwner', password, role: 'Owner', fullName: 'Class Owner',
      tenantIds: ['cls-a', 'cls-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Class permissions EXPLICITLY, so the
      // suite proves a registered, explicitly granted permission is honoured.
      id: 'u-clerk', username: 'clsClerk', password, role: 'Viewer', fullName: 'Class Clerk',
      permissions: ['education.classes.view', 'education.classes.edit'],
      tenantIds: ['cls-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding a Class permission the registry does NOT
      // know, so the suite proves an unregistered permission still fails closed
      // rather than being honoured because a client record asked for it.
      id: 'u-stranger', username: 'clsStranger', password, role: 'Viewer', fullName: 'Class Stranger',
      permissions: ['education.classes.export'],
      tenantIds: ['cls-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'clsManager', password, role: 'Manager', fullName: 'Class Manager',
      tenantIds: ['cls-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-6 class.service — trusted tenant + required Course/Teacher references', () => {
  let dir;
  let service;
  let courses;
  let programs;
  let teachers;
  let centers;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('cls-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/class.service');
    courses = require('../services/course.service');
    programs = require('../services/program.service');
    teachers = require('../services/teacher.service');
    centers = require('../services/center.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'cls-a' };
  const B = { tenantId: 'cls-b' };

  // Builds a full valid chain in one tenant: Center -> Program -> Course plus a
  // Teacher. `opts.centerId` is optional — a Program may legitimately have no
  // Center.
  const chain = (ctx, opts = {}) => {
    const programInput = { name: opts.programName || 'English Track' };
    if (opts.centerId) programInput.centerId = opts.centerId;
    const program = programs.createProgram(ctx, programInput);
    const course = courses.createCourse(ctx, {
      programId: program.id,
      name: opts.courseName || 'Grammar 101'
    });
    const teacher = teachers.createTeacher(ctx, {
      firstName: 'Nadia',
      lastName: opts.teacherLastName || 'Hassan'
    });
    return { program, course, teacher };
  };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listClasses(null)).toThrow('Tenant context is required');
    expect(() => service.listClasses({})).toThrow('Tenant context is required');
    expect(() => service.getClass(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createClass(null, { courseId: 'c', teacherId: 't' })).toThrow('Tenant context is required');
    expect(() => service.updateClass(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveClass(null, 'x')).toThrow('Tenant context is required');
  });

  test('create requires BOTH courseId and teacherId', () => {
    expect(() => service.createClass(A, { teacherId: 't' })).toThrow('courseId is required');
    expect(() => service.createClass(A, { courseId: 'c' })).toThrow('teacherId is required');
    expect(() => service.createClass(A, { courseId: '   ', teacherId: 't' })).toThrow('courseId is required');
    expect(() => service.createClass(A, { courseId: 'c', teacherId: '   ' })).toThrow('teacherId is required');
    expect(() => service.createClass(A, 'nope')).toThrow('request body must be a JSON object');
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('create stamps the trusted tenant, trims input and defaults sensibly', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, {
      courseId: '  ' + course.id + ' ', teacherId: teacher.id, name: '  Morning Group '
    });
    expect(created.tenantId).toBe('cls-a');
    expect(created.courseId).toBe(course.id);
    expect(created.teacherId).toBe(teacher.id);
    expect(created.name).toBe('Morning Group');
    expect(created.status).toBe('active');
    expect(created.classCode).toMatch(/^CLS/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('name is optional; displayName defaults to it and respects an explicit value', () => {
    const { course, teacher } = chain(A);
    const bare = service.createClass(A, { courseId: course.id, teacherId: teacher.id });
    expect(bare.name).toBe('');
    expect(bare.displayName).toBe('');

    const derived = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'Grammar' });
    expect(derived.displayName).toBe('Grammar');
    const explicit = service.createClass(A, {
      courseId: course.id, teacherId: teacher.id, name: 'Writing', displayName: 'Advanced Writing'
    });
    expect(explicit.displayName).toBe('Advanced Writing');
  });

  test('a rename refreshes a derived displayName but respects an explicit one', () => {
    const { course, teacher } = chain(A);
    const derived = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'Grammar' });
    expect(service.updateClass(A, derived.id, { name: 'Grammar II' }).displayName).toBe('Grammar II');

    const explicit = service.createClass(A, {
      courseId: course.id, teacherId: teacher.id, name: 'Writing', displayName: 'Advanced Writing'
    });
    expect(service.updateClass(A, explicit.id, { name: 'Writing II' }).displayName).toBe('Advanced Writing');
  });

  // --- COURSE RELATIONSHIP --------------------------------------------------

  test('RELATIONSHIP: a same-tenant Course and Teacher pair is accepted', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    expect(created.courseId).toBe(course.id);
    expect(created.teacherId).toBe(teacher.id);
    expect(created.tenantId).toBe('cls-a');
  });

  test('RELATIONSHIP: a cross-tenant Course reference is refused', () => {
    const local = chain(A);
    const foreign = chain(B);
    expect(() => service.createClass(A, { courseId: foreign.course.id, teacherId: local.teacher.id }))
      .toThrow('courseId does not reference a Course in this tenant');
    expect(service.listClasses(A)).toHaveLength(0);
    // The foreign Course is untouched.
    expect(courses.getCourse(B, foreign.course.id)).not.toBeNull();
  });

  test('RELATIONSHIP: a nonexistent Course reference is refused identically', () => {
    const { teacher } = chain(A);
    expect(() => service.createClass(A, { courseId: 'crs-nope', teacherId: teacher.id }))
      .toThrow('courseId does not reference a Course in this tenant');
  });

  test('RELATIONSHIP: the cross-tenant and nonexistent Course cases are indistinguishable', () => {
    const { teacher } = chain(A);
    const foreign = chain(B);
    const read = id => {
      try { service.createClass(A, { courseId: id, teacherId: teacher.id }); } catch (e) { return e.message; }
      return null;
    };
    expect(read(foreign.course.id)).toBe(read('crs-does-not-exist'));
  });

  test('RELATIONSHIP: an archived Course is refused as a parent', () => {
    const { course, teacher } = chain(A);
    courses.archiveCourse(A, course.id);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id }))
      .toThrow('courseId must reference a non-archived Course');
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('RELATIONSHIP: a Course whose Program is archived is refused as a parent', () => {
    const { program, course, teacher } = chain(A);
    programs.archiveProgram(A, program.id);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id }))
      .toThrow('courseId must reference a Course whose Program is not archived');
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('RELATIONSHIP: an inactive Course is still a valid parent', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const course = courses.createCourse(A, { programId: program.id, name: 'Grammar', status: 'inactive' });
    const teacher = teachers.createTeacher(A, { firstName: 'Nadia', lastName: 'Hassan' });
    expect(service.createClass(A, { courseId: course.id, teacherId: teacher.id }).courseId).toBe(course.id);
  });

  // --- TEACHER RELATIONSHIP -------------------------------------------------

  test('RELATIONSHIP: a cross-tenant Teacher reference is refused', () => {
    const { course } = chain(A);
    const foreign = chain(B);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: foreign.teacher.id }))
      .toThrow('teacherId does not reference a Teacher in this tenant');
    expect(service.listClasses(A)).toHaveLength(0);
    expect(teachers.getTeacher(B, foreign.teacher.id)).not.toBeNull();
  });

  test('RELATIONSHIP: a nonexistent Teacher reference is refused identically', () => {
    const { course } = chain(A);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: 'tch-nope' }))
      .toThrow('teacherId does not reference a Teacher in this tenant');
  });

  test('RELATIONSHIP: the cross-tenant and nonexistent Teacher cases are indistinguishable', () => {
    const { course } = chain(A);
    const foreign = chain(B);
    const read = id => {
      try { service.createClass(A, { courseId: course.id, teacherId: id }); } catch (e) { return e.message; }
      return null;
    };
    expect(read(foreign.teacher.id)).toBe(read('tch-does-not-exist'));
  });

  test('RELATIONSHIP: an archived Teacher is refused for a new assignment', () => {
    const { course, teacher } = chain(A);
    teachers.archiveTeacher(A, teacher.id);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id }))
      .toThrow('teacherId must reference a non-archived Teacher');
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('RELATIONSHIP: an inactive Teacher is still eligible', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const course = courses.createCourse(A, { programId: program.id, name: 'Grammar' });
    const teacher = teachers.createTeacher(A, { firstName: 'Nadia', lastName: 'Hassan', status: 'inactive' });
    expect(service.createClass(A, { courseId: course.id, teacherId: teacher.id }).teacherId).toBe(teacher.id);
  });

  // --- CENTER SEMANTICS -----------------------------------------------------

  test('CENTER: an archived Center does NOT block Class creation', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { course, teacher } = chain(A, { centerId: center.id });
    centers.archiveCenter(A, center.id);

    // STU-6 does not modify Center behavior and invents no cascade: the Center
    // is derived through Course -> Program, so its archived state is irrelevant.
    expect(programs.getProgram(A, course.programId).status).toBe('active');
    expect(service.createClass(A, { courseId: course.id, teacherId: teacher.id }).courseId).toBe(course.id);
  });

  test('CENTER: a Program with no Center still yields a valid Class', () => {
    const { program, course, teacher } = chain(A);
    expect(program.centerId).toBe('');
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'No Center' });
    expect(created.courseId).toBe(course.id);
  });

  test('a failed parent check does not reserve the classCode', () => {
    const foreign = chain(B);
    const local = chain(A);
    expect(() => service.createClass(A, { courseId: foreign.course.id, teacherId: local.teacher.id, classCode: 'K-100' }))
      .toThrow('courseId does not reference a Course in this tenant');
    expect(service.createClass(A, { courseId: local.course.id, teacherId: local.teacher.id, classCode: 'K-100' }).classCode)
      .toBe('K-100');
  });

  // --- DERIVED, NOT STORED --------------------------------------------------

  test('a Class stores no programId or centerId; both are derived through the Course', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { course, teacher } = chain(A, { centerId: center.id });
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });

    expect(Object.prototype.hasOwnProperty.call(created, 'programId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(created, 'centerId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, 'programId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, 'centerId')).toBe(false);

    // Supplying either is refused rather than quietly stored.
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, programId: 'p' }))
      .toThrow('programId is not writable');
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, centerId: center.id }))
      .toThrow('centerId is not writable');

    // The chain still resolves: Class -> Course -> Program -> Center.
    expect(courses.getCourse(A, created.courseId).programId).toBe(course.programId);
    expect(programs.getProgram(A, course.programId).centerId).toBe(center.id);
  });

  // --- FORBIDDEN FIELDS -----------------------------------------------------

  test('server-owned fields are rejected on create, not silently ignored', () => {
    const { course, teacher } = chain(A);
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt', 'updatedAt']) {
      expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('later-phase fields are refused outright on create', () => {
    const { course, teacher } = chain(A);
    for (const field of [
      'studentId', 'studentIds', 'enrollmentId', 'enrollmentIds', 'attendance',
      'grades', 'exam', 'payment', 'tuition', 'billing', 'salary', 'payroll',
      'capacity', 'level', 'dayOfWeek', 'startTime', 'endTime', 'room', 'recurrence'
    ]) {
      expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.listClasses(A)).toHaveLength(0);
  });

  test('later-phase fields are refused outright on update', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    for (const field of ['studentId', 'enrollmentId', 'attendance', 'grades', 'capacity', 'programId', 'centerId']) {
      expect(() => service.updateClass(A, created.id, { [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
    expect(service.getClass(A, created.id).name).toBe('A1');
  });

  test('status is validated and no scheduling lifecycle value is accepted', () => {
    const { course, teacher } = chain(A);
    const base = { courseId: course.id, teacherId: teacher.id };
    expect(() => service.createClass(A, { ...base, status: 'nope' }))
      .toThrow('status must be one of: active, inactive, archived');
    for (const forbiddenStatus of ['scheduled', 'running', 'completed', 'cancelled']) {
      expect(() => service.createClass(A, { ...base, status: forbiddenStatus }))
        .toThrow('status must be one of: active, inactive, archived');
    }
  });

  test('every declared status is accepted', () => {
    const { course, teacher } = chain(A);
    for (const status of ['active', 'inactive', 'archived']) {
      const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, status, name: 's-' + status });
      expect(created.status).toBe(status);
    }
  });

  test('oversized and non-string input is rejected rather than coerced', () => {
    const { course, teacher } = chain(A);
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'x'.repeat(400) }))
      .toThrow('name must be at most 160 characters');
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 42 }))
      .toThrow('name must be a string');
    expect(() => service.updateClass(A, 'whatever', { courseId: 42 }))
      .toThrow('courseId must be a string');
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const { course, teacher } = chain(A);
    const payload = JSON.parse(
      '{"courseId":"' + course.id + '","teacherId":"' + teacher.id + '","__proto__":{"polluted":"yes"}}'
    );
    expect(() => service.createClass(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();

    expect(() => service.updateClass(A, 'x', { constructor: 'y' })).toThrow('constructor is not allowed');
    expect(() => service.updateClass(A, 'x', { prototype: 'y' })).toThrow('prototype is not allowed');
  });

  // --- LIST / CRUD ----------------------------------------------------------

  test('list is tenant-scoped, sorted by name and copies records', () => {
    const local = chain(A);
    service.createClass(A, { courseId: local.course.id, teacherId: local.teacher.id, name: 'Zulu' });
    service.createClass(A, { courseId: local.course.id, teacherId: local.teacher.id, name: 'Adams' });
    const foreign = chain(B);
    service.createClass(B, { courseId: foreign.course.id, teacherId: foreign.teacher.id, name: 'Beta' });

    const listA = service.listClasses(A);
    expect(listA.map(c => c.name)).toEqual(['Adams', 'Zulu']);
    listA[0].name = 'mutated';
    expect(service.listClasses(A).find(c => c.name === 'Adams').name).toBe('Adams');
  });

  test('list filters by status, courseId, teacherId and search', () => {
    const one = chain(A, { teacherLastName: 'One' });
    const two = chain(A, { courseName: 'Algebra 101', programName: 'Math Track', teacherLastName: 'Two' });
    service.createClass(A, {
      courseId: one.course.id, teacherId: one.teacher.id, name: 'Grammar',
      classCode: 'K-100', description: 'Language basics'
    });
    service.createClass(A, {
      courseId: two.course.id, teacherId: two.teacher.id, name: 'Algebra', status: 'inactive'
    });
    const foreign = chain(B);
    service.createClass(B, { courseId: foreign.course.id, teacherId: foreign.teacher.id, name: 'Elsewhere' });

    expect(service.listClasses(A, { status: 'active' })).toHaveLength(1);
    expect(service.listClasses(A, { status: 'inactive' })[0].name).toBe('Algebra');
    expect(service.listClasses(A, { status: 'nonsense' })).toHaveLength(2);
    expect(service.listClasses(A, { courseId: one.course.id })).toHaveLength(1);
    expect(service.listClasses(A, { courseId: foreign.course.id })).toHaveLength(0);
    expect(service.listClasses(A, { teacherId: two.teacher.id })[0].name).toBe('Algebra');
    expect(service.listClasses(A, { teacherId: foreign.teacher.id })).toHaveLength(0);

    expect(service.listClasses(A, { search: 'k-100' })).toHaveLength(1);
    expect(service.listClasses(A, { search: 'language basics' })).toHaveLength(1);
    expect(service.listClasses(A, { search: 'elsewhere' })).toHaveLength(0);
  });

  test('list resolves programId through the Course, never from a stored field', () => {
    const math = chain(A, { programName: 'Math Track', courseName: 'Algebra' });
    const lang = chain(A, { programName: 'English Track', courseName: 'Grammar' });
    service.createClass(A, { courseId: math.course.id, teacherId: math.teacher.id, name: 'Algebra A' });
    service.createClass(A, { courseId: lang.course.id, teacherId: lang.teacher.id, name: 'Grammar A' });

    const filtered = service.listClasses(A, { programId: math.program.id });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Algebra A');
    expect(Object.prototype.hasOwnProperty.call(filtered[0], 'programId')).toBe(false);
  });

  test('a programId filter reads the Course list ONCE instead of per Class', () => {
    const one = chain(A);
    const two = chain(A, { programName: 'Second Track' });
    service.createClass(A, { courseId: one.course.id, teacherId: one.teacher.id, name: 'One' });
    service.createClass(A, { courseId: one.course.id, teacherId: two.teacher.id, name: 'Two' });
    service.createClass(A, { courseId: two.course.id, teacherId: one.teacher.id, name: 'Three' });

    const spy = jest.spyOn(courses, 'listCourses');
    const getSpy = jest.spyOn(courses, 'getCourse');
    try {
      const filtered = service.listClasses(A, { programId: one.program.id });
      expect(filtered).toHaveLength(2);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(getSpy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      getSpy.mockRestore();
    }
  });

  test('an unknown or foreign programId yields an empty list without leaking existence', () => {
    const local = chain(A);
    const foreign = chain(B);
    service.createClass(A, { courseId: local.course.id, teacherId: local.teacher.id, name: 'Local' });
    expect(service.listClasses(A, { programId: 'prg-nope' })).toHaveLength(0);
    expect(service.listClasses(A, { programId: foreign.program.id })).toHaveLength(0);
  });

  test('a tenant cannot read, update or archive another tenant class', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    expect(service.getClass(B, created.id)).toBeNull();
    expect(service.updateClass(B, created.id, { name: 'hack' })).toBeNull();
    expect(service.archiveClass(B, created.id)).toBeNull();
    expect(service.getClass(A, created.id).name).toBe('A1');
    expect(service.getClass(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1', notes: 'first' });
    const updated = service.updateClass(A, created.id, { name: 'A2' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('cls-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.notes).toBe('first');
    expect(updated.name).toBe('A2');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test('archive sets archived, bumps updatedAt, preserves the record and is idempotent', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    const once = service.archiveClass(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('cls-a');
    expect(once.createdAt).toBe(created.createdAt);
    expect(once.updatedAt).not.toBe(created.updatedAt);
    expect(once.courseId).toBe(course.id);
    expect(service.archiveClass(A, created.id).status).toBe('archived');
    expect(service.archiveClass(A, 'no-such-id')).toBeNull();
    // Preserved, never deleted.
    expect(readStore(dir, 'educationClasses').classes).toHaveLength(1);
  });

  // --- UPDATE INTEGRITY -----------------------------------------------------
  //
  // Invariant: a stored Class ALWAYS has a valid, non-archived, same-tenant
  // Course and Teacher. Both relationships may be REASSIGNED but never CLEARED.
  // These tests pin that a rejected update mutates NEITHER relationship, which
  // is the exact defect class the STU-5 audit found in the Course service.

  describe('UPDATE INTEGRITY: courseId and teacherId can be reassigned but never cleared', () => {
    let courseA;
    let courseB;
    let teacherA;
    let teacherB;
    let record;

    beforeEach(() => {
      courseA = courses.createCourse(A, { programId: programs.createProgram(A, { name: 'Track A' }).id, name: 'Course A' });
      courseB = courses.createCourse(A, { programId: programs.createProgram(A, { name: 'Track B' }).id, name: 'Course B' });
      teacherA = teachers.createTeacher(A, { firstName: 'Ali', lastName: 'One' });
      teacherB = teachers.createTeacher(A, { firstName: 'Sara', lastName: 'Two' });
      record = service.createClass(A, { courseId: courseA.id, teacherId: teacherA.id, name: 'A1' });
    });

    const assertBothIntact = () => {
      const stored = service.getClass(A, record.id);
      expect(stored.courseId).toBe(courseA.id);
      expect(stored.teacherId).toBe(teacherA.id);
    };

    test('an OMITTED courseId and teacherId preserve both relationships', () => {
      const updated = service.updateClass(A, record.id, { name: 'Renamed' });
      expect(updated.courseId).toBe(courseA.id);
      expect(updated.teacherId).toBe(teacherA.id);
      assertBothIntact();
    });

    test('a valid same-tenant Course reassignment is preserved', () => {
      const updated = service.updateClass(A, record.id, { courseId: courseB.id });
      expect(updated.courseId).toBe(courseB.id);
      expect(updated.teacherId).toBe(teacherA.id);
      expect(service.listClasses(A, { courseId: courseB.id }).map(c => c.id)).toContain(record.id);
    });

    test('a valid same-tenant Teacher reassignment is preserved', () => {
      const updated = service.updateClass(A, record.id, { teacherId: teacherB.id });
      expect(updated.teacherId).toBe(teacherB.id);
      expect(updated.courseId).toBe(courseA.id);
      expect(service.listClasses(A, { teacherId: teacherB.id }).map(c => c.id)).toContain(record.id);
    });

    test('a null courseId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { courseId: null })).toThrow('courseId cannot be cleared');
      assertBothIntact();
    });

    test('an undefined courseId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { courseId: undefined })).toThrow('courseId cannot be cleared');
      assertBothIntact();
    });

    test('an empty-string courseId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { courseId: '' })).toThrow('courseId cannot be cleared');
      assertBothIntact();
    });

    test('a whitespace-only courseId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { courseId: '   ' })).toThrow('courseId cannot be cleared');
      assertBothIntact();
    });

    test('a null teacherId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { teacherId: null })).toThrow('teacherId cannot be cleared');
      assertBothIntact();
    });

    test('an undefined teacherId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { teacherId: undefined })).toThrow('teacherId cannot be cleared');
      assertBothIntact();
    });

    test('an empty-string teacherId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { teacherId: '' })).toThrow('teacherId cannot be cleared');
      assertBothIntact();
    });

    test('a whitespace-only teacherId is rejected and preserves both relationships', () => {
      expect(() => service.updateClass(A, record.id, { teacherId: '   ' })).toThrow('teacherId cannot be cleared');
      assertBothIntact();
    });

    test('a cross-tenant Course is rejected and preserves both relationships', () => {
      const foreign = chain(B);
      expect(() => service.updateClass(A, record.id, { courseId: foreign.course.id }))
        .toThrow('courseId does not reference a Course in this tenant');
      assertBothIntact();
    });

    test('a cross-tenant Teacher is rejected and preserves both relationships', () => {
      const foreign = chain(B);
      expect(() => service.updateClass(A, record.id, { teacherId: foreign.teacher.id }))
        .toThrow('teacherId does not reference a Teacher in this tenant');
      assertBothIntact();
    });

    test('an archived Course is rejected and preserves both relationships', () => {
      courses.archiveCourse(A, courseB.id);
      expect(() => service.updateClass(A, record.id, { courseId: courseB.id }))
        .toThrow('courseId must reference a non-archived Course');
      assertBothIntact();
    });

    test('a Course whose Program is archived is rejected and preserves both relationships', () => {
      const programB = programs.getProgram(A, courseB.programId);
      programs.archiveProgram(A, programB.id);
      expect(() => service.updateClass(A, record.id, { courseId: courseB.id }))
        .toThrow('courseId must reference a Course whose Program is not archived');
      assertBothIntact();
    });

    test('an archived Teacher is rejected and preserves both relationships', () => {
      teachers.archiveTeacher(A, teacherB.id);
      expect(() => service.updateClass(A, record.id, { teacherId: teacherB.id }))
        .toThrow('teacherId must reference a non-archived Teacher');
      assertBothIntact();
    });

    test('an invalid Course alongside a VALID Teacher still preserves BOTH relationships', () => {
      // Partial mutation would leave the Class pointed at Teacher B while the
      // Course request failed.
      expect(() => service.updateClass(A, record.id, { courseId: 'crs-nope', teacherId: teacherB.id }))
        .toThrow('courseId does not reference a Course in this tenant');
      assertBothIntact();
    });

    test('an invalid Teacher alongside a VALID Course still preserves BOTH relationships', () => {
      expect(() => service.updateClass(A, record.id, { courseId: courseB.id, teacherId: 'tch-nope' }))
        .toThrow('teacherId does not reference a Teacher in this tenant');
      assertBothIntact();
    });

    test('a foreign and a nonexistent Course remain indistinguishable on update', () => {
      const foreign = chain(B);
      const read = id => {
        try { service.updateClass(A, record.id, { courseId: id }); } catch (e) { return e.message; }
        return null;
      };
      expect(read(foreign.course.id)).toBe(read('crs-nope'));
      assertBothIntact();
    });

    test('a foreign and a nonexistent Teacher remain indistinguishable on update', () => {
      const foreign = chain(B);
      const read = id => {
        try { service.updateClass(A, record.id, { teacherId: id }); } catch (e) { return e.message; }
        return null;
      };
      expect(read(foreign.teacher.id)).toBe(read('tch-nope'));
      assertBothIntact();
    });

    test('a failed update leaves the persisted JSON byte-for-byte unchanged', () => {
      const before = fs.readFileSync(dir + '/educationClasses.json', 'utf8');
      expect(() => service.updateClass(A, record.id, { courseId: 'crs-nope', teacherId: teacherB.id })).toThrow();
      expect(() => service.updateClass(A, record.id, { courseId: courseB.id, teacherId: 'tch-nope' })).toThrow();
      expect(fs.readFileSync(dir + '/educationClasses.json', 'utf8')).toBe(before);
    });

    test('a stored Class can never be left without a course or teacher on disk', () => {
      for (const bad of ['', null, undefined, '   ']) {
        try { service.updateClass(A, record.id, { courseId: bad }); } catch (_) {}
        try { service.updateClass(A, record.id, { teacherId: bad }); } catch (_) {}
      }
      const stored = readStore(dir, 'educationClasses').classes;
      expect(stored).toHaveLength(1);
      expect(stored[0].courseId).toBe(courseA.id);
      expect(stored[0].teacherId).toBe(teacherA.id);
    });

    test('relationship validation runs BEFORE the classCode uniqueness check', () => {
      const duplicate = service.createClass(A, {
        courseId: courseA.id, teacherId: teacherA.id, classCode: 'K-900', name: 'Holder'
      });
      expect(duplicate.id).not.toBe(record.id);
      // A rejected parent must not be masked by the code conflict.
      expect(() => service.updateClass(A, record.id, { courseId: 'crs-nope', classCode: 'K-900' }))
        .toThrow('courseId does not reference a Course in this tenant');
      assertBothIntact();
      expect(service.listClasses(A).map(c => c.name)).not.toContain('Renamed');
    });
  });

  // --- UNIQUENESS -----------------------------------------------------------

  test('a duplicate classCode inside one tenant raises a typed conflict', () => {
    const { course, teacher } = chain(A);
    service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100' });
    let thrown = null;
    try {
      service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100', name: 'Dup' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.conflict).toBe(true);
    expect(thrown.code).toBe('CLASS_CODE_CONFLICT');
    expect(thrown).toBeInstanceOf(service.ClassCodeConflictError);
    expect(service.listClasses(A)).toHaveLength(1);
  });

  test('an inactive class still holds its code', () => {
    const { course, teacher } = chain(A);
    service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100', status: 'inactive' });
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100' }))
      .toThrow('classCode already exists for this tenant: K-100');
  });

  test('classCode uniqueness is tenant-wide, not per course', () => {
    const one = chain(A);
    const two = chain(A, { programName: 'Other Track', courseName: 'Other Course' });
    service.createClass(A, { courseId: one.course.id, teacherId: one.teacher.id, classCode: 'K-100' });
    expect(() => service.createClass(A, { courseId: two.course.id, teacherId: two.teacher.id, classCode: 'K-100' }))
      .toThrow('classCode already exists for this tenant: K-100');
  });

  test('the same classCode in different tenants is allowed', () => {
    const one = chain(A);
    const two = chain(B);
    service.createClass(A, { courseId: one.course.id, teacherId: one.teacher.id, classCode: 'K-100' });
    expect(service.createClass(B, { courseId: two.course.id, teacherId: two.teacher.id, classCode: 'K-100' }).tenantId)
      .toBe('cls-b');
  });

  test('an archived class releases its code for reuse', () => {
    const { course, teacher } = chain(A);
    const first = service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100' });
    service.archiveClass(A, first.id);
    expect(service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100' }).classCode)
      .toBe('K-100');
    expect(service.listClasses(A)).toHaveLength(2);
  });

  test('an update to a taken classCode raises the same typed conflict', () => {
    const { course, teacher } = chain(A);
    service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-100', name: 'One' });
    const two = service.createClass(A, { courseId: course.id, teacherId: teacher.id, classCode: 'K-200', name: 'Two' });
    expect(() => service.updateClass(A, two.id, { classCode: 'K-100' }))
      .toThrow('classCode already exists for this tenant: K-100');
    expect(service.getClass(A, two.id).classCode).toBe('K-200');
  });

  // --- NO CASCADE / INTEGRITY ----------------------------------------------

  test('ARCHIVE: archiving a Teacher preserves its Class and does not cascade', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    teachers.archiveTeacher(A, teacher.id);

    const after = service.getClass(A, created.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('active');
    expect(after.teacherId).toBe(teacher.id);

    // A NEW class cannot be assigned to the archived Teacher.
    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id }))
      .toThrow('teacherId must reference a non-archived Teacher');
  });

  test('ARCHIVE: archiving a Course or Program preserves its Class and does not cascade', () => {
    const { program, course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });

    courses.archiveCourse(A, course.id);
    expect(service.getClass(A, created.id).status).toBe('active');
    expect(teachers.getTeacher(A, teacher.id).status).toBe('active');

    programs.archiveProgram(A, program.id);
    const after = service.getClass(A, created.id);
    expect(after.status).toBe('active');
    expect(after.courseId).toBe(course.id);

    expect(() => service.createClass(A, { courseId: course.id, teacherId: teacher.id }))
      .toThrow('courseId must reference a non-archived Course');
  });

  test('ARCHIVE: archiving a Center preserves its Program, Course and Class', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { program, course, teacher } = chain(A, { centerId: center.id });
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    centers.archiveCenter(A, center.id);

    expect(programs.getProgram(A, program.id).status).toBe('active');
    expect(courses.getCourse(A, course.id).status).toBe('active');
    expect(service.getClass(A, created.id).status).toBe('active');
  });

  test('Class operations never write to the Student, Teacher, Center, Program or Course stores', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { course, teacher } = chain(A, { centerId: center.id });
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    const parentsBefore = ['educationCenters', 'educationPrograms', 'educationCourses', 'educationTeachers']
      .map(key => fs.readFileSync(dir + '/' + key + '.json', 'utf8'));

    service.updateClass(A, created.id, { name: 'A2' });
    service.archiveClass(A, created.id);
    service.updateClass(A, created.id, { status: 'active' });

    ['educationCenters', 'educationPrograms', 'educationCourses', 'educationTeachers'].forEach((key, idx) => {
      expect(fs.readFileSync(dir + '/' + key + '.json', 'utf8')).toBe(parentsBefore[idx]);
    });
  });

  test('INTEGRITY: every persisted Class satisfies assignment-time integrity', () => {
    const local = chain(A);
    const archivedProgram = programs.createProgram(A, { name: 'Doomed Track' });
    const doomedCourse = courses.createCourse(A, { programId: archivedProgram.id, name: 'Doomed Course' });
    programs.archiveProgram(A, archivedProgram.id);

    service.createClass(A, { courseId: local.course.id, teacherId: local.teacher.id, name: 'Valid' });
    service.createClass(A, {
      courseId: local.course.id, teacherId: local.teacher.id, name: 'Archived', status: 'archived'
    });

    const stored = readStore(dir, 'educationClasses').classes;
    expect(stored.length).toBeGreaterThan(0);
    for (const record of stored) {
      expect(record.tenantId).toBeTruthy();
      expect(record.courseId).toBeTruthy();
      expect(record.teacherId).toBeTruthy();

      // Same-tenant resolution...
      const course = courses.getCourse({ tenantId: record.tenantId }, record.courseId);
      const teacher = teachers.getTeacher({ tenantId: record.tenantId }, record.teacherId);
      expect(course).not.toBeNull();
      expect(teacher).not.toBeNull();

      // ...and a same-tenant, non-archived Program reachable through the Course.
      const program = programs.getProgram({ tenantId: record.tenantId }, course.programId);
      expect(program).not.toBeNull();
      expect(['active', 'inactive']).toContain(program.status);

      // The doomed Course could never be referenced.
      expect(String(record.courseId)).not.toBe(doomedCourse.id);
    }
  });

  test('INTEGRITY: the derived chain Class -> Course -> Program -> Center resolves', () => {
    const center = centers.createCenter(A, { name: 'Cairo Main' });
    const { program, course, teacher } = chain(A, { centerId: center.id });
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });

    const resolvedCourse = courses.getCourse(A, created.courseId);
    const resolvedProgram = programs.getProgram(A, resolvedCourse.programId);
    const resolvedCenter = centers.getCenter(A, resolvedProgram.centerId);
    expect(resolvedCenter.id).toBe(center.id);
    expect(resolvedCenter.tenantId).toBe('cls-a');
  });

  // --- SCOPE ----------------------------------------------------------------

  test('persistence uses the educationClasses store and nothing else', () => {
    const { course, teacher } = chain(A);
    service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    expect(readStore(dir, 'educationClasses').classes).toHaveLength(1);
    // The parent stores are written too, because a Class always needs parents.
    expect(fs.readdirSync(dir).sort()).toEqual([
      'educationClasses.json',
      'educationCourses.json',
      'educationPrograms.json',
      'educationTeachers.json'
    ]);
  });

  test('a Class carries no enrollment, attendance, grading, scheduling or financial field', () => {
    const { course, teacher } = chain(A);
    const created = service.createClass(A, { courseId: course.id, teacherId: teacher.id, name: 'A1' });
    for (const key of [
      'studentId', 'studentIds', 'enrollmentId', 'enrollmentIds', 'attendance', 'grades', 'exam',
      'payment', 'tuition', 'billing', 'salary', 'payroll', 'capacity', 'level', 'programId', 'centerId',
      'dayOfWeek', 'startTime', 'endTime', 'room', 'recurrence',
      'password', 'portalToken', 'apiKey'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
    expect(Object.keys(created).sort()).toEqual([
      'classCode', 'courseId', 'createdAt', 'description', 'displayName',
      'id', 'name', 'notes', 'status', 'teacherId', 'tenantId', 'updatedAt'
    ]);
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-6 class routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('cls-http');
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

  const ownerA = () => token('clsOwner', 'cls-a', 'Owner');
  const ownerB = () => token('clsOwner', 'cls-b', 'Owner');
  const managerA = () => token('clsManager', 'cls-a', 'Manager');
  const clerkA = () => token('clsClerk', 'cls-a', 'Viewer');
  const strangerA = () => token('clsStranger', 'cls-a', 'Viewer');

  const createProgramIn = (name, tok) =>
    request(app).post(`${BASE}/programs`).set('Authorization', `Bearer ${tok}`).send({ name });
  const createCourseIn = (name, programId, tok) =>
    request(app).post(`${BASE}/courses`).set('Authorization', `Bearer ${tok}`).send({ name, programId });
  const createTeacherIn = (firstName, lastName, tok) =>
    request(app).post(`${BASE}/teachers`).set('Authorization', `Bearer ${tok}`).send({ firstName, lastName });
  const create = (body, tok) =>
    request(app).post(`${BASE}/classes`).set('Authorization', `Bearer ${tok}`).send(body);

  // Full valid chain for one tenant, returned as plain ids.
  const setup = async (tok, opts = {}) => {
    const program = await createProgramIn(opts.programName || 'English Track', tok);
    expect(program.statusCode).toBe(201);
    const course = await createCourseIn(opts.courseName || 'Grammar 101', program.body.data.id, tok);
    expect(course.statusCode).toBe(201);
    const teacher = await createTeacherIn('Nadia', opts.teacherLastName || 'Hassan', tok);
    expect(teacher.statusCode).toBe(201);
    return {
      programId: program.body.data.id,
      courseId: course.body.data.id,
      teacherId: teacher.body.data.id
    };
  };

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/classes`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/classes/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/classes`).send({ courseId: 'c', teacherId: 't' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/classes/anything`).send({ name: 'C' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/classes/anything/archive`)).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('cls-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/classes`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/classes`).send({ courseId: 'c', teacherId: 't' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Class permissions fail closed, with no bypass', async () => {
    // The stranger explicitly holds education.classes.export in its user record,
    // yet the permission is absent from backend/permissions/registry.js, so the
    // engine must refuse rather than honour the client record.
    const read = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${strangerA()}`);
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const write = await create({ courseId: 'c', teacherId: 't', name: 'Guard' }, managerA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('AUTHORIZATION: an explicitly granted, registered Class permission is honoured', async () => {
    // The clerk holds education.classes.view, which the registry now knows.
    const read = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(200);
  });

  test('AUTHORIZATION: a Manager cannot write even with an explicit permission record', async () => {
    const chain = await setup(ownerA());
    const res = await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'Guard' }, managerA());
    expect(res.statusCode).toBe(403);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('CRUD: a privileged role performs the full lifecycle', async () => {
    const chain = await setup(ownerA());
    const created = await create({
      courseId: chain.courseId, teacherId: chain.teacherId,
      name: 'Grammar A', classCode: 'K-100', description: 'Morning group'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('cls-a');
    expect(created.body.data.displayName).toBe('Grammar A');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.description).toBe('Morning group');
    expect(fetched.body.data.courseId).toBe(chain.courseId);

    const listed = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/classes/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ name: 'Grammar B' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.tenantId).toBe('cls-a');
    expect(updated.body.data.courseId).toBe(chain.courseId);
    expect(updated.body.data.teacherId).toBe(chain.teacherId);
    expect(updated.body.data.displayName).toBe('Grammar B');

    const archived = await request(app).patch(`${BASE}/classes/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  test('VALIDATION: courseId and teacherId are required and failures create nothing', async () => {
    const chain = await setup(ownerA());
    expect((await create({ teacherId: chain.teacherId }, ownerA())).statusCode).toBe(400);
    expect((await create({ courseId: chain.courseId }, ownerA())).statusCode).toBe(400);
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect((await create({ courseId: chain.courseId, teacherId: chain.teacherId, status: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ courseId: chain.courseId, teacherId: chain.teacherId, status: 'scheduled' }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('VALIDATION: forbidden server-owned, derived and later-phase fields answer 400', async () => {
    const chain = await setup(ownerA());
    for (const field of [
      'id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt', 'updatedAt',
      'studentId', 'enrollmentId', 'attendance', 'grades', 'exam', 'payment', 'tuition',
      'billing', 'salary', 'payroll', 'capacity', 'programId', 'centerId'
    ]) {
      const res = await create({ courseId: chain.courseId, teacherId: chain.teacherId, [field]: 'x' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('VALIDATION: the same forbidden fields are refused on update', async () => {
    const chain = await setup(ownerA());
    const created = await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'A1' }, ownerA());
    for (const field of ['tenantId', 'programId', 'centerId', 'studentId', 'attendance']) {
      const res = await request(app).put(`${BASE}/classes/${created.body.data.id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .send({ [field]: 'x' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
  });

  test('VALIDATION: a prototype-pollution payload is neutralized at the HTTP layer', async () => {
    const chain = await setup(ownerA());
    const raw = JSON.stringify({ courseId: chain.courseId, teacherId: chain.teacherId });
    const res = await request(app)
      .post(`${BASE}/classes`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('Content-Type', 'application/json')
      .send(raw.slice(0, -1) + ',"__proto__":{"polluted":"yes"}}');
    // Master-owned backend/middleware/security.js strips __proto__ before the
    // controller runs, so the service-level own-property check in
    // class.service._validateClass is defense in depth rather than the first
    // line of defence. Either answer is safe; pollution is not.
    expect([201, 400]).toContain(res.statusCode);
    if (res.statusCode === 400) expect(res.body.message).toMatch(/__proto__ is not allowed/);
    expect({}.polluted).toBeUndefined();
    // A stored record never carries a polluted prototype key.
    const stored = readStore(dir, 'educationClasses');
    if (stored) {
      for (const record of stored.classes) {
        expect(Object.prototype.hasOwnProperty.call(record, '__proto__')).toBe(false);
        expect(record.polluted).toBeUndefined();
      }
    }
  });

  // --- RELATIONSHIPS --------------------------------------------------------

  test('RELATIONSHIP: an unresolvable Course reference answers 400 and creates nothing', async () => {
    const local = await setup(ownerA());
    const unknown = await create({ courseId: 'crs-nope', teacherId: local.teacherId }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/courseId does not reference a Course in this tenant/);

    const foreign = await setup(ownerB());
    const foreignRes = await create({ courseId: foreign.courseId, teacherId: local.teacherId }, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    // Existence of another tenant's Course is NOT leaked.
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('RELATIONSHIP: an unresolvable Teacher reference answers 400 identically', async () => {
    const local = await setup(ownerA());
    const unknown = await create({ courseId: local.courseId, teacherId: 'tch-nope' }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/teacherId does not reference a Teacher in this tenant/);

    const foreign = await setup(ownerB());
    const foreignRes = await create({ courseId: local.courseId, teacherId: foreign.teacherId }, ownerA());
    expect(foreignRes.statusCode).toBe(400);
    expect(foreignRes.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('RELATIONSHIP: an archived Course is refused as a parent', async () => {
    const chain = await setup(ownerA());
    const archived = await request(app).patch(`${BASE}/courses/${chain.courseId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const res = await create({ courseId: chain.courseId, teacherId: chain.teacherId }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/courseId must reference a non-archived Course/);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('RELATIONSHIP: a Course whose Program is archived is refused as a parent', async () => {
    const chain = await setup(ownerA());
    const archived = await request(app).patch(`${BASE}/programs/${chain.programId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const res = await create({ courseId: chain.courseId, teacherId: chain.teacherId }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/courseId must reference a Course whose Program is not archived/);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('RELATIONSHIP: an archived Teacher is refused for a new assignment', async () => {
    const chain = await setup(ownerA());
    const archived = await request(app).patch(`${BASE}/teachers/${chain.teacherId}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const res = await create({ courseId: chain.courseId, teacherId: chain.teacherId }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/teacherId must reference a non-archived Teacher/);
    expect(readStore(dir, 'educationClasses')).toBeNull();
  });

  test('RELATIONSHIP: an archived Center does NOT block Class creation', async () => {
    const center = await request(app).post(`${BASE}/centers`)
      .set('Authorization', `Bearer ${ownerA()}`).send({ name: 'Cairo Main' });
    expect(center.statusCode).toBe(201);

    const chain = await setup(ownerA());
    const withCenter = await request(app).post(`${BASE}/programs`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ name: 'Centered Track', centerId: center.body.data.id });
    const course = await createCourseIn('Grammar', withCenter.body.data.id, ownerA());
    const teacher = await createTeacherIn('Nadia', 'Centered', ownerA());

    await request(app).patch(`${BASE}/centers/${center.body.data.id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);

    const res = await create({ courseId: course.body.data.id, teacherId: teacher.body.data.id }, ownerA());
    expect(res.statusCode).toBe(201);
    expect(res.body.data.courseId).toBe(course.body.data.id);
    expect(chain.courseId).not.toBe(course.body.data.id);
  });

  test('RELATIONSHIP: archiving a Teacher or Course preserves the Class (no cascade)', async () => {
    const chain = await setup(ownerA());
    const created = await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'A1' }, ownerA());
    const id = created.body.data.id;

    await request(app).patch(`${BASE}/courses/${chain.courseId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/teachers/${chain.teacherId}/archive`).set('Authorization', `Bearer ${ownerA()}`);
    await request(app).patch(`${BASE}/programs/${chain.programId}/archive`).set('Authorization', `Bearer ${ownerA()}`);

    const still = await request(app).get(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(still.statusCode).toBe(200);
    expect(still.body.data.status).toBe('active');
    expect(still.body.data.courseId).toBe(chain.courseId);
    expect(still.body.data.teacherId).toBe(chain.teacherId);
    expect(readStore(dir, 'educationClasses').classes).toHaveLength(1);
  });

  // --- UPDATE INTEGRITY over HTTP ------------------------------------------

  describe('UPDATE INTEGRITY: PUT cannot clear either relationship', () => {
    let courseA;
    let courseB;
    let teacherA;
    let teacherB;
    let classId;

    beforeEach(async () => {
      const first = await setup(ownerA());
      const second = await setup(ownerA(), { programName: 'Math Track', courseName: 'Algebra', teacherLastName: 'Second' });
      courseA = first.courseId;
      courseB = second.courseId;
      teacherA = first.teacherId;
      teacherB = second.teacherId;
      const created = await create({ courseId: courseA, teacherId: teacherA, name: 'A1' }, ownerA());
      expect(created.statusCode).toBe(201);
      classId = created.body.data.id;
    });

    const put = body => request(app)
      .put(`${BASE}/classes/${classId}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send(body);

    const assertBothIntact = async () => {
      const current = await request(app).get(`${BASE}/classes/${classId}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(current.statusCode).toBe(200);
      expect(current.body.data.courseId).toBe(courseA);
      expect(current.body.data.teacherId).toBe(teacherA);
      const stored = readStore(dir, 'educationClasses').classes[0];
      expect(stored.courseId).toBe(courseA);
      expect(stored.teacherId).toBe(teacherA);
    };

    test('PUT with courseId = null answers 400 and preserves both relationships', async () => {
      const res = await put({ courseId: null });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId cannot be cleared/);
      await assertBothIntact();
    });

    test('PUT with courseId = "" answers 400 and preserves both relationships', async () => {
      const res = await put({ courseId: '' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId cannot be cleared/);
      await assertBothIntact();
    });

    test('PUT with a whitespace-only courseId answers 400 and preserves both relationships', async () => {
      const res = await put({ courseId: '   ' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId cannot be cleared/);
      await assertBothIntact();
    });

    test('PUT with teacherId = null answers 400 and preserves both relationships', async () => {
      const res = await put({ teacherId: null });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/teacherId cannot be cleared/);
      await assertBothIntact();
    });

    test('PUT with teacherId = "" answers 400 and preserves both relationships', async () => {
      const res = await put({ teacherId: '' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/teacherId cannot be cleared/);
      await assertBothIntact();
    });

    test('PUT without either relationship preserves both', async () => {
      const res = await put({ name: 'Renamed' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.courseId).toBe(courseA);
      expect(res.body.data.teacherId).toBe(teacherA);
      await assertBothIntact();
    });

    test('PUT with a valid same-tenant Course and Teacher reassigns both', async () => {
      const res = await put({ courseId: courseB, teacherId: teacherB });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.courseId).toBe(courseB);
      expect(res.body.data.teacherId).toBe(teacherB);
    });

    test('PUT with an invalid Course and a valid Teacher answers 400 and preserves BOTH', async () => {
      const res = await put({ courseId: 'crs-nope', teacherId: teacherB });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId does not reference a Course in this tenant/);
      await assertBothIntact();
    });

    test('PUT with a valid Course and an invalid Teacher answers 400 and preserves BOTH', async () => {
      const res = await put({ courseId: courseB, teacherId: 'tch-nope' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/teacherId does not reference a Teacher in this tenant/);
      await assertBothIntact();
    });

    test('PUT with a cross-tenant Course answers 400 and preserves BOTH', async () => {
      const foreign = await setup(ownerB());
      const res = await put({ courseId: foreign.courseId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId does not reference a Course in this tenant/);
      await assertBothIntact();
    });

    test('PUT with a cross-tenant Teacher answers 400 and preserves BOTH', async () => {
      const foreign = await setup(ownerB());
      const res = await put({ teacherId: foreign.teacherId });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/teacherId does not reference a Teacher in this tenant/);
      await assertBothIntact();
    });

    test('PUT with an archived Course answers 400 and preserves BOTH', async () => {
      await request(app).patch(`${BASE}/courses/${courseB}/archive`).set('Authorization', `Bearer ${ownerA()}`);
      const res = await put({ courseId: courseB });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/courseId must reference a non-archived Course/);
      await assertBothIntact();
    });

    test('PUT with an archived Teacher answers 400 and preserves BOTH', async () => {
      await request(app).patch(`${BASE}/teachers/${teacherB}/archive`).set('Authorization', `Bearer ${ownerA()}`);
      const res = await put({ teacherId: teacherB });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/teacherId must reference a non-archived Teacher/);
      await assertBothIntact();
    });
  });

  // --- DUPLICATES -----------------------------------------------------------

  test('DUPLICATES: a duplicate classCode answers 409 inside one tenant and succeeds across tenants', async () => {
    const local = await setup(ownerA());
    const foreign = await setup(ownerB());

    const first = await create({ courseId: local.courseId, teacherId: local.teacherId, classCode: 'K-100' }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ courseId: local.courseId, teacherId: local.teacherId, classCode: 'K-100' }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/classCode already exists for this tenant/);
    expect(dup.body.details.code).toBe('CLASS_CODE_CONFLICT');

    const other = await create({ courseId: foreign.courseId, teacherId: foreign.teacherId, classCode: 'K-100' }, ownerB());
    expect(other.statusCode).toBe(201);
    expect(other.body.data.tenantId).toBe('cls-b');
  });

  test('DUPLICATES: an archived class releases its code for reuse', async () => {
    const chain = await setup(ownerA());
    const first = await create({ courseId: chain.courseId, teacherId: chain.teacherId, classCode: 'K-100' }, ownerA());
    await request(app).patch(`${BASE}/classes/${first.body.data.id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);

    const reused = await create({ courseId: chain.courseId, teacherId: chain.teacherId, classCode: 'K-100' }, ownerA());
    expect(reused.statusCode).toBe(201);
    expect(reused.body.data.classCode).toBe('K-100');
  });

  // --- LIST FILTERS ---------------------------------------------------------

  test('LIST: status, courseId, teacherId, programId and search filters all work', async () => {
    const first = await setup(ownerA());
    const second = await setup(ownerA(), { programName: 'Math Track', courseName: 'Algebra', teacherLastName: 'Second' });
    await create({
      courseId: first.courseId, teacherId: first.teacherId, name: 'Grammar A', classCode: 'K-100', description: 'Language basics'
    }, ownerA());
    await create({ courseId: second.courseId, teacherId: second.teacherId, name: 'Algebra A' }, ownerA());

    const call = async qs => {
      const res = await request(app).get(`${BASE}/classes${qs}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(res.statusCode).toBe(200);
      return res.body.data;
    };

    expect(await call('')).toHaveLength(2);
    expect(await call('?status=active')).toHaveLength(2);
    expect(await call(`?courseId=${first.courseId}`)).toHaveLength(1);
    expect(await call(`?teacherId=${second.teacherId}`)).toHaveLength(1);
    expect(await call(`?programId=${second.programId}`)).toHaveLength(1);
    expect(await call('?programId=prg-nope')).toHaveLength(0);
    expect(await call('?search=K-100')).toHaveLength(1);
    expect(await call('?search=language basics')).toHaveLength(1);
    // No stored programId is ever exposed.
    expect(Object.prototype.hasOwnProperty.call((await call(`?programId=${second.programId}`))[0], 'programId')).toBe(false);
  });

  // --- TENANT ---------------------------------------------------------------

  test('TENANT: tenant B cannot read, update or archive tenant A classes', async () => {
    const chain = await setup(ownerA());
    const created = await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'A1' }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    expect((await request(app).get(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ name: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/classes/${id}/archive`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.name).toBe('A1');
    expect(stillA.body.data.status).toBe('active');
  });

  test('TENANT: tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const chain = await setup(ownerA());
    const created = await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'A1' }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/classes/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'cls-b')
        .set('companyId', 'cls-b')
        .send({ name: 'A1', [field]: 'cls-b' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }

    const still = await request(app).get(`${BASE}/classes/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(still.body.data.tenantId).toBe('cls-a');
    const listB = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('TENANT: query and header tenant values never alter isolation', async () => {
    const chain = await setup(ownerA());
    await create({
      courseId: chain.courseId, teacherId: chain.teacherId, name: 'Grammar', description: 'Language basics'
    }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/classes?tenantId=cls-b&companyId=cls-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'cls-b')
      .set('companyId', 'cls-b')
      .set('branchId', 'cls-b')
      .set('X-Tenant-Id', 'cls-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('cls-a');

    const verifyB = await request(app).get(`${BASE}/classes?tenantId=cls-a&search=Language`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('TENANT: a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'clsOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('TENANT: an inactive tenant never inherits live tenant data', async () => {
    const chain = await setup(ownerA());
    await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'Live Class' }, ownerA());
    const res = await request(app).get(`${BASE}/classes`)
      .set('Authorization', `Bearer ${token('clsOwner', 'cls-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('STORE: only the educationClasses store is introduced by a Class operation', async () => {
    const chain = await setup(ownerA());
    const before = listStores(dir).sort();
    await create({ courseId: chain.courseId, teacherId: chain.teacherId, name: 'A1' }, ownerA());
    const added = listStores(dir).filter(f => !before.includes(f));

    expect(added).toEqual(['educationClasses.json']);
    expect(readStore(dir, 'educationClasses').classes).toHaveLength(1);
    // Nothing in Marketplace, TikTok/Reels or Game Hosting was touched.
    expect(added.filter(s => /tiktok|reel|market|game/i.test(s))).toEqual([]);
  });

  test('no error response leaks internals', async () => {
    const missing = await request(app).get(`${BASE}/classes/no-such-id`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    const text = JSON.stringify(missing.body);
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('cls-a');
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

  test('Class routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/classes').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
    expect((await request(app).get('/api/v1/tenant/classes').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
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
