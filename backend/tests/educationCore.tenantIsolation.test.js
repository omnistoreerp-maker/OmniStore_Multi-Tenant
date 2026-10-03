'use strict';

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/educationCore.service');
}

// Phase 6 — explicit tenant isolation matrix for the education core.
// Tenant A -> Tenant A = PASS ; Tenant A -> Tenant B = DENY for every operation.
describe('educationCore tenant isolation', () => {
  let dataDir;
  let svc;
  const A = { tenantId: 'tenant-a' };
  const B = { tenantId: 'tenant-b' };

  beforeEach(() => {
    dataDir = makeTempDataDir('edu-iso');
    svc = loadService(dataDir);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  function seed(ctx, label) {
    const center = svc.createCenter(ctx, { name: label + '-center' });
    const teacher = svc.createTeacher(ctx, { displayName: label + '-teacher', centerId: center.id });
    const student = svc.createStudent(ctx, { displayName: label + '-student', centerId: center.id });
    const course = svc.createCourse(ctx, { title: label + '-course', centerId: center.id, teacherId: teacher.id });
    const lesson = svc.createLesson(ctx, { title: label + '-lesson', courseId: course.id });
    const enrollment = svc.createEnrollment(ctx, { courseId: course.id, studentId: student.id });
    return { center, teacher, student, course, lesson, enrollment };
  }

  test('list endpoints never leak across tenants', () => {
    seed(A, 'a');
    seed(B, 'b');

    expect(svc.listCenters(A).total).toBe(1);
    expect(svc.listCenters(B).total).toBe(1);
    expect(svc.listCenters(A).items[0].name).toBe('a-center');
    expect(svc.listTeachers(A).items[0].displayName).toBe('a-teacher');
    expect(svc.listStudents(B).items[0].displayName).toBe('b-student');
    expect(svc.listCourses(A).items[0].title).toBe('a-course');
    expect(svc.listEnrollments(B).total).toBe(1);
  });

  test('a tenant cannot read or mutate another tenant records', () => {
    const a = seed(A, 'a');
    seed(B, 'b');

    expect(() => svc.getCenter(B, a.center.id)).toThrow(/Center not found/);
    expect(() => svc.getCourse(B, a.course.id)).toThrow(/Course not found/);
    expect(() => svc.updateStudent(B, a.student.id, { displayName: 'hijack' })).toThrow(/Student not found/);
    expect(() => svc.deleteCenter(B, a.center.id)).toThrow(/Center not found/);
    expect(() => svc.getEnrollmentProgress(B, a.enrollment.id)).toThrow(/Enrollment not found/);
  });

  test('a tenant cannot link its records to another tenant references', () => {
    const a = seed(A, 'a');
    const b = seed(B, 'b');

    // Tenant B tries to attach its own course to tenant A's center/teacher.
    expect(() => svc.createCourse(B, { title: 'evil', centerId: a.center.id })).toThrow(/Center not found/);
    expect(() => svc.createCourse(B, { title: 'evil', centerId: b.center.id, teacherId: a.teacher.id })).toThrow(/Teacher not found/);

    // Tenant B tries to enroll its student into tenant A's course.
    expect(() => svc.createEnrollment(B, { courseId: a.course.id, studentId: b.student.id })).toThrow(/Course not found/);

    // Tenant B tries to mark progress using tenant A's enrollment.
    expect(() => svc.markLessonComplete(B, { enrollmentId: a.enrollment.id, lessonId: b.lesson.id })).toThrow(/Enrollment not found/);
  });

  test('listing lessons of another tenant course is denied', () => {
    const a = seed(A, 'a');
    seed(B, 'b');
    expect(() => svc.listLessons(B, a.course.id)).toThrow(/Course not found/);
    expect(svc.listLessons(A, a.course.id).length).toBe(1);
  });

  test('identically-named cross-tenant records stay independent', () => {
    const a = seed(A, 'a');
    const b = seed(B, 'b');
    expect(a.center.id).not.toBe(b.center.id);

    svc.deleteLesson(A, a.lesson.id);
    expect(svc.listLessons(B, b.course.id).length).toBe(1); // B untouched

    svc.updateCenter(A, a.center.id, { status: 'inactive' });
    expect(svc.getCenter(B, b.center.id).status).toBe('active');

    expect(svc.getEnrollmentProgress(B, b.enrollment.id).percentage).toBe(0);
  });

  test('missing tenant context is rejected on every write', () => {
    expect(() => svc.createCenter(null, { name: 'x' })).toThrow(/Tenant context is required/);
    expect(() => svc.createTeacher(null, { displayName: 'x' })).toThrow(/Tenant context is required/);
    expect(() => svc.createStudent(null, { displayName: 'x' })).toThrow(/Tenant context is required/);
    expect(() => svc.createCourse(null, { title: 'x', centerId: 'c' })).toThrow(/Tenant context is required/);
    expect(() => svc.createLesson(null, { title: 'x', courseId: 'c' })).toThrow(/Tenant context is required/);
    expect(() => svc.createEnrollment(null, { courseId: 'c', studentId: 's' })).toThrow(/Tenant context is required/);
    expect(() => svc.markLessonComplete(null, {})).toThrow(/Tenant context is required/);
  });
});
