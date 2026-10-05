'use strict';

// centerOwnership — resolves whether a LINKED center owns an Education row.
//
// WHY IT EXISTS. A Center record is linked to a signed-in account by an
// Owner/Admin (POST /centers/:id/link-user). attachCenterActor resolves that
// link ONCE per request and parks it on `req.centerActor`. Controllers use the
// helpers below to narrow a linked center to its own rows, mirroring exactly
// what middleware/teacherOwnership does for linked teachers. No new
// abstraction was invented: same narrow-only contract, same 404-before-403
// ordering in controllers, same OWNERSHIP_DENIED code.
//
// HOW CENTER IS DERIVED. Only Program stores a `centerId` of its own
// (optional, same-tenant). Everything else resolves through the canonical
// chain, always inside the trusted tenant:
//
//   Program.centerId (direct) -> Course.programId -> Class.courseId
//   -> Enrollment.classId -> Attendance/Grade .enrollmentId
//   Session.classId -> Class -> ...
//   Booking: classId chain when present, else the teacher's class centers.
//   Rating: the teacher's class centers, intersected with the classId chain
//   when a classId is present.
//   Student: any enrollment in a center class. Teacher: any taught class in
//   the center. A center-linked row with a broken chain (e.g. a Program with
//   no centerId) resolves to NO center and is therefore invisible to every
//   center actor — fail closed. Operators (no centerActor) are never narrowed.
//
// CONTRACT.
//   - Every helper is TENANT-SCOPED: the caller passes the trusted tenantId
//     and the service layer re-applies it, so a foreign tenant answers empty
//     / false and existence is never leaked.
//   - The center id is NEVER taken from the request. Callers pass
//     `req.centerActor.id`, which is derived from the signed token.
//   - These helpers only ever NARROW a result set. They never widen one and
//     never authorise anything on their own: the route's requirePermission
//     still decides access first.

const programService = require('../services/program.service');
const courseService = require('../services/course.service');
const classService = require('../services/class.service');
const enrollmentService = require('../services/enrollment.service');

function _present(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function _id(v) {
  return _present(v) ? String(v).trim() : '';
}

// ---------------------------------------------------------------------------
// Center derivation (chain resolution, same tenant throughout)
// ---------------------------------------------------------------------------

// Direct field: the only row type that stores its own center.
function programCenterId(tenantId, programId) {
  if (!_present(tenantId) || !_present(programId)) return '';
  const program = programService.getProgram({ tenantId: String(tenantId) }, String(programId));
  if (!program) return '';
  return _id(program.centerId);
}

function courseCenterId(tenantId, courseId) {
  if (!_present(tenantId) || !_present(courseId)) return '';
  const course = courseService.getCourse({ tenantId: String(tenantId) }, String(courseId));
  if (!course || !_present(course.programId)) return '';
  return programCenterId(tenantId, course.programId);
}

function classCenterId(tenantId, classId) {
  if (!_present(tenantId) || !_present(classId)) return '';
  const cls = classService.getClass({ tenantId: String(tenantId) }, String(classId));
  if (!cls || !_present(cls.courseId)) return '';
  return courseCenterId(tenantId, cls.courseId);
}

function enrollmentCenterId(tenantId, enrollmentId) {
  if (!_present(tenantId) || !_present(enrollmentId)) return '';
  const enrollment = enrollmentService.getEnrollment({ tenantId: String(tenantId) }, String(enrollmentId));
  if (!enrollment || !_present(enrollment.classId)) return '';
  return classCenterId(tenantId, enrollment.classId);
}

// The centers a teacher reaches through the classes they teach.
function teacherCenterIds(tenantId, teacherId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(teacherId)) return ids;
  const classes = classService.listClasses({ tenantId: String(tenantId) }, { teacherId: String(teacherId) }) || [];
  for (const cls of classes) {
    const centerId = courseCenterId(tenantId, cls.courseId);
    if (centerId) ids.add(centerId);
  }
  return ids;
}

function teacherTeachesInCenter(tenantId, teacherId, centerId) {
  if (!_present(teacherId) || !_present(centerId)) return false;
  return teacherCenterIds(tenantId, teacherId).has(String(centerId));
}

// The centers a booking touches: its class chain when a classId is stored,
// otherwise the centers of the classes its teacher teaches.
function bookingCenterIds(tenantId, booking) {
  const ids = new Set();
  if (!booking) return ids;
  if (_present(booking.classId)) {
    const centerId = classCenterId(tenantId, booking.classId);
    if (centerId) ids.add(centerId);
    return ids;
  }
  if (_present(booking.teacherId)) {
    for (const centerId of teacherCenterIds(tenantId, booking.teacherId)) ids.add(centerId);
  }
  return ids;
}

// The centers a rating touches: the rated teacher's class centers,
// intersected with the classId chain when a classId is stored.
function ratingCenterIds(tenantId, rating) {
  const ids = new Set();
  if (!rating) return ids;
  if (_present(rating.classId)) {
    const centerId = classCenterId(tenantId, rating.classId);
    if (!centerId) return ids;
    if (!_present(rating.teacherId) || teacherTeachesInCenter(tenantId, rating.teacherId, centerId)) {
      ids.add(centerId);
    }
    return ids;
  }
  if (_present(rating.teacherId)) {
    for (const centerId of teacherCenterIds(tenantId, rating.teacherId)) ids.add(centerId);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Allowed id sets (for list narrowing)
// ---------------------------------------------------------------------------

function centerClassIds(tenantId, centerId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(centerId)) return ids;
  const classes = classService.listClasses({ tenantId: String(tenantId) }, {}) || [];
  for (const cls of classes) {
    if (!_present(cls.id)) continue;
    if (classCenterId(tenantId, cls.id) === String(centerId)) ids.add(String(cls.id));
  }
  return ids;
}

function centerCourseIds(tenantId, centerId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(centerId)) return ids;
  const courses = courseService.listCourses({ tenantId: String(tenantId) }, {}) || [];
  for (const course of courses) {
    if (!_present(course.id)) continue;
    if (courseCenterId(tenantId, course.id) === String(centerId)) ids.add(String(course.id));
  }
  return ids;
}

function centerEnrollmentIds(tenantId, centerId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(centerId)) return ids;
  const allowedClasses = centerClassIds(tenantId, centerId);
  const enrollments = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, {}) || [];
  for (const enrollment of enrollments) {
    if (!_present(enrollment.id)) continue;
    if (allowedClasses.has(String(enrollment.classId || ''))) ids.add(String(enrollment.id));
  }
  return ids;
}

function centerStudentIds(tenantId, centerId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(centerId)) return ids;
  const allowedClasses = centerClassIds(tenantId, centerId);
  const enrollments = enrollmentService.listEnrollments({ tenantId: String(tenantId) }, {}) || [];
  for (const enrollment of enrollments) {
    if (!_present(enrollment.studentId)) continue;
    if (allowedClasses.has(String(enrollment.classId || ''))) ids.add(String(enrollment.studentId));
  }
  return ids;
}

function centerTeacherIds(tenantId, centerId) {
  const ids = new Set();
  if (!_present(tenantId) || !_present(centerId)) return ids;
  const classes = classService.listClasses({ tenantId: String(tenantId) }, {}) || [];
  for (const cls of classes) {
    if (!_present(cls.teacherId)) continue;
    if (classCenterId(tenantId, cls.id) === String(centerId)) ids.add(String(cls.teacherId));
  }
  return ids;
}

// Precomputed predicate inputs for booking/rating lists.
function centerBookingFilter(tenantId, centerId) {
  return {
    classIds: centerClassIds(tenantId, centerId),
    teacherIds: centerTeacherIds(tenantId, centerId)
  };
}

function bookingRowInCenter(row, filter) {
  if (!row || !filter) return false;
  if (_present(row.classId)) return filter.classIds.has(String(row.classId));
  if (_present(row.teacherId)) return filter.teacherIds.has(String(row.teacherId));
  return false;
}

function centerRatingFilter(tenantId, centerId) {
  return {
    classIds: centerClassIds(tenantId, centerId),
    teacherIds: centerTeacherIds(tenantId, centerId)
  };
}

function ratingRowInCenter(row, filter) {
  if (!row || !filter) return false;
  if (!filter.teacherIds.has(String(row.teacherId || ''))) return false;
  if (_present(row.classId)) return filter.classIds.has(String(row.classId));
  return true;
}

// ---------------------------------------------------------------------------
// Single-row predicates (controllers load the row in-tenant first, so an
// unknown id answers false here and the controller's own 404 still wins)
// ---------------------------------------------------------------------------

function centerOwnsCenter(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return String(id) === String(centerId);
}

function centerOwnsProgram(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return programCenterId(tenantId, id) === String(centerId);
}

function centerOwnsCourse(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return courseCenterId(tenantId, id) === String(centerId);
}

function centerOwnsClass(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return classCenterId(tenantId, id) === String(centerId);
}

function centerOwnsEnrollment(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return enrollmentCenterId(tenantId, id) === String(centerId);
}

function centerOwnsStudent(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return centerStudentIds(tenantId, centerId).has(String(id));
}

function centerOwnsTeacher(tenantId, id, centerId) {
  if (!_present(id) || !_present(centerId)) return false;
  return centerTeacherIds(tenantId, centerId).has(String(id));
}

function centerOwnsAttendance(tenantId, enrollmentId, centerId) {
  if (!_present(enrollmentId) || !_present(centerId)) return false;
  return enrollmentCenterId(tenantId, enrollmentId) === String(centerId);
}

function centerOwnsGrade(tenantId, enrollmentId, centerId) {
  return centerOwnsAttendance(tenantId, enrollmentId, centerId);
}

function centerOwnsSession(tenantId, classId, centerId) {
  if (!_present(classId) || !_present(centerId)) return false;
  return classCenterId(tenantId, classId) === String(centerId);
}

function centerOwnsBooking(tenantId, bookingRow, centerId) {
  if (!bookingRow || !_present(centerId)) return false;
  return bookingCenterIds(tenantId, bookingRow).has(String(centerId));
}

function centerOwnsRating(tenantId, ratingRow, centerId) {
  if (!ratingRow || !_present(centerId)) return false;
  return ratingCenterIds(tenantId, ratingRow).has(String(centerId));
}

// ---------------------------------------------------------------------------
// List narrowing (rows without the reference are dropped, never exposed)
// ---------------------------------------------------------------------------

function filterRowsByCenter(rows, allowedIds, key) {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r) => r && _present(r[key]) && allowedIds.has(String(r[key])));
}

function filterStudentsByCenter(students, allowedStudentIds) {
  if (!Array.isArray(students)) return [];
  return students.filter((s) => s && _present(s.id) && allowedStudentIds.has(String(s.id)));
}

function filterTeachersByCenter(teachers, allowedTeacherIds) {
  if (!Array.isArray(teachers)) return [];
  return teachers.filter((t) => t && _present(t.id) && allowedTeacherIds.has(String(t.id)));
}

module.exports = {
  programCenterId,
  courseCenterId,
  classCenterId,
  enrollmentCenterId,
  teacherCenterIds,
  teacherTeachesInCenter,
  bookingCenterIds,
  ratingCenterIds,
  centerClassIds,
  centerCourseIds,
  centerEnrollmentIds,
  centerStudentIds,
  centerTeacherIds,
  centerBookingFilter,
  bookingRowInCenter,
  centerRatingFilter,
  ratingRowInCenter,
  centerOwnsCenter,
  centerOwnsProgram,
  centerOwnsCourse,
  centerOwnsClass,
  centerOwnsEnrollment,
  centerOwnsStudent,
  centerOwnsTeacher,
  centerOwnsAttendance,
  centerOwnsGrade,
  centerOwnsSession,
  centerOwnsBooking,
  centerOwnsRating,
  filterRowsByCenter,
  filterStudentsByCenter,
  filterTeachersByCenter
};
