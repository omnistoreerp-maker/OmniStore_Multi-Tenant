'use strict';

const fs = require('fs');
const { makeTempDataDir } = require('./helpers/testData');

function loadService(dataDir) {
  jest.resetModules();
  process.env.DIGITRONICS_DATA_DIR = dataDir;
  return require('../services/education.service');
}


function makeUser(role, tenantId) {
  return {
    id: 'user-' + Math.random().toString(36).slice(2, 8),
    username: 'testuser',
    role: role,
    tenantRoles: tenantId ? { [tenantId]: role } : {},
    platformAdmin: false
  };
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
      expect(() => service.createCenter(null, makeUser('Admin', 'tenant-a'), { name: 'Center A' })).toThrow(/Tenant context is required/);
      expect(() => service.createTeacher(null, makeUser('Admin', 'tenant-a'), { fullName: 'Teacher A' })).toThrow(/Tenant context is required/);
      expect(() => service.createStudent(null, makeUser('Admin', 'tenant-a'), { fullName: 'Student A' })).toThrow(/Tenant context is required/);
      expect(() => service.createEnrollment(null, makeUser('Admin', 'tenant-a'), { studentId: 's1', teacherId: 't1', centerId: 'c1' })).toThrow(/Tenant context is required/);
    });

    test('centers are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const centerA = service.createCenter(tenantA, makeUser('Admin', 'tenant-a'), { name: 'Center A' });
      const centerB = service.createCenter(tenantB, makeUser('Admin', 'tenant-b'), { name: 'Center B' });

      expect(centerA.tenantId).toBe('tenant-a');
      expect(centerB.tenantId).toBe('tenant-b');

      const listA = service.listCenters(tenantA, makeUser('Admin', 'tenant-a'));
      const listB = service.listCenters(tenantB, makeUser('Admin', 'tenant-b'));
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(centerA.id);
      expect(listB[0].id).toBe(centerB.id);

      expect(service.getCenter(tenantA, centerB.id, makeUser('Admin', 'tenant-a'))).toBeNull();
      expect(service.getCenter(tenantB, centerA.id, makeUser('Admin', 'tenant-b'))).toBeNull();
    });

    test('teachers are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const teacherA = service.createTeacher(tenantA, makeUser('Admin', 'tenant-a'), { fullName: 'Teacher A' });
      const teacherB = service.createTeacher(tenantB, makeUser('Admin', 'tenant-b'), { fullName: 'Teacher B' });

      expect(teacherA.tenantId).toBe('tenant-a');
      expect(teacherB.tenantId).toBe('tenant-b');

      const listA = service.listTeachers(tenantA, makeUser('Admin', 'tenant-a'));
      const listB = service.listTeachers(tenantB, makeUser('Admin', 'tenant-b'));
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(teacherA.id);
      expect(listB[0].id).toBe(teacherB.id);

      expect(service.getTeacher(tenantA, teacherB.id, makeUser('Admin', 'tenant-a'))).toBeNull();
      expect(service.getTeacher(tenantB, teacherA.id, makeUser('Admin', 'tenant-b'))).toBeNull();
    });

    test('students are isolated per tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const studentA = service.createStudent(tenantA, makeUser('Admin', 'tenant-a'), { fullName: 'Student A' });
      const studentB = service.createStudent(tenantB, makeUser('Admin', 'tenant-b'), { fullName: 'Student B' });

      expect(studentA.tenantId).toBe('tenant-a');
      expect(studentB.tenantId).toBe('tenant-b');

      const listA = service.listStudents(tenantA, makeUser('Admin', 'tenant-a'));
      const listB = service.listStudents(tenantB, makeUser('Admin', 'tenant-b'));
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(1);
      expect(listA[0].id).toBe(studentA.id);
      expect(listB[0].id).toBe(studentB.id);

      expect(service.getStudent(tenantA, studentB.id, makeUser('Admin', 'tenant-a'))).toBeNull();
      expect(service.getStudent(tenantB, studentA.id, makeUser('Admin', 'tenant-b'))).toBeNull();
    });

    test('enrollments are isolated per tenant and reject foreign references', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };

      const centerA = service.createCenter(tenantA, makeUser('Admin', 'tenant-a'), { name: 'Center A' });
      const centerB = service.createCenter(tenantB, makeUser('Admin', 'tenant-b'), { name: 'Center B' });
      const teacherA = service.createTeacher(tenantA, makeUser('Admin', 'tenant-a'), { fullName: 'Teacher A' });
      const teacherB = service.createTeacher(tenantB, makeUser('Admin', 'tenant-b'), { fullName: 'Teacher B' });
      const studentA = service.createStudent(tenantA, makeUser('Admin', 'tenant-a'), { fullName: 'Student A' });
      const studentB = service.createStudent(tenantB, makeUser('Admin', 'tenant-b'), { fullName: 'Student B' });

      const enrollmentA = service.createEnrollment(tenantA, makeUser('Admin', 'tenant-a'), { studentId: studentA.id, teacherId: teacherA.id, centerId: centerA.id });
      expect(enrollmentA.tenantId).toBe('tenant-a');

      expect(() => service.createEnrollment(tenantA, makeUser('Admin', 'tenant-a'), { studentId: studentB.id, teacherId: teacherA.id, centerId: centerA.id })).toThrow(/Invalid student/);
      expect(() => service.createEnrollment(tenantA, makeUser('Admin', 'tenant-a'), { studentId: studentA.id, teacherId: teacherB.id, centerId: centerA.id })).toThrow(/Invalid teacher/);
      expect(() => service.createEnrollment(tenantA, makeUser('Admin', 'tenant-a'), { studentId: studentA.id, teacherId: teacherA.id, centerId: centerB.id })).toThrow(/Invalid center/);

      const listA = service.listEnrollments(tenantA, makeUser('Admin', 'tenant-a'));
      const listB = service.listEnrollments(tenantB, makeUser('Admin', 'tenant-b'));
      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(0);
    });

    test('client-supplied tenantId in payload is rejected', () => {
      const tenantA = { tenantId: 'alpha' };
      const admin = makeUser('Admin', 'alpha');
      expect(() => service.createCenter(tenantA, admin, { name: 'Center A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
      expect(() => service.createTeacher(tenantA, admin, { fullName: 'Teacher A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
      expect(() => service.createStudent(tenantA, admin, { fullName: 'Student A', tenantId: 'beta' })).toThrow(/tenantId cannot be supplied in payload/);
    });
  });

  describe('CRUD', () => {
    test('center CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, makeUser('Admin', 'tenant-crud'), { name: 'Center CRUD', address: '123 Main St', phone: '01012345678', email: 'center@example.com' });
      expect(center.name).toBe('Center CRUD');
      expect(center.status).toBe('active');

      const fetched = service.getCenter(tenant, center.id, makeUser('Admin', 'tenant-crud'));
      expect(fetched.id).toBe(center.id);

      const updated = service.updateCenter(tenant, center.id, makeUser('Admin', 'tenant-crud'), { name: 'Center Updated', status: 'inactive' });
      expect(updated.name).toBe('Center Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listCenters(tenant, makeUser('Admin', 'tenant-crud'));
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe('Center Updated');
    });

    test('teacher CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const teacher = service.createTeacher(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Teacher CRUD', username: 'teacher1', phone: '01012345678', specialization: 'Math' });
      expect(teacher.fullName).toBe('Teacher CRUD');
      expect(teacher.username).toBe('teacher1');

      const fetched = service.getTeacher(tenant, teacher.id, makeUser('Admin', 'tenant-crud'));
      expect(fetched.id).toBe(teacher.id);

      const updated = service.updateTeacher(tenant, teacher.id, makeUser('Admin', 'tenant-crud'), { fullName: 'Teacher Updated', status: 'inactive' });
      expect(updated.fullName).toBe('Teacher Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listTeachers(tenant, makeUser('Admin', 'tenant-crud'));
      expect(list).toHaveLength(1);
      expect(list[0].fullName).toBe('Teacher Updated');
    });

    test('student CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const student = service.createStudent(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Student CRUD', phone: '01012345678', guardianName: 'Parent', guardianPhone: '01087654321' });
      expect(student.fullName).toBe('Student CRUD');
      expect(student.status).toBe('active');

      const fetched = service.getStudent(tenant, student.id, makeUser('Admin', 'tenant-crud'));
      expect(fetched.id).toBe(student.id);

      const updated = service.updateStudent(tenant, makeUser('Admin', 'tenant-crud'), student.id, { fullName: 'Student Updated', status: 'inactive' });
      expect(updated.fullName).toBe('Student Updated');
      expect(updated.status).toBe('inactive');

      const list = service.listStudents(tenant, makeUser('Admin', 'tenant-crud'));
      expect(list).toHaveLength(1);
      expect(list[0].fullName).toBe('Student Updated');
    });

    test('enrollment CRUD', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, makeUser('Admin', 'tenant-crud'), { name: 'Center CRUD' });
      const teacher = service.createTeacher(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Teacher CRUD' });
      const student = service.createStudent(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Student CRUD' });

      const enrollment = service.createEnrollment(tenant, makeUser('Admin', 'tenant-crud'), { studentId: student.id, teacherId: teacher.id, centerId: center.id, status: 'active' });
      expect(enrollment.studentId).toBe(student.id);
      expect(enrollment.teacherId).toBe(teacher.id);
      expect(enrollment.centerId).toBe(center.id);

      const fetched = service.getEnrollment(tenant, enrollment.id, makeUser('Admin', 'tenant-crud'));
      expect(fetched.id).toBe(enrollment.id);

      const updated = service.updateEnrollment(tenant, makeUser('Admin', 'tenant-crud'), enrollment.id, { status: 'inactive' });
      expect(updated.status).toBe('inactive');

      const list = service.listEnrollments(tenant, makeUser('Admin', 'tenant-crud'));
      expect(list).toHaveLength(1);
      expect(list[0].status).toBe('inactive');
    });

    test('enrollment requires valid student, teacher, and center', () => {
      const tenant = { tenantId: 'tenant-crud' };
      const center = service.createCenter(tenant, makeUser('Admin', 'tenant-crud'), { name: 'Center CRUD' });
      const teacher = service.createTeacher(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Teacher CRUD' });
      const student = service.createStudent(tenant, makeUser('Admin', 'tenant-crud'), { fullName: 'Student CRUD' });

      expect(() => service.createEnrollment(tenant, makeUser('Admin', 'tenant-crud'), { studentId: 'invalid', teacherId: teacher.id, centerId: center.id })).toThrow(/Invalid student/);
      expect(() => service.createEnrollment(tenant, makeUser('Admin', 'tenant-crud'), { studentId: student.id, teacherId: 'invalid', centerId: center.id })).toThrow(/Invalid teacher/);
      expect(() => service.createEnrollment(tenant, makeUser('Admin', 'tenant-crud'), { studentId: student.id, teacherId: teacher.id, centerId: 'invalid' })).toThrow(/Invalid center/);
    });
  });

  describe('persistence', () => {
    test('data survives service reload', () => {
      const tenant = { tenantId: 'tenant-persist' };
      const persistUser = makeUser('Admin', 'tenant-persist');
      service.createCenter(tenant, persistUser, { name: 'Persist Center' });
      service.createTeacher(tenant, persistUser, { fullName: 'Persist Teacher' });
      service.createStudent(tenant, persistUser, { fullName: 'Persist Student' });

      const center = service.listCenters(tenant, persistUser)[0];
      const teacher = service.listTeachers(tenant, persistUser)[0];
      const student = service.listStudents(tenant, persistUser)[0];
      service.createEnrollment(tenant, persistUser, { studentId: student.id, teacherId: teacher.id, centerId: center.id });

      const reloaded = loadService(dataDir);
      expect(reloaded.listCenters(tenant, persistUser)).toHaveLength(1);
      expect(reloaded.listTeachers(tenant, persistUser)).toHaveLength(1);
      expect(reloaded.listStudents(tenant, persistUser)).toHaveLength(1);
      expect(reloaded.listEnrollments(tenant, persistUser)).toHaveLength(1);
    });
  });

  describe('authorization', () => {
    test('tenant admin can access own tenant but not foreign tenant', () => {
      const tenantA = { tenantId: 'tenant-a' };
      const tenantB = { tenantId: 'tenant-b' };
      const adminA = makeUser('Admin', 'tenant-a');
      const adminB = makeUser('Admin', 'tenant-b');

      service.createCenter(tenantA, adminA, { name: 'Center A' });
      service.createCenter(tenantB, adminB, { name: 'Center B' });

      expect(() => service.listCenters(tenantA, adminA)).not.toThrow();
      expect(() => service.listCenters(tenantB, adminA)).toThrow(/Access denied/);
      const centersInA = service.listCenters(tenantA, adminA);
      const centersInB = service.listCenters(tenantB, adminB);
      expect(centersInA).toHaveLength(1);
      expect(centersInB).toHaveLength(1);
      expect(centersInA[0].id).not.toBe(centersInB[0].id);
    });

    test('center admin can access assigned center but not others', () => {
      const tenant = { tenantId: 'tenant-center' };
      const admin = makeUser('Admin', 'tenant-center');
      const center1 = service.createCenter(tenant, admin, { name: 'Center 1' });
      const center2 = service.createCenter(tenant, admin, { name: 'Center 2' });

      const caId = 'center-admin-' + Math.random().toString(36).slice(2, 8);
      service.createCenterAdmin(tenant, { id: caId, centerId: center1.id, userId: admin.id, fullName: 'CA1' });
      const centerAdminUser = { id: admin.id, username: 'causer', role: 'User', tenantRoles: { 'tenant-center': 'User' }, centerAdminMappings: { 'tenant-center': center1.id } };

      expect(() => service.listCenters(tenant, centerAdminUser)).toThrow(/Access denied/);
      expect(service.getCenter(tenant, center1.id, centerAdminUser)).not.toBeNull();
      expect(service.getCenter(tenant, center2.id, centerAdminUser)).toBeNull();
    });

    test('center admin cannot access foreign tenant', () => {
      const tenantA = { tenantId: 'tenant-ca-a' };
      const tenantB = { tenantId: 'tenant-ca-b' };
      const adminA = makeUser('Admin', 'tenant-ca-a');
      const centerA = service.createCenter(tenantA, adminA, { name: 'Center A' });
      service.createCenterAdmin(tenantA, { centerId: centerA.id, userId: adminA.id, fullName: 'CA A' });
      const caUser = { id: adminA.id, username: 'causer', role: 'User', tenantRoles: { 'tenant-ca-a': 'User' }, centerAdminMappings: { 'tenant-ca-a': centerA.id } };

      expect(() => service.listCenters(tenantB, caUser)).toThrow(/Access denied/);
    });

    test('teacher scope allows own enrollments but denies others', () => {
      const tenant = { tenantId: 'tenant-teacher' };
      const admin = makeUser('Admin', 'tenant-teacher');
      const center = service.createCenter(tenant, admin, { name: 'Center' });
      const teacherA = service.createTeacher(tenant, admin, { fullName: 'Teacher A', username: 'teacherA' });
      const teacherB = service.createTeacher(tenant, admin, { fullName: 'Teacher B', username: 'teacherB' });
      const student = service.createStudent(tenant, admin, { fullName: 'Student' });

      service.createEnrollment(tenant, admin, { studentId: student.id, teacherId: teacherA.id, centerId: center.id });

      const teacherAUser = makeUser('Teacher', 'tenant-teacher');
      teacherAUser.username = 'teacherA';
      const teacherBUser = makeUser('Teacher', 'tenant-teacher');
      teacherBUser.username = 'teacherB';

      const listA = service.listEnrollments(tenant, teacherAUser);
      const listB = service.listEnrollments(tenant, teacherBUser);

      expect(listA).toHaveLength(1);
      expect(listB).toHaveLength(0);
    });

    test('student scope allows own profile and enrollments', () => {
      const tenant = { tenantId: 'tenant-student' };
      const admin = makeUser('Admin', 'tenant-student');
      const center = service.createCenter(tenant, admin, { name: 'Center' });
      const teacher = service.createTeacher(tenant, admin, { fullName: 'Teacher' });
      const studentA = service.createStudent(tenant, admin, { fullName: 'Student A', userId: 'student-a-id' });
      const studentB = service.createStudent(tenant, admin, { fullName: 'Student B', userId: 'student-b-id' });

      service.createEnrollment(tenant, admin, { studentId: studentA.id, teacherId: teacher.id, centerId: center.id });
      service.createEnrollment(tenant, admin, { studentId: studentB.id, teacherId: teacher.id, centerId: center.id });

      const studentAUser = makeUser('Student', 'tenant-student');
      studentAUser.id = 'student-a-id';
      const studentBUser = makeUser('Student', 'tenant-student');
      studentBUser.id = 'student-b-id';

      expect(service.listStudents(tenant, studentAUser)).toHaveLength(1);
      expect(service.getStudent(tenant, studentA.id, studentAUser)).not.toBeNull();
      expect(service.getStudent(tenant, studentB.id, studentAUser)).toBeNull();
    });

    test('privilege escalation: forged tenantId is rejected', () => {
      const tenantA = { tenantId: 'tenant-pe' };
      const admin = makeUser('Admin', 'tenant-pe');
      service.createCenter(tenantA, admin, { name: 'Center' });

      expect(() => service.createCenter(tenantA, admin, { name: 'Hacked', tenantId: 'other-tenant' })).toThrow(/tenantId cannot be supplied in payload/);
    });

    test('privilege escalation: student cannot access others via forged id', () => {
      const tenant = { tenantId: 'tenant-pe2' };
      const admin = makeUser('Admin', 'tenant-pe2');
      const studentA = service.createStudent(tenant, admin, { fullName: 'Student A', userId: 'sa-id' });
      const studentB = service.createStudent(tenant, admin, { fullName: 'Student B', userId: 'sb-id' });

      const studentAUser = { id: 'sa-id', username: 'studentA', role: 'Student', studentMappings: { 'tenant-pe2': studentA.id } };
      expect(service.getStudent(tenant, studentB.id, studentAUser)).toBeNull();
    });
  });
});
