'use strict';

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/educationCore.service');
}

describe('educationCore service', () => {
  let dataDir;
  let svc;
  const t = { tenantId: 'acme' };

  beforeEach(() => {
    dataDir = makeTempDataDir('edu-core');
    svc = loadService(dataDir);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('missing tenant context is rejected on reads and writes', () => {
    expect(() => svc.listCenters(null)).toThrow(/Tenant context is required/);
    expect(() => svc.createCenter(null, { name: 'X' })).toThrow(/Tenant context is required/);
    expect(() => svc.createStudent(null, { displayName: 'S' })).toThrow(/Tenant context is required/);
  });

  test('center requires a name and persists', () => {
    expect(() => svc.createCenter(t, {})).toThrow(/name is required/);
    const center = svc.createCenter(t, { name: 'Main Center', subjects: ['Math', 'Math', 'Physics'] });
    expect(center.id).toMatch(/^center-/);
    expect(center.tenantId).toBe('acme');
    expect(center.status).toBe('active');
    expect(center.subjects).toEqual(['Math', 'Physics']);
    expect(svc.listCenters(t).total).toBe(1);
    expect(svc.getCenter(t, center.id).name).toBe('Main Center');
  });

  test('teacher referencing an unknown center is rejected', () => {
    expect(() => svc.createTeacher(t, { displayName: 'T', centerId: 'nope' })).toThrow(/Center not found/);
    const c = svc.createCenter(t, { name: 'C' });
    const teacher = svc.createTeacher(t, { displayName: 'T', centerId: c.id, subjects: ['Math'] });
    expect(teacher.centerId).toBe(c.id);
    expect(svc.listTeachers(t, { centerId: c.id }).total).toBe(1);
  });

  test('course requires a valid center and a same-tenant teacher', () => {
    expect(() => svc.createCourse(t, { title: 'Algebra' })).toThrow(/centerId is required/);
    const c = svc.createCenter(t, { name: 'C' });
    const teacher = svc.createTeacher(t, { displayName: 'T', centerId: c.id });
    const course = svc.createCourse(t, { title: 'Algebra', centerId: c.id, teacherId: teacher.id });
    expect(course.status).toBe('draft');
    expect(svc.getCourse(t, course.id).title).toBe('Algebra');
    expect(svc.listCourses(t, { status: 'draft' }).total).toBe(1);
    expect(() => svc.createCourse(t, { title: 'X', centerId: c.id, teacherId: 'ghost' })).toThrow(/Teacher not found/);
  });

  test('lessons auto-order within a course and can be published', () => {
    const c = svc.createCenter(t, { name: 'C' });
    const course = svc.createCourse(t, { title: 'C1', centerId: c.id });
    const l1 = svc.createLesson(t, { title: 'L1', courseId: course.id });
    const l2 = svc.createLesson(t, { title: 'L2', courseId: course.id });
    expect(l1.order).toBe(1);
    expect(l2.order).toBe(2);
    svc.updateLesson(t, l2.id, { status: 'published' });
    expect(svc.listLessons(t, course.id).map((l) => l.title)).toEqual(['L1', 'L2']);
    expect(() => svc.createLesson(t, { title: 'L3', courseId: 'missing' })).toThrow(/Course not found/);
  });

  test('enrollment rejects duplicates and archived courses', () => {
    const c = svc.createCenter(t, { name: 'C' });
    const course = svc.createCourse(t, { title: 'C1', centerId: c.id });
    const student = svc.createStudent(t, { displayName: 'S1' });
    const enr = svc.createEnrollment(t, { courseId: course.id, studentId: student.id });
    expect(enr.status).toBe('active');
    expect(() => svc.createEnrollment(t, { courseId: course.id, studentId: student.id })).toThrow(/already enrolled/);
    svc.updateCourse(t, course.id, { status: 'archived' });
    const s2 = svc.createStudent(t, { displayName: 'S2' });
    expect(() => svc.createEnrollment(t, { courseId: course.id, studentId: s2.id })).toThrow(/archived/);
  });

  test('progress computes a real percentage and guards lesson/course mismatch', () => {
    const c = svc.createCenter(t, { name: 'C' });
    const course = svc.createCourse(t, { title: 'C1', centerId: c.id });
    const other = svc.createCourse(t, { title: 'C2', centerId: c.id });
    const l1 = svc.createLesson(t, { title: 'L1', courseId: course.id });
    const l2 = svc.createLesson(t, { title: 'L2', courseId: course.id });
    const foreign = svc.createLesson(t, { title: 'FX', courseId: other.id });
    const student = svc.createStudent(t, { displayName: 'S1' });
    const enr = svc.createEnrollment(t, { courseId: course.id, studentId: student.id });

    expect(svc.getEnrollmentProgress(t, enr.id).percentage).toBe(0);
    svc.markLessonComplete(t, { enrollmentId: enr.id, lessonId: l1.id });
    expect(svc.getEnrollmentProgress(t, enr.id).percentage).toBe(50);
    svc.markLessonComplete(t, { enrollmentId: enr.id, lessonId: l2.id });
    const prog = svc.getEnrollmentProgress(t, enr.id);
    expect(prog.percentage).toBe(100);
    expect(prog.completedLessons).toBe(2);
    expect(svc.getStudentCourseProgress(t, student.id, course.id).percentage).toBe(100);

    expect(() => svc.markLessonComplete(t, { enrollmentId: enr.id, lessonId: foreign.id }))
      .toThrow(/does not belong to the enrolled course/);
  });

  test('referential integrity blocks deleting in-use entities', () => {
    const c = svc.createCenter(t, { name: 'C' });
    const student = svc.createStudent(t, { displayName: 'S1' });
    const teacher = svc.createTeacher(t, { displayName: 'T', centerId: c.id });
    expect(() => svc.deleteCenter(t, c.id)).toThrow(/cannot be deleted/);
    const course = svc.createCourse(t, { title: 'C1', centerId: c.id, teacherId: teacher.id });
    expect(() => svc.deleteTeacher(t, teacher.id)).toThrow(/cannot be deleted/);
    svc.createEnrollment(t, { courseId: course.id, studentId: student.id });
    expect(() => svc.deleteStudent(t, student.id)).toThrow(/cannot be deleted/);
    expect(() => svc.deleteCourse(t, course.id)).toThrow(/cannot be deleted/);
  });

  test('deleting a course cascades only its own lessons', () => {
    const c = svc.createCenter(t, { name: 'C' });
    const a = svc.createCourse(t, { title: 'A', centerId: c.id });
    const b = svc.createCourse(t, { title: 'B', centerId: c.id });
    svc.createLesson(t, { title: 'A1', courseId: a.id });
    svc.createLesson(t, { title: 'B1', courseId: b.id });
    svc.deleteCourse(t, a.id);
    expect(svc.getCourse(t, b.id).title).toBe('B');
    expect(svc.listLessons(t, b.id).map((l) => l.title)).toEqual(['B1']);
  });

  test('client-supplied tenantId in payload is rejected', () => {
    expect(() => svc.createCenter(t, { name: 'X', tenantId: 'other' })).toThrow(/tenantId cannot be supplied in payload/);
  });
});
