'use strict';

// teacherOwnership — resolves whether a LINKED teacher owns an Education row.
//
// WHY IT EXISTS. A Teacher record is linked to a signed-in account by an
// Owner/Admin (POST /teachers/:id/link-user). attachTeacherActor resolves that
// link ONCE per request and parks it on `req.teacherActor`. The five teacher-
// owned surfaces (bookings, ratings, classes, scheduling, enrollments) enforce
// row ownership in their controllers. attendance, grading and students carry
// NO `teacherId` of their own — they reach a teacher only through
// Enrollment -> Class -> teacherId — so they need this resolver to answer the
// same question the existing controllers answer inline.
//
// CONTRACT.
//   - Every helper is TENANT-SCOPED: the caller passes the trusted tenantId and
//     the service layer re-applies it, so a foreign tenant answers empty /
//     false and existence is never leaked.
//   - The teacher id is NEVER taken from the request. Callers pass
//     `req.teacherActor.id`, which is derived from the signed token.
//   - These helpers only ever NARROW a result set. They never widen one and
//     never authorise anything on their own: the route's requirePermission and
//     the global scopedWriteRoleGuard still decide access first.

const classService = require('../services/class.service');
const enrollmentService = require('../services/enrollment.service');

function _present(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

// The Class ids a linked teacher teaches. Returns [] for an unlinked caller so
// a missing link can never widen anything.
function teacherClassIds(tenantId, teacherId) {
  if (!_present(tenantId) || !_present(teacherId)) return [];
  const classes = classService.listClasses({ tenantId: String(tenantId) }, { teacherId: String(teacherId) }) || [];
  return classes.map((c) => String(c.id)).filter((id) => id !== 'undefined' && id !== '');
}

// The Enrollment ids belonging to a linked teacher's classes.
function teacherEnrollmentIds(tenantId, teacherId) {
  if (!_present(tenantId) || !_present(teacherId)) return new Set();
  const rows = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, { teacherId: String(teacherId) }) || [];
  return new Set(rows.map((e) => String(e.id)));
}

// The Student ids reachable through a linked teacher's classes. This is the
// only definition of "a student this teacher may read": a Student row has no
// centerId/classId of its own, so it is derived rather than filtered.
function teacherStudentIds(tenantId, teacherId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(teacherId)) return ids;
  const rows = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, { teacherId: String(teacherId) }) || [];
  for (const e of rows) {
    if (_present(e.studentId)) ids.add(String(e.studentId));
  }
  return ids;
}

// True when `enrollmentId` resolves, inside this tenant, to a Class the linked
// teacher teaches. An unknown id answers false, so this is not an existence
// oracle; the caller still 404s an unresolvable row first.
function teacherOwnsEnrollment(tenantId, enrollmentId, teacherId) {
  if (!_present(tenantId) || !_present(enrollmentId) || !_present(teacherId)) return false;
  const enrollment = enrollmentService.getEnrollment({ tenantId: String(tenantId) }, String(enrollmentId));
  if (!enrollment) return false;
  const allowed = new Set(teacherClassIds(tenantId, teacherId));
  return allowed.has(String(enrollment.classId || ''));
}

// True when `studentId` is enrolled in at least one Class the linked teacher
// teaches.
function teacherOwnsStudent(tenantId, studentId, teacherId) {
  if (!_present(studentId)) return false;
  return teacherStudentIds(tenantId, teacherId).has(String(studentId));
}

// Narrows an already tenant-scoped row list to the linked teacher's rows.
// Rows without the reference are dropped rather than exposed.
function filterRowsByEnrollment(rows, allowedEnrollmentIds) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && _present(r.enrollmentId) && allowedEnrollmentIds.has(String(r.enrollmentId)));
}

// Narrows Students to those the linked teacher teaches.
function filterStudentsByTeacher(students, allowedStudentIds) {
  if (!Array.isArray(students)) return [];
  return students.filter((s) => s && _present(s.id) && allowedStudentIds.has(String(s.id)));
}

module.exports = {
  teacherClassIds,
  teacherEnrollmentIds,
  teacherStudentIds,
  teacherOwnsEnrollment,
  teacherOwnsStudent,
  filterRowsByEnrollment,
  filterStudentsByTeacher
};