'use strict';

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/education.service');
}

describe('education module', () => {
  let dataDir;
  let service;

  beforeEach(() => {
    dataDir = makeTempDataDir('education');
    service = loadService(dataDir);
  });

  afterEach(() => {
    try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch (_) {}
  });

  describe('tenant isolation', () => {
    test('missing tenant context is rejected on writes', () => {
      expect(() => service.createCenter(null, { name: 'Center A' })).toThrow(/Tenant context is required/);
      expect(() => service.createTeacher(null, { fullName: 'Teacher A' })).toThrow(/Tenant context is required/);
      expect(() => service.createStudent(null, { fullName: 'Student A' })).toThrow(/Tenant context is required/);
      expect(() => service.createEnrollment(null, { studentId: 's1', teacherId: 't1', centerId: 'c1' })).toThrow(/Tenant context is required/);
    });

    test('centers are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const centerA = service.createCenter(tenantA, { name: 'Center A' });
      const centerB = service.createCenter(tenantB, { name: 'Center B' });

      expect(centerA.tenantId).toBe('tenant-a');
      expect(centerB.tenantId).toBe('tenant-b');

      const listA = service.listCenters(tenantA);
      const listB = service.listCenters(tenantB);
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(centerA.id);
      expect(listB[0].id).toBe(centerB.id);

      expect(service.getCenter(tenantA, centerB.id)).toBeNull();
      expect(service.getCenter(tenantB, centerA.id)).toBeNull();
    });

    test('teachers are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const teacherA = service.createTeacher(tenantA, { fullName: 'Teacher A' });
      const teacherB = service.createTeacher(tenantB, { fullName: 'Teacher B' });

      expect(teacherA.tenantId).toBe('tenant-a');
      expect(teacherB.tenantId).toBe('tenant-b');

      const listA = service.listTeachers(tenantA);
      const listB = service.listTeachers(tenantB);
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(teacherA.id);
      expect(listB[0].id).toBe(teacherB.id);

      expect(service.getTeacher(tenantA, teacherB.id)).toBeNull();
      expect(service.getTeacher(tenantB, teacherA.id)).toBeNull();
    });

    test('students are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const studentA = service.createStudent(tenantA, { fullName: 'Student A' });
      const studentB = service.createStudent(tenantB, { fullName: 'Student B' });

      expect(studentA.tenantId).toBe('tenant-a');
      expect(studentB.tenantId).toBe('tenant-b');

      const listA = service.listStudents(tenantA);
      const listB = service.listStudents(tenantB);
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(studentA.id);
      expect(listB[0].id).toBe(studentB.id);

      expect(service.getStudent(tenantA, studentB.id)).toBeNull();
      expect(service.getStudent(tenantB, studentA.id)).toBeNull();
    });

    test('enrollments are isolated per tenant and reject foreign references', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const centerA = service.createCenter(tenantA, { name: 'Center A' });
      const centerB = service.createCenter(tenantB, { name: 'Center B' });
      const teacherA = service.createTeacher(tenantA, { fullName: 'Teacher A' });
      const teacherB = service.createTeacher(tenantB, { fullName: 'Teacher B' });
      const studentA = service.createStudent(tenantA, { fullName: 'Student A' });
      const studentB = service.createStudent(tenantB, { fullName: 'Student B' });

      const enrollmentA = service.createEnrollment(tenantA, { studentId: studentA.id, teacherId: teacherA.id, centerId: centerA.id });
      expect(enrollmentA.tenantId).toBe('tenant-a');

      expect(() => service.createEnrollment(tenantA, { studentId: studentB.id, teacherId: teacherA.id, centerId: centerA.id })).toThrow(/Invalid student/);
      expect(() => service.createEnrollment(tenantA, { studentId: studentA.id, teacherId: teacherB.id, centerId: centerA.id })).toThrow(/Invalid teacher/);
      expect(() => service.createEnrollment(tenantA, { studentId: studentA.id, teacherId: teacherA.id, centerId: centerB.id })).toThrow(/Invalid center/);

      const listA = service.listEnrollments(tenantA);
      const listB = service.listEnrollments(tenantB);
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(0);
    });

    test('client-supplied tenantId in payload is rejected', () => {
      const tenantA = { tenantId: 'alpha' };
      expect(() => service.createCenter(tenantA, { name: 'Center A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
      expect(() => service.createTeacher(tenantA, { fullName: 'Teacher A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
      expect(() => service.createStudent(tenantA, { fullName: 'Student A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
    });
  });

  describe('CRUD', () => {
    test('center CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, { name: 'Center CRUD', address: '123 Main St', phone: '01012345678', email: 'center@example.com' });
      expect(center.name).toBe('Center CRUD');
      expect(center.status).toBe('active');

      const fetched = service.getCenter(tenant, center.id);
      expect(fetched.id).toBe(center.id);

      const updated = service.updateCenter(tenant, center.id, { name: 'Center Updated', status: 'inactive' });
      expect(updated.name).toBe('Center Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listCenters(tenant);
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Center Updated');
    });

    test('teacher CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const teacher = service.createTeacher(tenant, { fullName: 'Teacher CRUD', username: 'teacher1', phone: '01012345678', specialization: 'Math' });
      expect(teacher.fullName).toBe('Teacher CRUD');
      expect(teacher.username).toBe('teacher1');

      const fetched = service.getTeacher(tenant, teacher.id);
      expect(fetched.id).toBe(teacher.id);

      const updated = service.updateTeacher(tenant, teacher.id, { fullName: 'Teacher Updated', status: 'inactive' });
      expect(updated.fullName).toBe('Teacher Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listTeachers(tenant);
      expect(list).toHaveLength(1);
      expect(list[0].fullName).toBe('Teacher Updated');
    });

    test('student CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const student = service.createStudent(tenant, { fullName: 'Student CRUD', phone: '01012345678', guardianName: 'Parent', guardianPhone: '01087654321' });
      expect(student.fullName).toBe('Student CRUD');
      expect(student.status).toBe('active');

      const fetched = service.getStudent(tenant, student.id);
      expect(fetched.id).toBe(student.id);

      const updated = service.updateStudent(tenant, student.id, { fullName: 'Student Updated', status: 'inactive' });
      expect(updated.fullName).toBe('Student Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listStudents(tenant);
      expect(list).toHaveLength(1);
      expect(list[0].fullName).toBe('Student Updated');
    });

    test('enrollment CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, { name: 'Center CRUD' });
      const teacher = service.createTeacher(tenant, { fullName: 'Teacher CRUD' });
      const student = service.createStudent(tenant, { fullName: 'Student CRUD' });

      const enrollment = service.createEnrollment(tenant, { studentId: student.id, teacherId: teacher.id, centerId: center.id, status: 'active' });
      expect(enrollment.studentId).toBe(student.id);
      expect(enrollment.teacherId).toBe(teacher.id);
      expect(enrollment.centerId).toBe(center.id);

      const fetched = service.getEnrollment(tenant, enrollment.id);
      expect(fetched.id).toBe(enrollment.id);

      const updated = service.updateEnrollment(tenant, enrollment.id, { status: 'inactive' });
      expect(updated.status).toBe('inactive');

      const list = service.listEnrollments(tenant);
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe('inactive');
    });

    test('enrollment requires valid student, teacher, and center', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, { name: 'Center CRUD' });
      const teacher = service.createTeacher(tenant, { fullName: 'Teacher CRUD' });
      const student = service.createStudent(tenant, { fullName: 'Student CRUD' });

      expect(() => service.createEnrollment(tenant, { studentId: 'invalid', teacherId: teacher.id, centerId: center.id })).toThrow(/Invalid student/);
      expect(() => service.createEnrollment(tenant, { studentId: student.id, teacherId: 'invalid', centerId: center.id })).toThrow(/Invalid teacher/);
      expect(() => service.createEnrollment(tenant, { studentId: student.id, teacherId: teacher.id, centerId: 'invalid' })).toThrow(/Invalid center/);
    });
  });

  describe('persistence', () => {
    test('data survives service reload', () => {
      const tenant = { tenantId: 'tenant-persist' };
      service.createCenter(tenant, { name: 'Persist Center' });
      service.createTeacher(tenant, { fullName: 'Persist Teacher' });
      service.createStudent(tenant, { fullName: 'Persist Student' });

      const center = service.listCenters(tenant)[0];
      const teacher = service.listTeachers(tenant)[0];
      const student = service.listStudents(tenant)[0];
      service.createEnrollment(tenant, { studentId: student.id, teacherId: teacher.id, centerId: center.id });

      const reloaded = loadService(dataDir);
      expect(reloaded.listCenters(tenant)).toHaveLength(1);
      expect(reloaded.listTeachers(tenant)).toHaveLength(1);
      expect(reloaded.listStudents(tenant)).toHaveLength(1);
      expect(reloaded.listEnrollments(tenant)).toHaveLength(1);
    });
  });
});
