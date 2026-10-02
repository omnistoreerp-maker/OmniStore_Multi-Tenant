'use strict';

// STU-5 Education Course records — regression suite (Device 2).
//
// Mirrors the Program suite and adds the Course-specific concern that STU-5
// calls critical: the REQUIRED Program reference must resolve INSIDE the
// trusted tenant, must exist, and must not be archived. A Program belonging to
// another tenant is indistinguishable from one that does not exist, so
// cross-tenant relationships fail closed without leaking existence.
//
// It also pins the ownership contract: a Course owns NO centerId of its own,
// because Center is derived through Course -> Program -> centerId, so two
// conflicting ownership references cannot exist.
//
// Test safety: every store lives in a fresh mkdtemp directory
// (helpers/testData). Nothing here reads or writes backend/data.

const fs = require('fs');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const { startServer } = require('./helpers/testServer');
const { makeTempDataDir, seed, readStore } = require('./helpers/testData');

const ORIGINAL_ENV = {
  CARRY: process.env.ENABLE_TENANT_CARRY,
  ROLES: process.env.ENABLE_TENANT_ROLES,
  AUTH: process.env.AUTH_REQUIRED,
  DATA: process.env.DIGITRONICS_DATA_DIR
};

const companies = [
  { id: 'crs-a', name: 'Course Tenant A', code: 'CRSA', active: true },
  { id: 'crs-b', name: 'Course Tenant B', code: 'CRSB', active: true },
  { id: 'crs-retired', name: 'Retired Course Tenant', code: 'CRSR', active: false }
];

function userRecords(password) {
  const stamp = new Date().toISOString();
  return [
    {
      id: 'u-owner', username: 'crsOwner', password, role: 'Owner', fullName: 'Course Owner',
      tenantIds: ['crs-a', 'crs-b'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding the Course permissions EXPLICITLY, so
      // the suite proves a registered, explicitly granted permission is honoured.
      id: 'u-clerk', username: 'crsClerk', password, role: 'Viewer', fullName: 'Course Clerk',
      permissions: ['education.courses.view', 'education.courses.edit'],
      tenantIds: ['crs-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      // Non-privileged staff holding a Course permission the registry does NOT
      // know, so the suite proves an unregistered permission still fails closed
      // rather than being honoured because a client record asked for it.
      id: 'u-stranger', username: 'crsStranger', password, role: 'Viewer', fullName: 'Course Stranger',
      permissions: ['education.courses.export'],
      tenantIds: ['crs-a'], createdAt: stamp, updatedAt: stamp
    },
    {
      id: 'u-manager', username: 'crsManager', password, role: 'Manager', fullName: 'Course Manager',
      tenantIds: ['crs-a'], createdAt: stamp, updatedAt: stamp
    }
  ];
}

// ---------------------------------------------------------------------------
// 1. SERVICE
// ---------------------------------------------------------------------------
describe('STU-5 course.service — trusted tenant + required Program reference', () => {
  let dir;
  let service;
  let programs;

  beforeEach(() => {
    jest.resetModules();
    dir = makeTempDataDir('crs-service');
    process.env.DIGITRONICS_DATA_DIR = dir;
    service = require('../services/course.service');
    programs = require('../services/program.service');
  });

  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  });

  const A = { tenantId: 'crs-a' };
  const B = { tenantId: 'crs-b' };

  test('every public method refuses to run without a trusted tenant', () => {
    expect(() => service.listCourses(null)).toThrow('Tenant context is required');
    expect(() => service.listCourses({})).toThrow('Tenant context is required');
    expect(() => service.getCourse(null, 'x')).toThrow('Tenant context is required');
    expect(() => service.createCourse(null, { name: 'C', programId: 'p' })).toThrow('Tenant context is required');
    expect(() => service.updateCourse(null, 'x', {})).toThrow('Tenant context is required');
    expect(() => service.archiveCourse(null, 'x')).toThrow('Tenant context is required');
  });

  test('create requires a name and a programId', () => {
    expect(() => service.createCourse(A, { programId: 'p' })).toThrow('name is required');
    expect(() => service.createCourse(A, { name: 'C' })).toThrow('programId is required');
    expect(() => service.createCourse(A, { name: 'C', programId: '  ' })).toThrow('programId is required');
    expect(() => service.createCourse(A, 'nope')).toThrow('request body must be a JSON object');
  });

  test('create stamps the trusted tenant and trims input', () => {
    const program = programs.createProgram(A, { name: 'English Track' });
    const created = service.createCourse(A, { programId: program.id, name: '  Grammar 101 ' });
    expect(created.tenantId).toBe('crs-a');
    expect(created.name).toBe('Grammar 101');
    expect(created.programId).toBe(program.id);
    expect(created.status).toBe('active');
    expect(created.courseCode).toMatch(/^CRS/);
    expect(created.createdAt).toBe(created.updatedAt);
  });

  test('displayName defaults to the name and respects an explicit value', () => {
    const program = programs.createProgram(A, { name: 'English Track' });
    expect(service.createCourse(A, { programId: program.id, name: 'Grammar' }).displayName).toBe('Grammar');
    expect(service.createCourse(A, { programId: program.id, name: 'Writing', displayName: 'Advanced Writing' }).displayName)
      .toBe('Advanced Writing');
  });

  test('a rename refreshes a derived displayName but respects an explicit one', () => {
    const program = programs.createProgram(A, { name: 'English Track' });
    const derived = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    expect(service.updateCourse(A, derived.id, { name: 'Grammar II' }).displayName).toBe('Grammar II');

    const explicit = service.createCourse(A, { programId: program.id, name: 'Writing', displayName: 'Advanced Writing' });
    expect(service.updateCourse(A, explicit.id, { name: 'Writing II' }).displayName).toBe('Advanced Writing');
  });

  // --- RELATIONSHIP INTEGRITY ------------------------------------------------

  test('RELATIONSHIP: a same-tenant Program reference is accepted', () => {
    const program = programs.createProgram(A, { name: 'English Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    expect(created.programId).toBe(program.id);
    expect(created.tenantId).toBe('crs-a');
  });

  test('RELATIONSHIP: a cross-tenant Program reference is refused', () => {
    const programB = programs.createProgram(B, { name: 'Foreign Track' });
    expect(() => service.createCourse(A, { name: 'Grammar', programId: programB.id }))
      .toThrow('programId does not reference a Program in this tenant');
    expect(service.listCourses(A)).toHaveLength(0);
    // The foreign Program is untouched.
    expect(programs.getProgram(B, programB.id)).not.toBeNull();
  });

  test('RELATIONSHIP: a nonexistent Program reference is refused identically', () => {
    expect(() => service.createCourse(A, { name: 'Grammar', programId: 'prg-does-not-exist' }))
      .toThrow('programId does not reference a Program in this tenant');
  });

  test('RELATIONSHIP: the cross-tenant and nonexistent cases are indistinguishable', () => {
    const programB = programs.createProgram(B, { name: 'Foreign Track' });
    const read = id => {
      try { service.createCourse(A, { name: 'X', programId: id }); } catch (e) { return e.message; }
      return null;
    };
    // Existence of another tenant's Program is not leaked.
    expect(read(programB.id)).toBe(read('prg-does-not-exist'));
  });

  test('RELATIONSHIP: an archived Program is refused as a parent', () => {
    const program = programs.createProgram(A, { name: 'English Track' });
    programs.archiveProgram(A, program.id);
    expect(() => service.createCourse(A, { name: 'Grammar', programId: program.id }))
      .toThrow('programId must reference a non-archived Program');
    expect(service.listCourses(A)).toHaveLength(0);
  });

  test('RELATIONSHIP: an inactive Program is still a valid parent', () => {
    const program = programs.createProgram(A, { name: 'English Track', status: 'inactive' });
    expect(service.createCourse(A, { name: 'Grammar', programId: program.id }).programId).toBe(program.id);
  });

  test('RELATIONSHIP: update refuses a cross-tenant Program reference', () => {
    const programA = programs.createProgram(A, { name: 'Track A' });
    const programB = programs.createProgram(B, { name: 'Track B' });
    const created = service.createCourse(A, { programId: programA.id, name: 'Grammar' });

    expect(() => service.updateCourse(A, created.id, { programId: programB.id }))
      .toThrow('programId does not reference a Program in this tenant');
    expect(service.getCourse(A, created.id).programId).toBe(programA.id);
  });

  test('RELATIONSHIP: update refuses an archived Program reference', () => {
    const programA = programs.createProgram(A, { name: 'Track A' });
    const programB = programs.createProgram(A, { name: 'Track B' });
    const created = service.createCourse(A, { programId: programA.id, name: 'Grammar' });
    programs.archiveProgram(A, programB.id);

    expect(() => service.updateCourse(A, created.id, { programId: programB.id }))
      .toThrow('programId must reference a non-archived Program');
    expect(service.getCourse(A, created.id).programId).toBe(programA.id);
  });

  // --- PARENT INTEGRITY (STU-5 audit fix) -----------------------------------
  //
  // Invariant: a Course ALWAYS has a valid, non-archived, same-tenant Program.
  // `programId` may be REASSIGNED but never CLEARED. These tests pin that a
  // rejected update never mutates the stored parent, which is the exact defect
  // the read-only audit found.

  describe('PARENT INTEGRITY: programId can be reassigned but never cleared', () => {
    let programA;
    let programB;
    let course;

    beforeEach(() => {
      programA = programs.createProgram(A, { name: 'Track A' });
      programB = programs.createProgram(A, { name: 'Track B' });
      course = service.createCourse(A, { programId: programA.id, name: 'Grammar' });
    });

    const assertParentIntact = () => {
      expect(service.getCourse(A, course.id).programId).toBe(programA.id);
      // The Course must still be reachable through its parent listing.
      const underParent = service.listCourses(A, { programId: programA.id });
      expect(underParent.map(c => c.id)).toContain(course.id);
    };

    test('an OMITTED programId preserves the existing parent', () => {
      const updated = service.updateCourse(A, course.id, { name: 'Updated Course' });
      expect(updated.programId).toBe(programA.id);
      expect(updated.name).toBe('Updated Course');
      assertParentIntact();
    });

    test('a valid same-tenant Program reassignment is preserved', () => {
      const updated = service.updateCourse(A, course.id, { programId: programB.id });
      expect(updated.programId).toBe(programB.id);
      expect(service.listCourses(A, { programId: programB.id }).map(c => c.id)).toContain(course.id);
    });

    test('an empty-string programId is rejected and does not mutate the parent', () => {
      expect(() => service.updateCourse(A, course.id, { programId: '' }))
        .toThrow('programId cannot be cleared');
      assertParentIntact();
    });

    test('a null programId is rejected and does not mutate the parent', () => {
      expect(() => service.updateCourse(A, course.id, { programId: null }))
        .toThrow('programId cannot be cleared');
      assertParentIntact();
    });

    test('a whitespace-only programId is rejected and does not mutate the parent', () => {
      expect(() => service.updateCourse(A, course.id, { programId: '   ' }))
        .toThrow('programId cannot be cleared');
      assertParentIntact();
    });

    test('an undefined programId is rejected and does not mutate the parent', () => {
      expect(() => service.updateCourse(A, course.id, { programId: undefined }))
        .toThrow('programId cannot be cleared');
      assertParentIntact();
    });

    test('a cross-tenant Program is rejected and does not mutate the parent', () => {
      const foreign = programs.createProgram(B, { name: 'Foreign Track' });
      expect(() => service.updateCourse(A, course.id, { programId: foreign.id }))
        .toThrow('programId does not reference a Program in this tenant');
      assertParentIntact();
    });

    test('a nonexistent Program is rejected and does not mutate the parent', () => {
      expect(() => service.updateCourse(A, course.id, { programId: 'prg-does-not-exist' }))
        .toThrow('programId does not reference a Program in this tenant');
      assertParentIntact();
    });

    test('an archived Program is rejected and does not mutate the parent', () => {
      programs.archiveProgram(A, programB.id);
      expect(() => service.updateCourse(A, course.id, { programId: programB.id }))
        .toThrow('programId must reference a non-archived Program');
      assertParentIntact();
    });

    test('a foreign and a nonexistent Program remain indistinguishable on update', () => {
      const foreign = programs.createProgram(B, { name: 'Foreign Track' });
      const read = id => {
        try { service.updateCourse(A, course.id, { programId: id }); } catch (e) { return e.message; }
        return null;
      };
      expect(read(foreign.id)).toBe(read('prg-does-not-exist'));
      assertParentIntact();
    });

    test('a stored Course can never be left without a program on disk', () => {
      for (const bad of ['', null, undefined, '   ']) {
        try { service.updateCourse(A, course.id, { programId: bad }); } catch (_) {}
      }
      const stored = readStore(dir, 'educationCourses').courses;
      expect(stored).toHaveLength(1);
      expect(stored[0].programId).toBe(programA.id);
    });
  });

  test('RELATIONSHIP: a failed parent check does not reserve the courseCode', () => {
    const programB = programs.createProgram(B, { name: 'Foreign Track' });
    expect(() => service.createCourse(A, { name: 'X', courseCode: 'C-100', programId: programB.id }))
      .toThrow('programId does not reference a Program in this tenant');
    const programA = programs.createProgram(A, { name: 'Track A' });
    expect(service.createCourse(A, { name: 'Y', courseCode: 'C-100', programId: programA.id }).courseCode)
      .toBe('C-100');
  });

  test('a Course owns no centerId; Center is derived through the Program', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    expect(Object.prototype.hasOwnProperty.call(created, 'centerId')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, 'centerId')).toBe(false);
    // Supplying one is refused rather than quietly stored.
    expect(() => service.createCourse(A, { programId: program.id, name: 'X', centerId: 'ctr-1' }))
      .toThrow('centerId is not writable');
  });

  // --- VALIDATION -----------------------------------------------------------

  test('server-owned fields are rejected on create, not silently ignored', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'ownerUserId', 'createdAt', 'updatedAt']) {
      expect(() => service.createCourse(A, { programId: program.id, name: 'C', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('later-phase relationship fields are refused outright', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    for (const field of ['teacherId', 'studentId', 'classId', 'enrollmentId']) {
      expect(() => service.createCourse(A, { programId: program.id, name: 'C', [field]: 'x' }))
        .toThrow(new RegExp(field + ' is not writable'));
    }
  });

  test('create validates enums and duration metadata', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const base = { programId: program.id, name: 'C' };
    expect(() => service.createCourse(A, { ...base, status: 'unknown' }))
      .toThrow('status must be one of: active, inactive, archived');
    expect(() => service.createCourse(A, { ...base, durationUnit: 'fortnights' }))
      .toThrow('durationUnit must be one of: days, weeks, months');
    expect(() => service.createCourse(A, { ...base, durationValue: 0 }))
      .toThrow('durationValue must be an integer between 1 and 1000');
    expect(() => service.createCourse(A, { ...base, durationValue: 1001 }))
      .toThrow('durationValue must be an integer between 1 and 1000');
    expect(() => service.createCourse(A, { ...base, durationValue: '8' }))
      .toThrow('durationValue must be a number');
  });

  test('every declared status and duration unit is accepted', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    for (const status of ['active', 'inactive', 'archived']) {
      expect(service.createCourse(A, { programId: program.id, name: 'c-' + status, status }).status).toBe(status);
    }
    for (const unit of ['days', 'weeks', 'months']) {
      expect(service.createCourse(A, {
        programId: program.id, name: 'u-' + unit, durationValue: 4, durationUnit: unit
      }).durationUnit).toBe(unit);
    }
  });

  test('oversized input is rejected rather than silently truncated', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    expect(() => service.createCourse(A, { programId: program.id, name: 'x'.repeat(400) }))
      .toThrow('name must be at most 160 characters');
  });

  test('prototype-pollution payloads are rejected and never pollute Object', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const payload = JSON.parse('{"programId":"' + program.id + '","name":"C","__proto__":{"polluted":"yes"}}');
    expect(() => service.createCourse(A, payload)).toThrow('__proto__ is not allowed');
    expect({}.polluted).toBeUndefined();
  });

  // --- LIST / CRUD ----------------------------------------------------------

  test('list is tenant-scoped, sorted by name and copies records', () => {
    const programA = programs.createProgram(A, { name: 'Track' });
    service.createCourse(A, { programId: programA.id, name: 'Zulu' });
    service.createCourse(A, { programId: programA.id, name: 'Adams' });
    const programB = programs.createProgram(B, { name: 'Track' });
    service.createCourse(B, { programId: programB.id, name: 'Beta' });

    const listA = service.listCourses(A);
    expect(listA.map(c => c.name)).toEqual(['Adams', 'Zulu']);
    listA[0].name = 'mutated';
    expect(service.listCourses(A).find(c => c.name === 'Adams').name).toBe('Adams');
  });

  test('list filters by status, programId and search', () => {
    const programA = programs.createProgram(A, { name: 'Track A' });
    const programB = programs.createProgram(A, { name: 'Track B' });
    service.createCourse(A, { programId: programA.id, name: 'Grammar', courseCode: 'C-100', description: 'Language basics' });
    service.createCourse(A, { programId: programB.id, name: 'Closed', status: 'archived' });
    const foreignProgram = programs.createProgram(B, { name: 'Foreign' });
    service.createCourse(B, { programId: foreignProgram.id, name: 'Elsewhere' });

    expect(service.listCourses(A, { status: 'active' })).toHaveLength(1);
    expect(service.listCourses(A, { status: 'archived' })[0].name).toBe('Closed');
    expect(service.listCourses(A, { status: 'nonsense' })).toHaveLength(2);
    expect(service.listCourses(A, { programId: programA.id })).toHaveLength(1);
    // A foreign programId filter cannot reach another tenant's courses.
    expect(service.listCourses(A, { programId: foreignProgram.id })).toHaveLength(0);

    expect(service.listCourses(A, { search: 'c-100' })).toHaveLength(1);
    expect(service.listCourses(A, { search: 'language basics' })).toHaveLength(1);
    expect(service.listCourses(A, { search: 'elsewhere' })).toHaveLength(0);
  });

  test('a tenant cannot read, update or archive another tenant course', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    expect(service.getCourse(B, created.id)).toBeNull();
    expect(service.updateCourse(B, created.id, { name: 'hack' })).toBeNull();
    expect(service.archiveCourse(B, created.id)).toBeNull();
    expect(service.getCourse(A, created.id).name).toBe('Grammar');
    expect(service.getCourse(A, created.id).status).toBe('active');
  });

  test('update is a partial merge that preserves id, tenantId and createdAt', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar', notes: 'first' });
    const updated = service.updateCourse(A, created.id, { level: 'B2' });
    expect(updated.id).toBe(created.id);
    expect(updated.tenantId).toBe('crs-a');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.programId).toBe(program.id);
    expect(updated.notes).toBe('first');
    expect(updated.level).toBe('B2');
    expect(updated.updatedAt).not.toBe(created.updatedAt);
  });

  test('archive sets archived, bumps updatedAt, preserves the record and is idempotent', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    const once = service.archiveCourse(A, created.id);
    expect(once.status).toBe('archived');
    expect(once.tenantId).toBe('crs-a');
    expect(once.createdAt).toBe(created.createdAt);
    expect(once.updatedAt).not.toBe(created.updatedAt);
    expect(service.archiveCourse(A, created.id).status).toBe('archived');
    expect(service.archiveCourse(A, 'no-such-id')).toBeNull();
    // Preserved, never deleted.
    expect(readStore(dir, 'educationCourses').courses).toHaveLength(1);
  });

  test('ARCHIVE: archiving a Program preserves its Courses and does not cascade', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const course = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    programs.archiveProgram(A, program.id);

    // The Course survives, keeps its programId, and stays readable.
    const after = service.getCourse(A, course.id);
    expect(after).not.toBeNull();
    expect(after.status).toBe('active');
    expect(after.programId).toBe(program.id);

    // A NEW course cannot be hung off the archived Program.
    expect(() => service.createCourse(A, { programId: program.id, name: 'Late' }))
      .toThrow('programId must reference a non-archived Program');
  });

  test('ARCHIVE: archiving a Center does not archive its Programs or Courses', () => {
    const centers = require('../services/center.service');
    const centerA = centers.createCenter(A, { name: 'Cairo Main' });
    const program = programs.createProgram(A, { name: 'Track', centerId: centerA.id });
    const course = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    centers.archiveCenter(A, centerA.id);

    // STU-5 does not modify Center behavior and invents no cascade.
    expect(programs.getProgram(A, program.id).status).toBe('active');
    expect(service.getCourse(A, course.id).status).toBe('active');
  });

  // --- DUPLICATES ------------------------------------------------------------

  test('a duplicate courseCode inside one tenant raises a typed conflict', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    service.createCourse(A, { programId: program.id, name: 'Grammar', courseCode: 'C-100' });
    let thrown = null;
    try {
      service.createCourse(A, { programId: program.id, name: 'Other', courseCode: 'C-100' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).not.toBeNull();
    expect(thrown.conflict).toBe(true);
    expect(thrown.code).toBe('COURSE_CODE_CONFLICT');
    expect(thrown).toBeInstanceOf(service.CourseCodeConflictError);
    expect(service.listCourses(A)).toHaveLength(1);
  });

  test('the same courseCode in different tenants is allowed', () => {
    const programA = programs.createProgram(A, { name: 'Track A' });
    const programB = programs.createProgram(B, { name: 'Track B' });
    service.createCourse(A, { programId: programA.id, name: 'Grammar', courseCode: 'C-100' });
    expect(service.createCourse(B, { programId: programB.id, name: 'Grammar', courseCode: 'C-100' }).tenantId)
      .toBe('crs-b');
  });

  test('an archived course releases its code for reuse', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const first = service.createCourse(A, { programId: program.id, name: 'Old', courseCode: 'C-100' });
    service.archiveCourse(A, first.id);
    expect(service.createCourse(A, { programId: program.id, name: 'New', courseCode: 'C-100' }).courseCode)
      .toBe('C-100');
    expect(service.listCourses(A)).toHaveLength(2);
  });

  test('an inactive course still holds its code', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    service.createCourse(A, { programId: program.id, name: 'P', courseCode: 'C-100', status: 'inactive' });
    expect(() => service.createCourse(A, { programId: program.id, name: 'Dup', courseCode: 'C-100' }))
      .toThrow('courseCode already exists for this tenant: C-100');
  });

  test('courseCode uniqueness is tenant-wide, not per program', () => {
    const programA = programs.createProgram(A, { name: 'Track A' });
    const programB = programs.createProgram(A, { name: 'Track B' });
    service.createCourse(A, { programId: programA.id, name: 'One', courseCode: 'C-100' });
    // The same code under a different Program in the SAME tenant still collides.
    expect(() => service.createCourse(A, { programId: programB.id, name: 'Two', courseCode: 'C-100' }))
      .toThrow('courseCode already exists for this tenant: C-100');
  });

  // --- SCOPE -----------------------------------------------------------------

  test('persistence uses the educationCourses store and nothing else', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    service.createCourse(A, { programId: program.id, name: 'Grammar' });
    expect(readStore(dir, 'educationCourses').courses).toHaveLength(1);
    // The Program store is written too, because a Course always needs a parent.
    expect(fs.readdirSync(dir).sort()).toEqual(['educationCourses.json', 'educationPrograms.json']);
  });

  test('a Course carries no teacher, student, class, enrollment or financial field', () => {
    const program = programs.createProgram(A, { name: 'Track' });
    const created = service.createCourse(A, { programId: program.id, name: 'Grammar' });
    for (const key of [
      'teacherId', 'studentId', 'classId', 'enrollmentId',
      'price', 'tuition', 'payment', 'billing', 'invoice', 'revenue',
      'salary', 'payroll', 'bankAccount', 'accountId',
      'password', 'portalToken', 'apiKey'
    ]) {
      expect(Object.prototype.hasOwnProperty.call(created, key)).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(service.WRITABLE_FIELDS, key)).toBe(false);
    }
    expect(Object.keys(created).filter(k => /tenant/i.test(k))).toEqual(['tenantId']);
  });
});

// ---------------------------------------------------------------------------
// 2. HTTP
// ---------------------------------------------------------------------------
describe('STU-5 course routes — authorization and tenant isolation', () => {
  const BASE = '/api/v1/tenant/education';
  let app;
  let jwt;
  let dir;

  beforeEach(() => {
    dir = makeTempDataDir('crs-http');
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

  const ownerA = () => token('crsOwner', 'crs-a', 'Owner');
  const ownerB = () => token('crsOwner', 'crs-b', 'Owner');
  const managerA = () => token('crsManager', 'crs-a', 'Manager');
  const clerkA = () => token('crsClerk', 'crs-a', 'Viewer');
  const strangerA = () => token('crsStranger', 'crs-a', 'Viewer');

  const createProgramIn = (name, tok) =>
    request(app).post(`${BASE}/programs`).set('Authorization', `Bearer ${tok}`).send({ name });
  const create = (body, tok) =>
    request(app).post(`${BASE}/courses`).set('Authorization', `Bearer ${tok}`).send(body);

  test('AUTH: unauthenticated access is refused on every route', async () => {
    expect((await request(app).get(`${BASE}/courses`)).statusCode).toBe(401);
    expect((await request(app).get(`${BASE}/courses/anything`)).statusCode).toBe(401);
    expect((await request(app).post(`${BASE}/courses`).send({ name: 'C', programId: 'p' })).statusCode).toBe(401);
    expect((await request(app).put(`${BASE}/courses/anything`).send({ name: 'C' })).statusCode).toBe(401);
    expect((await request(app).patch(`${BASE}/courses/anything/archive`)).statusCode).toBe(401);
  });

  test('AUTH: the strict gate does not degrade when AUTH_REQUIRED is false', async () => {
    const lenientDir = makeTempDataDir('crs-lenient');
    seed(lenientDir, 'companies', companies);
    seed(lenientDir, 'users', { users: userRecords(bcrypt.hashSync('Pass#123', 10)) });
    const lenientApp = startServer(lenientDir, {}).app;
    try {
      expect((await request(lenientApp).get(`${BASE}/courses`)).statusCode).toBe(401);
      expect((await request(lenientApp).post(`${BASE}/courses`).send({ name: 'C', programId: 'p' })).statusCode).toBe(401);
    } finally {
      try { fs.rmSync(lenientDir, { recursive: true, force: true }); } catch (_) {}
    }
  });

  test('AUTHORIZATION: unregistered Course permissions fail closed, with no bypass', async () => {
    // The stranger explicitly holds education.courses.export in its user record,
    // yet the permission is absent from backend/permissions/registry.js, so the
    // engine must refuse rather than honour the client record.
    const read = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${strangerA()}`);
    expect(read.statusCode).toBe(403);
    expect(read.body.details.code).toBe('PERMISSION_DENIED');

    const write = await create({ name: 'Guard', programId: 'p' }, managerA());
    expect(write.statusCode).toBe(403);
    expect(['Insufficient role', 'Insufficient permission']).toContain(write.body.message);
    expect(readStore(dir, 'educationCourses')).toBeNull();
  });

  test('AUTHORIZATION: an explicitly granted, registered Course permission is honoured', async () => {
    // The clerk holds education.courses.view, which the registry now knows.
    const read = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${clerkA()}`);
    expect(read.statusCode).toBe(200);
  });

  test('CRUD: a privileged role performs the full lifecycle', async () => {
    const program = await createProgramIn('English Track', ownerA());
    expect(program.statusCode).toBe(201);

    const created = await create({
      programId: program.body.data.id, name: 'Grammar 101', level: 'B2', durationValue: 8, durationUnit: 'weeks'
    }, ownerA());
    expect(created.statusCode).toBe(201);
    expect(created.body.data.tenantId).toBe('crs-a');
    expect(created.body.data.displayName).toBe('Grammar 101');
    const id = created.body.data.id;

    const fetched = await request(app).get(`${BASE}/courses/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(fetched.statusCode).toBe(200);
    expect(fetched.body.data.durationValue).toBe(8);

    const listed = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${ownerA()}`);
    expect(listed.body.data).toHaveLength(1);

    const updated = await request(app).put(`${BASE}/courses/${id}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send({ name: 'Grammar 102' });
    expect(updated.statusCode).toBe(200);
    expect(updated.body.data.tenantId).toBe('crs-a');
    expect(updated.body.data.programId).toBe(program.body.data.id);
    expect(updated.body.data.displayName).toBe('Grammar 102');

    const archived = await request(app).patch(`${BASE}/courses/${id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);
    expect(archived.body.data.status).toBe('archived');
  });

  test('VALIDATION: programId is required and validation failures create nothing', async () => {
    expect((await create({ name: 'C' }, ownerA())).statusCode).toBe(400);
    expect((await create({}, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'C', programId: 'p', status: 'nope' }, ownerA())).statusCode).toBe(400);
    expect((await create({ name: 'C', programId: 'p', durationValue: -5 }, ownerA())).statusCode).toBe(400);
    expect(readStore(dir, 'educationCourses')).toBeNull();
  });

  test('VALIDATION: forbidden server-owned and later-phase fields answer 400', async () => {
    for (const field of ['id', 'tenantId', 'companyId', 'branchId', 'userId', 'teacherId', 'studentId', 'classId', 'enrollmentId', 'centerId']) {
      const res = await create({ name: 'C', programId: 'p', [field]: 'x' }, ownerA());
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }
  });

  test('RELATIONSHIP: an unresolvable Program reference answers 400 and creates nothing', async () => {
    const unknown = await create({ name: 'C', programId: 'prg-nope' }, ownerA());
    expect(unknown.statusCode).toBe(400);
    expect(unknown.body.message).toMatch(/programId does not reference a Program in this tenant/);

    // A Program from another tenant is refused with the SAME message.
    const programB = await createProgramIn('Foreign Track', ownerB());
    expect(programB.statusCode).toBe(201);
    const foreign = await create({ name: 'C', programId: programB.body.data.id }, ownerA());
    expect(foreign.statusCode).toBe(400);
    expect(foreign.body.message).toBe(unknown.body.message);
    expect(readStore(dir, 'educationCourses')).toBeNull();
  });

  test('RELATIONSHIP: an archived Program is refused as a parent', async () => {
    const program = await createProgramIn('English Track', ownerA());
    const archivedProgram = await request(app).patch(`${BASE}/programs/${program.body.data.id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archivedProgram.statusCode).toBe(200);

    const res = await create({ name: 'C', programId: program.body.data.id }, ownerA());
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/programId must reference a non-archived Program/);
    expect(readStore(dir, 'educationCourses')).toBeNull();
  });

  // --- PARENT INTEGRITY over HTTP (STU-5 audit fix) -------------------------
  describe('PARENT INTEGRITY: PUT cannot clear the parent Program', () => {
    let programA;
    let programB;
    let courseId;

    beforeEach(async () => {
      programA = await createProgramIn('Track A', ownerA());
      programB = await createProgramIn('Track B', ownerA());
      const created = await create({ name: 'Grammar', programId: programA.body.data.id }, ownerA());
      expect(created.statusCode).toBe(201);
      courseId = created.body.data.id;
    });

    const assertParentIntact = async () => {
      const current = await request(app).get(`${BASE}/courses/${courseId}`).set('Authorization', `Bearer ${ownerA()}`);
      expect(current.statusCode).toBe(200);
      expect(current.body.data.programId).toBe(programA.body.data.id);
      // Still reachable through the parent listing.
      const underParent = await request(app)
        .get(`${BASE}/courses?programId=${programA.body.data.id}`)
        .set('Authorization', `Bearer ${ownerA()}`);
      expect(underParent.body.data.map(c => c.id)).toContain(courseId);
    };

    const put = body => request(app)
      .put(`${BASE}/courses/${courseId}`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .send(body);

    test('PUT with programId = "" answers 400 and preserves the parent', async () => {
      const res = await put({ programId: '' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId cannot be cleared/);
      await assertParentIntact();
    });

    test('PUT with programId = null answers 400 and preserves the parent', async () => {
      const res = await put({ programId: null });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId cannot be cleared/);
      await assertParentIntact();
    });

    test('PUT with a whitespace-only programId answers 400 and preserves the parent', async () => {
      const res = await put({ programId: '   ' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId cannot be cleared/);
      await assertParentIntact();
    });

    test('PUT without programId succeeds and preserves the parent', async () => {
      const res = await put({ name: 'Updated Course' });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.programId).toBe(programA.body.data.id);
      await assertParentIntact();
    });

    test('PUT with a valid same-tenant Program reassigns the parent', async () => {
      const res = await put({ programId: programB.body.data.id });
      expect(res.statusCode).toBe(200);
      expect(res.body.data.programId).toBe(programB.body.data.id);
    });

    test('PUT with an archived Program answers 400 and preserves the parent', async () => {
      await request(app).patch(`${BASE}/programs/${programB.body.data.id}/archive`)
        .set('Authorization', `Bearer ${ownerA()}`);
      const res = await put({ programId: programB.body.data.id });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId must reference a non-archived Program/);
      await assertParentIntact();
    });

    test('PUT with a cross-tenant Program answers 400 and preserves the parent', async () => {
      const foreign = await createProgramIn('Foreign Track', ownerB());
      const res = await put({ programId: foreign.body.data.id });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId does not reference a Program in this tenant/);
      await assertParentIntact();
    });

    test('PUT with a nonexistent Program answers 400 and preserves the parent', async () => {
      const res = await put({ programId: 'prg-nope' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(/programId does not reference a Program in this tenant/);
      await assertParentIntact();
    });

    test('a foreign and a nonexistent Program remain indistinguishable over HTTP', async () => {
      const foreign = await createProgramIn('Foreign Track', ownerB());
      const foreignRes = await put({ programId: foreign.body.data.id });
      const unknownRes = await put({ programId: 'prg-nope' });
      expect(foreignRes.body.message).toBe(unknownRes.body.message);
      await assertParentIntact();
    });
  });

  test('RELATIONSHIP: archiving a Program preserves its Course (no cascade)', async () => {
    const program = await createProgramIn('English Track', ownerA());
    const created = await create({ name: 'Grammar', programId: program.body.data.id }, ownerA());
    const courseId = created.body.data.id;

    const archived = await request(app).patch(`${BASE}/programs/${program.body.data.id}/archive`)
      .set('Authorization', `Bearer ${ownerA()}`);
    expect(archived.statusCode).toBe(200);

    const still = await request(app).get(`${BASE}/courses/${courseId}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(still.statusCode).toBe(200);
    expect(still.body.data.status).toBe('active');
    expect(still.body.data.programId).toBe(program.body.data.id);
    expect(readStore(dir, 'educationCourses').courses).toHaveLength(1);
  });

  test('DUPLICATES: a duplicate courseCode answers 409 inside one tenant and succeeds across tenants', async () => {
    const programA = await createProgramIn('Track A', ownerA());
    const programB = await createProgramIn('Track B', ownerB());

    const first = await create({ name: 'Grammar', programId: programA.body.data.id, courseCode: 'C-100' }, ownerA());
    expect(first.statusCode).toBe(201);

    const dup = await create({ name: 'Dup', programId: programA.body.data.id, courseCode: 'C-100' }, ownerA());
    expect(dup.statusCode).toBe(409);
    expect(dup.body.message).toMatch(/courseCode already exists for this tenant/);
    expect(dup.body.details.code).toBe('COURSE_CODE_CONFLICT');

    const otherTenant = await create({ name: 'Grammar', programId: programB.body.data.id, courseCode: 'C-100' }, ownerB());
    expect(otherTenant.statusCode).toBe(201);
    expect(otherTenant.body.data.tenantId).toBe('crs-b');
  });

  test('TENANT: tenant B cannot read, update or archive tenant A courses', async () => {
    const program = await createProgramIn('Track', ownerA());
    const created = await create({ name: 'Grammar', programId: program.body.data.id }, ownerA());
    const id = created.body.data.id;

    const listedB = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listedB.body.data).toHaveLength(0);

    expect((await request(app).get(`${BASE}/courses/${id}`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);
    expect((await request(app).put(`${BASE}/courses/${id}`).set('Authorization', `Bearer ${ownerB()}`).send({ name: 'hijack' })).statusCode).toBe(404);
    expect((await request(app).patch(`${BASE}/courses/${id}/archive`).set('Authorization', `Bearer ${ownerB()}`)).statusCode).toBe(404);

    const stillA = await request(app).get(`${BASE}/courses/${id}`).set('Authorization', `Bearer ${ownerA()}`);
    expect(stillA.body.data.name).toBe('Grammar');
    expect(stillA.body.data.status).toBe('active');
  });

  test('TENANT: tenantId, companyId and branchId spoofing cannot move a record', async () => {
    const program = await createProgramIn('Track', ownerA());
    const created = await create({ name: 'Grammar', programId: program.body.data.id }, ownerA());
    const id = created.body.data.id;

    for (const field of ['tenantId', 'companyId', 'branchId']) {
      const res = await request(app).put(`${BASE}/courses/${id}`)
        .set('Authorization', `Bearer ${ownerA()}`)
        .set('tenantId', 'crs-b')
        .set('companyId', 'crs-b')
        .send({ name: 'Grammar', [field]: 'crs-b' });
      expect(res.statusCode).toBe(400);
      expect(res.body.message).toMatch(new RegExp(field + ' is not writable'));
    }

    const listB = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${ownerB()}`);
    expect(listB.body.data).toHaveLength(0);
  });

  test('TENANT: query and header tenant values never alter isolation', async () => {
    const program = await createProgramIn('Track', ownerA());
    await create({ name: 'Grammar', programId: program.body.data.id, description: 'Language basics' }, ownerA());

    const spoofed = await request(app)
      .get(`${BASE}/courses?tenantId=crs-b&companyId=crs-b`)
      .set('Authorization', `Bearer ${ownerA()}`)
      .set('tenantId', 'crs-b')
      .set('companyId', 'crs-b')
      .set('X-Tenant-Id', 'crs-b');
    expect(spoofed.statusCode).toBe(200);
    expect(spoofed.body.data).toHaveLength(1);
    expect(spoofed.body.data[0].tenantId).toBe('crs-a');

    const verifyB = await request(app).get(`${BASE}/courses?tenantId=crs-a&search=Language`)
      .set('Authorization', `Bearer ${ownerB()}`);
    expect(verifyB.body.data).toHaveLength(0);
  });

  test('a missing tenant claim fails closed with 400', async () => {
    const legacy = jwt.signAccessToken({ id: 'u-owner', username: 'crsOwner', role: 'Owner' });
    const res = await request(app).get(`${BASE}/courses`).set('Authorization', `Bearer ${legacy}`);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe('Tenant context required');
  });

  test('an inactive tenant never inherits a live tenant data', async () => {
    const program = await createProgramIn('Track', ownerA());
    await create({ name: 'Live Course', programId: program.body.data.id }, ownerA());
    const res = await request(app).get(`${BASE}/courses`)
      .set('Authorization', `Bearer ${token('crsOwner', 'crs-retired', 'Owner')}`);
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test('no error response leaks internals', async () => {
    const missing = await request(app).get(`${BASE}/courses/no-such-id`).set('Authorization', `Bearer ${ownerA()}`);
    expect(missing.statusCode).toBe(404);
    const text = JSON.stringify(missing.body);
    expect(text).not.toContain('at Object.');
    expect(text).not.toContain('node_modules');
    expect(text).not.toContain('crs-a');
  });

  test('REGRESSION: the earlier Education routes are not shadowed', async () => {
    const caps = await request(app).get(`${BASE}/capabilities`).set('Authorization', `Bearer ${ownerA()}`);
    for (const key of ['students', 'teachers', 'centers', 'programs', 'courses', 'classes', 'enrollments', 'attendance', 'scheduling', 'grading']) {
      expect(caps.body.data.find(c => c.key === key).implemented).toBe(true);
    }
    expect(caps.body.data.find(c => c.key === 'scheduling').phase).toBe('STU-9');
    expect(caps.body.data.find(c => c.key === 'grading').implemented).toBe(true);
    expect(caps.body.data.find(c => c.key === 'grading').phase).toBe('STU-10');

    expect((await request(app).get(`${BASE}/students`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/teachers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/centers`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/programs`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
    expect((await request(app).get(`${BASE}/classes`).set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(200);
  });

  test('Course routes are not mounted outside the Education namespace', async () => {
    expect((await request(app).get('/api/v1/courses').set('Authorization', `Bearer ${ownerA()}`)).statusCode).toBe(404);
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