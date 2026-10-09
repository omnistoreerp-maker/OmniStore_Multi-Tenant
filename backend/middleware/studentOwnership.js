'use strict';

// studentOwnership — resolves whether a LINKED student owns an Education row.
//
// It is the exact twin of middleware/teacherOwnership for the learner portal:
// same narrow-only contract, same 404-before-403 ordering in controllers, same
// OWNERSHIP_DENIED code.
//
// WHY IT EXISTS. A Student row is linked to a signed-in account by an
// Owner/Admin (POST /students/:id/link-user). attachStudentActor resolves that
// link ONCE per request and parks it on `req.educationStudent`. Controllers use
// the helpers below to narrow a linked student to their OWN rows.
//
// HOW STUDENT SCOPE IS DERIVED. A Student row IS the scope for profile reads
// (identity equality). Everything else resolves through the Enrollment, always
// inside the trusted tenant:
//
//   Enrollment.studentId (direct) -> Enrollment -> Class -> Session (scheduling)
//   Attendance .enrollmentId / Grade .enrollmentId -> Enrollment -> studentId
//
// A student-linked row with a broken chain (an Enrollment whose studentId does
// not resolve) resolves to NO ownership and is therefore invisible to every
// student actor — fail closed.
//
// CONTRACT.
//   - Every helper is TENANT-SCOPED: the caller passes the trusted tenantId
//     and the service layer re-applies it, so a foreign tenant answers empty /
//     false and existence is never leaked.
//   - The student id is NEVER taken from the request. Callers pass
//     `req.educationStudent.id`, which is derived from the server-side link.
//   - These helpers only ever NARROW a result set. They never widen one and
//     never authorise anything on their own: the route's gate still decides
//     access first, and the controller's 404 (cross-tenant / not found) still
//     precedes any 403 so existence is never leaked.

const enrollmentService = require('../services/enrollment.service');
const classService = require('../services/class.service');

function _present(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

// The Enrollment ids belonging to a linked student. Returns an empty Set for
// an unlinked caller so a missing link can never widen anything.
function studentEnrollmentIds(tenantId, studentId) {
  if (!_present(tenantId) || !_present(studentId)) return new Set();
  const rows = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, { studentId: String(studentId) }) || [];
  return new Set(rows.map((e) => String(e.id)).filter((id) => id !== 'undefined' && id !== ''));
}

// The Class ids a linked student is enrolled in (through their Enrollments).
function studentClassIds(tenantId, studentId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(studentId)) return ids;
  const rows = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, { studentId: String(studentId) }) || [];
  for (const e of rows) {
    if (_present(e.classId)) ids.add(String(e.classId));
  }
  return ids;
}

// True when `enrollmentId` resolves, inside this tenant, to an Enrollment of
// the linked student. An unknown id answers false, so this is not an
// existence oracle; the caller still 404s an unresolvable row first.
function studentOwnsEnrollment(tenantId, enrollmentId, studentId) {
  if (!_present(tenantId) || !_present(enrollmentId) || !_present(studentId)) return false;
  const enrollment = enrollmentService.getEnrollment({ tenantId: String(tenantId) }, String(enrollmentId));
  if (!enrollment) return false;
  return String(enrollment.studentId || '') === String(studentId);
}

// True when `classId` is a Class the linked student is enrolled in.
function studentOwnsClass(tenantId, classId, studentId) {
  if (!_present(tenantId) || !_present(classId) || !_present(studentId)) return false;
  const classes = classService.listClasses({ tenantId: String(tenantId) }, {}) || [];
  const found = classes.find((c) => String(c.id) === String(classId));
  if (!found) return false;
  return studentClassIds(tenantId, studentId).has(String(classId));
}

// Row filters — same shape as teacherOwnership's. A row with a missing or
// unresolvable enrollmentId never lands in the allowed set (fail closed).
function filterRowsByEnrollment(rows, allowed) {
  if (!Array.isArray(rows)) return [];
  if (!(allowed instanceof Set)) return [];
  return rows.filter((r) => r && allowed.has(String(r.enrollmentId || '')));
}

function filterStudentsByStudent(rows, studentId) {
  if (!Array.isArray(rows)) return [];
  if (!_present(studentId)) return [];
  return rows.filter((s) => s && String(s.id) === String(studentId));
}

module.exports = {
  studentEnrollmentIds,
  studentClassIds,
  studentOwnsEnrollment,
  studentOwnsClass,
  filterRowsByEnrollment,
  filterStudentsByStudent
};