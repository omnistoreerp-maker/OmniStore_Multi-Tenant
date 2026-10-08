'use strict';

const storageAdapter = require('../repositories/storageAdapter');
const logger = require('../utils/logger');

const STORE_KEY = 'education';

function _readStore() {
  try {
    const raw = storageAdapter.read(STORE_KEY);
    if (raw && typeof raw === 'object') return raw;
  } catch (err) {
    logger.warn('education.service: failed to read store, using default', err.message);
  }
  return _defaultDoc();
}

function _writeStore(data) {
  try {
    storageAdapter.write(STORE_KEY, data);
  } catch (err) {
    logger.warn('education.service: failed to write store', err.message);
  }
}

function _defaultDoc() {
  return {
    centers: [],
    teachers: [],
    students: [],
    enrollments: []
  };
}

function _tenantId(tenantContext) {
  if (!tenantContext) return null;
  const t = tenantContext.tenantId || tenantContext.id;
  return t != null ? String(t) : null;
}

function _now() {
  return new Date().toISOString();
}

function _generateId(prefix) {
  return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _rejectTenantIdInPayload(data) {
  if (data && typeof data === 'object' && Object.prototype.hasOwnProperty.call(data, 'tenantId')) {
    throw new Error('tenantId cannot be supplied in payload');
  }
}

function _ensureTenant(tenantContext) {
  const tid = _tenantId(tenantContext);
  if (!tid) throw new Error('Tenant context is required');
  return tid;
}

function _filterByTenant(arr, tenantId) {
  if (!Array.isArray(arr)) return [];
  if (!tenantId) return arr.slice();
  return arr.filter(item => String(item.tenantId || '') === String(tenantId));
}



function _enforceScope(user, tenantId, requiredScope) {
  if (!user) return { allowed: false, reason: 'unauthenticated' };
  
  const tid = String(tenantId || '');
  if (!tid) return { allowed: false, reason: 'no_tenant' };
  
  // Platform admin can access everything
  if (user.platformAdmin || user.isPlatformAdmin) {
    return { allowed: true, scope: 'platform', reason: 'platform_admin' };
  }
  
  // Check if user is tenant admin for THIS tenant only
  const effectiveRole = user.tenantRoles && user.tenantRoles[tid] ? user.tenantRoles[tid] : null;
  if (effectiveRole === 'Owner' || effectiveRole === 'Admin') {
    return { allowed: true, scope: 'tenant', reason: 'tenant_admin' };
  }
  
  // Check if user is center admin
  const centerId = getCenterAdminCenterId(user, tid);
  if (centerId) {
    if (requiredScope === 'center' || requiredScope === 'teacher' || requiredScope === 'student') {
      return { allowed: true, scope: 'center', centerId, reason: 'center_admin' };
    }
  }
  
  // Check if user is teacher
  const teacherId = getTeacherIdForUser(user, tid);
  if (teacherId && (requiredScope === 'teacher' || requiredScope === 'student')) {
    return { allowed: true, scope: 'teacher', teacherId, reason: 'teacher' };
  }
  
  // Check if user is student
  const studentId = getStudentIdForUser(user, tid);
  if (studentId && requiredScope === 'student') {
    return { allowed: true, scope: 'student', studentId, reason: 'student' };
  }
  
  return { allowed: false, reason: 'insufficient_permissions' };
}

function _findById(arr, id) {
  if (!Array.isArray(arr)) return null;
  const target = String(id);
  return arr.find(item => String(item.id) === target) || null;
}

// Centers

function listCenters(tenantContext, user) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  return _filterByTenant(doc.centers, tid);
}

function getCenter(tenantContext, centerId, user) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'center');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const center = _findById(doc.centers, centerId);
  if (!center) return null;
  if (scope.scope === 'center' && String(center.id || '') !== String(scope.centerId)) return null;
  if (tid && String(center.tenantId || '') !== String(tid)) return null;
  return center;
}
function createCenter(tenantContext, user, data) {
  if (!tenantContext || !_tenantId(tenantContext)) throw new Error('Tenant context is required');
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const centers = Array.isArray(doc.centers) ? doc.centers : [];

  const center = {
    id: data.id || _generateId('center'),
    tenantId: tid,
    name: String(data.name || '').trim(),
    address: data.address ? String(data.address).trim() : null,
    phone: data.phone ? String(data.phone).trim() : null,
    email: data.email ? String(data.email).trim() : null,
    status: String(data.status || 'active').toLowerCase(),
    createdAt: _now(),
    updatedAt: _now()
  };

  if (!center.name) throw new Error('Center name is required');

  centers.push(center);
  doc.centers = centers;
  _writeStore(doc);
  return center;
};

function updateCenter(tenantContext, centerId, user, data) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const centers = Array.isArray(doc.centers) ? doc.centers : [];
  const idx = centers.findIndex(c => String(c.id) === String(centerId) && String(c.tenantId || '') === String(tid));
  if (idx === -1) return null;

  const updated = { ...centers[idx], ...data, id: centers[idx].id, tenantId: tid, updatedAt: _now() };
  if (updated.name !== undefined) updated.name = String(updated.name).trim();
  if (!updated.name) throw new Error('Center name is required');

  centers[idx] = updated;
  doc.centers = centers;
  _writeStore(doc);
  return updated;
}

// Teachers

function listTeachers(tenantContext, user, query = {}) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'teacher');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let teachers = _filterByTenant(doc.teachers, tid);

  if (scope.scope === 'center') {
    teachers = teachers.filter(t => String(t.centerId || '') === String(scope.centerId));
  }

  if (query.centerId) {
    teachers = teachers.filter(t => String(t.centerId || '') === String(query.centerId));
  }
  if (query.search) {
    const q = String(query.search).toLowerCase();
    teachers = teachers.filter(t =>
      String(t.fullName || '').toLowerCase().includes(q) ||
      String(t.username || '').toLowerCase().includes(q) ||
      String(t.specialization || '').toLowerCase().includes(q)
    );
  }

  return teachers;
}

function getTeacher(tenantContext, teacherId, user) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const teacher = _findById(doc.teachers, teacherId);
  if (!teacher) return null;
  if (tid && String(teacher.tenantId || '') !== String(tid)) return null;
  if (scope.scope === 'center' && String(teacher.centerId || '') !== String(scope.centerId)) return null;
  return teacher;
}

function createTeacher(tenantContext, user, data) {
  if (!tenantContext || !_tenantId(tenantContext)) throw new Error('Tenant context is required');
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const teachers = Array.isArray(doc.teachers) ? doc.teachers : [];

  const teacher = {
    id: data.id || _generateId('teacher'),
    tenantId: tid,
    centerId: data.centerId || null,
    username: data.username ? String(data.username).trim() : null,
    fullName: String(data.fullName || '').trim(),
    phone: data.phone ? String(data.phone).trim() : null,
    email: data.email ? String(data.email).trim() : null,
    specialization: data.specialization ? String(data.specialization).trim() : null,
    status: String(data.status || 'active').toLowerCase(),
    createdAt: _now(),
    updatedAt: _now()
  };

  if (!teacher.fullName) throw new Error('Teacher full name is required');

  teachers.push(teacher);
  doc.teachers = teachers;
  _writeStore(doc);
  return teacher;
}

function updateTeacher(tenantContext, teacherId, user, data) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const teachers = Array.isArray(doc.teachers) ? doc.teachers : [];
  const idx = teachers.findIndex(t => String(t.id) === String(teacherId) && String(t.tenantId || '') === String(tid));
  if (idx === -1) return null;

  const updated = { ...teachers[idx], ...data, id: teachers[idx].id, tenantId: tid, updatedAt: _now() };
  if (updated.fullName !== undefined) updated.fullName = String(updated.fullName).trim();
  if (!updated.fullName) throw new Error('Teacher full name is required');

  teachers[idx] = updated;
  doc.teachers = teachers;
  _writeStore(doc);
  return updated;
}

// Students

function listStudents(tenantContext, user, query = {}) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const scope = _enforceScope(user, tid, 'student');
  if (!scope.allowed) throw new Error('Access denied');
  let students = _filterByTenant(doc.students, tid);
  if (scope.scope === 'center') {
    students = students.filter(s => String(s.centerId || '') === String(scope.centerId));
  }
  if (scope.scope === 'student') {
    students = students.filter(s => s.id === scope.studentId);
  }
  if (query.centerId) {
    students = students.filter(s => String(s.centerId || '') === String(query.centerId));
  }
  if (query.search) {
    const q = String(query.search).toLowerCase();
    students = students.filter(s =>
      String(s.fullName || '').toLowerCase().includes(q) ||
      String(s.phone || '').toLowerCase().includes(q) ||
      String(s.guardianName || '').toLowerCase().includes(q)
    );
  }
  return students;
}

function getStudent(tenantContext, studentId, user) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'student');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let student = _findById(doc.students, studentId);
  if (!student) return null;
  if (tid && String(student.tenantId || '') !== String(tid)) return null;
  if (scope.scope === 'student' && student.id !== scope.studentId) return null;
  if (scope.scope === 'center' && String(student.centerId || '') !== String(scope.centerId)) return null;
  return student;
}
function createStudent(tenantContext, user, data) {
  if (!tenantContext || !_tenantId(tenantContext)) throw new Error('Tenant context is required');
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const students = Array.isArray(doc.students) ? doc.students : [];

  const student = {
    id: data.id || _generateId('student'),
    tenantId: tid,
    centerId: data.centerId || null,
    userId: data.userId || null,
    fullName: String(data.fullName || '').trim(),
    phone: data.phone ? String(data.phone).trim() : null,
    email: data.email ? String(data.email).trim() : null,
    guardianName: data.guardianName ? String(data.guardianName).trim() : null,
    guardianPhone: data.guardianPhone ? String(data.guardianPhone).trim() : null,
    status: String(data.status || 'active').toLowerCase(),
    createdAt: _now(),
    updatedAt: _now()
  };

  if (!student.fullName) throw new Error('Student full name is required');

  students.push(student);
  doc.students = students;
  _writeStore(doc);
  return student;
}

function updateStudent(tenantContext, user, studentId, data) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const students = Array.isArray(doc.students) ? doc.students : [];
  const idx = students.findIndex(s => String(s.id) === String(studentId) && String(s.tenantId || '') === String(tid));
  if (idx === -1) return null;

  const updated = { ...students[idx], ...data, id: students[idx].id, tenantId: tid, updatedAt: _now() };
  if (updated.fullName !== undefined) updated.fullName = String(updated.fullName).trim();
  if (!updated.fullName) throw new Error('Student full name is required');

  students[idx] = updated;
  doc.students = students;
  _writeStore(doc);
  return updated;
}

// Enrollments

function listEnrollments(tenantContext, user, query = {}) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'teacher');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  let enrollments = _filterByTenant(doc.enrollments, tid);

  if (scope.scope === 'center') {
    enrollments = enrollments.filter(e => String(e.centerId || '') === String(scope.centerId));
  }

  if (scope.scope === 'teacher') {
    enrollments = enrollments.filter(e => String(e.teacherId || '') === String(scope.teacherId));
  }

  if (query.studentId) {
    enrollments = enrollments.filter(e => String(e.studentId || '') === String(query.studentId));
  }
  if (query.teacherId) {
    enrollments = enrollments.filter(e => String(e.teacherId || '') === String(query.teacherId));
  }
  if (query.centerId) {
    enrollments = enrollments.filter(e => String(e.centerId || '') === String(query.centerId));
  }

  return enrollments;
}

function getEnrollment(tenantContext, enrollmentId, user) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const enrollment = _findById(doc.enrollments, enrollmentId);
  if (!enrollment) return null;
  if (tid && String(enrollment.tenantId || '') !== String(tid)) return null;
  return enrollment;
}
function createEnrollment(tenantContext, user, data) {
  if (!tenantContext || !_tenantId(tenantContext)) throw new Error('Tenant context is required');
  const scope = _enforceScope(user, _tenantId(tenantContext), 'tenant');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const enrollments = Array.isArray(doc.enrollments) ? doc.enrollments : [];

  const studentId = String(data.studentId || '').trim();
  const teacherId = String(data.teacherId || '').trim();
  const centerId = String(data.centerId || '').trim();

  if (!studentId) throw new Error('studentId is required');
  if (!teacherId) throw new Error('teacherId is required');
  if (!centerId) throw new Error('centerId is required');

  const student = _findById(doc.students, studentId);
  const teacher = _findById(doc.teachers, teacherId);
  const center = _findById(doc.centers, centerId);

  if (!student || String(student.tenantId || '') !== String(tid)) throw new Error('Invalid student');
  if (!teacher || String(teacher.tenantId || '') !== String(tid)) throw new Error('Invalid teacher');
  if (!center || String(center.tenantId || '') !== String(tid)) throw new Error('Invalid center');

  const enrollment = {
    id: data.id || _generateId('enrollment'),
    tenantId: tid,
    studentId,
    teacherId,
    centerId,
    status: String(data.status || 'active').toLowerCase(),
    enrolledAt: data.enrolledAt || _now(),
    createdAt: _now(),
    updatedAt: _now()
  };

  enrollments.push(enrollment);
  doc.enrollments = enrollments;
  _writeStore(doc);
  return enrollment;
}

function updateEnrollment(tenantContext, user, enrollmentId, data) {
  const scope = _enforceScope(user, _tenantId(tenantContext), 'teacher');
  if (!scope.allowed) throw new Error('Access denied');
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const enrollments = Array.isArray(doc.enrollments) ? doc.enrollments : [];
  const idx = enrollments.findIndex(e => String(e.id) === String(enrollmentId) && String(e.tenantId || '') === String(tid));
  if (idx === -1) return null;
  if (scope.scope === 'teacher' && String(enrollment.teacherId || '') !== String(scope.teacherId)) {
    throw new Error('Access denied');
  }
  if (scope.scope === 'center' && String(enrollment.centerId || '') !== String(scope.centerId)) {
    throw new Error('Access denied');
  }
  if (scope.scope === 'student') {
    throw new Error('Access denied');
  }

  const updated = { ...enrollments[idx], ...data, id: enrollments[idx].id, tenantId: tid, updatedAt: _now() };
  if (updated.status !== undefined) updated.status = String(updated.status).toLowerCase();

  enrollments[idx] = updated;
  doc.enrollments = enrollments;
  _writeStore(doc);
  return updated;
}



// Center Admins

function listCenterAdmins(tenantContext) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  return _filterByTenant(doc.centerAdmins || [], tid);
}

function getCenterAdmin(tenantContext, centerAdminId) {
  const tid = _tenantId(tenantContext);
  const doc = _readStore();
  const admin = _findById(doc.centerAdmins || [], centerAdminId);
  if (!admin) return null;
  if (tid && String(admin.tenantId || '') !== String(tid)) return null;
  return admin;
}

function createCenterAdmin(tenantContext, data) {
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const centerAdmins = Array.isArray(doc.centerAdmins) ? doc.centerAdmins : [];

  const admin = {
    id: data.id || _generateId('center-admin'),
    tenantId: tid,
    centerId: String(data.centerId || '').trim(),
    userId: data.userId || null,
    fullName: String(data.fullName || '').trim(),
    email: data.email ? String(data.email).trim() : null,
    status: String(data.status || 'active').toLowerCase(),
    createdAt: _now(),
    updatedAt: _now()
  };

  if (!admin.centerId) throw new Error('centerId is required');
  if (!admin.fullName) throw new Error('fullName is required');

  centerAdmins.push(admin);
  doc.centerAdmins = centerAdmins;
  _writeStore(doc);
  return admin;
}

function updateCenterAdmin(tenantContext, centerAdminId, data) {
  const tid = _ensureTenant(tenantContext);
  _rejectTenantIdInPayload(data);

  const doc = _readStore();
  const centerAdmins = Array.isArray(doc.centerAdmins) ? doc.centerAdmins : [];
  const idx = centerAdmins.findIndex(a => String(a.id) === String(centerAdminId) && String(a.tenantId || '') === String(tid));
  if (idx === -1) return null;

  const updated = { ...centerAdmins[idx], ...data, id: centerAdmins[idx].id, tenantId: tid, updatedAt: _now() };
  if (updated.centerId !== undefined) updated.centerId = String(updated.centerId).trim();
  if (updated.fullName !== undefined) updated.fullName = String(updated.fullName).trim();
  if (!updated.centerId) throw new Error('centerId is required');
  if (!updated.fullName) throw new Error('fullName is required');

  centerAdmins[idx] = updated;
  doc.centerAdmins = centerAdmins;
  _writeStore(doc);
  return updated;
}

function deleteCenterAdmin(tenantContext, centerAdminId) {
  const tid = _ensureTenant(tenantContext);
  const doc = _readStore();
  const centerAdmins = Array.isArray(doc.centerAdmins) ? doc.centerAdmins : [];
  const idx = centerAdmins.findIndex(a => String(a.id) === String(centerAdminId) && String(a.tenantId || '') === String(tid));
  if (idx === -1) return false;
  centerAdmins.splice(idx, 1);
  doc.centerAdmins = centerAdmins;
  _writeStore(doc);
  return true;
}

// Scope helpers

function getCenterAdminCenterId(user, tenantId) {
  if (!user || !tenantId) return null;
  const tid = String(tenantId);
  const doc = _readStore();
  const admins = (doc.centerAdmins || []).filter(a => String(a.tenantId || '') === tid && String(a.userId || '') === String(user.id || user.userId || '') && String(a.status || '') === 'active');
  if (admins.length > 0) return admins[0].centerId;
  return null;
}

function getTeacherIdForUser(user, tenantId) {
  if (!user || !tenantId) return null;
  const tid = String(tenantId);
  const doc = _readStore();
  const teachers = (doc.teachers || []).filter(t => String(t.tenantId || '') === tid && String(t.username || '') === String(user.username || '') && String(t.status || '') === 'active');
  if (teachers.length > 0) return teachers[0].id;
  return null;
}

function getStudentIdForUser(user, tenantId) {
  if (!user || !tenantId) return null;
  const tid = String(tenantId);
  const doc = _readStore();
  const students = (doc.students || []).filter(s => String(s.tenantId || '') === tid && String(s.userId || '') === String(user.id || user.userId || '') && String(s.status || '') === 'active');
  if (students.length > 0) return students[0].id;
  return null;
}

module.exports = {
  listCenters,
  getCenter,
  createCenter,
  updateCenter,
  listTeachers,
  getTeacher,
  createTeacher,
  updateTeacher,
  listStudents,
  getStudent,
  createStudent,
  updateStudent,
  listEnrollments,
  getEnrollment,
  createEnrollment,
  updateEnrollment,
  listCenterAdmins,
  getCenterAdmin,
  createCenterAdmin,
  updateCenterAdmin,
  deleteCenterAdmin,
  getCenterAdminCenterId,
  getTeacherIdForUser,
  getStudentIdForUser
};







