'use strict';

// student.controller — STU-2 Student records (Device 2).
//
// Mirrors educationPack.controller exactly: tenant identity is resolved
// EXCLUSIVELY through the canonical `trustedTenantId(req)` helper from the
// authorization middleware. It prefers the reconstructed `req.tenantContext`
// and falls back to the server-signed token claim, and it NEVER reads query,
// body, or any request header. There is no second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const studentService = require('../services/student.service');
const enrollmentService = require('../services/enrollment.service');
const classService = require('../services/class.service');
const attendanceService = require('../services/attendance.service');
const schedulingService = require('../services/scheduling.service');
const logger = require('../utils/logger');

// Returns the trusted tenant id, or null after having already answered 400.
function _tenantIdOr400(req, res) {
  const tenantId = trustedTenantId(req);
  if (!tenantId) {
    error(res, 'Tenant context required', 400);
    return null;
  }
  return String(tenantId);
}

function listStudents(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only status and search are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      search: req.query ? req.query.search : undefined
    };
    success(res, studentService.listStudents({ tenantId }, filters), 'Students retrieved');
  } catch (err) {
    logger.error('student.listStudents error:', err.message);
    error(res, 'Failed to retrieve students', 500);
  }
}

function getStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = studentService.getStudent({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Student not found', 404);
    success(res, found, 'Student retrieved');
  } catch (err) {
    logger.error('student.getStudent error:', err.message);
    error(res, 'Failed to retrieve student', 500);
  }
}

function createStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = studentService.createStudent({ tenantId }, req.body || {});
    success(res, created, 'Student created', 201);
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('student.createStudent error:', err.message);
    error(res, 'Failed to create student', 500);
  }
}

function updateStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const updated = studentService.updateStudent({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Student not found', 404);
    success(res, updated, 'Student updated');
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('student.updateStudent error:', err.message);
    error(res, 'Failed to update student', 500);
  }
}

function archiveStudent(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const archived = studentService.archiveStudent({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Student not found', 404);
    success(res, archived, 'Student archived');
  } catch (err) {
    logger.error('student.archiveStudent error:', err.message);
    error(res, 'Failed to archive student', 500);
  }
}

// ---------------------------------------------------------------------------
// Student progress (read-only, derived from canonical P2 data).
//
// This is NOT a lesson entity and NOT a progress store. It computes raw
// descriptive counts from the canonical P2 model the operator already owns:
//
//   enrollmentService.listEnrollments  -> which classes/courses this student is
//                                        enrolled in (active or withdrawn)
//   classService.listClasses           -> the Class rows behind those enrollments
//   attendanceService.listAttendance   -> the daily attendance marks keyed by
//                                        enrollmentId
//   schedulingService.listScheduling   -> the scheduled sessions keyed by classId
//
// No score, grade, GPA, percentage, performance scale or ranking is produced.
// No completion record is fabricated. A "completed" count is only ever a count
// of real attendance rows that exist in the canonical store. If the P2 model
// has no lessons, this endpoint reports zero lessons — it never invents them.
// ---------------------------------------------------------------------------
function getStudentProgress(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const ctx = { tenantId };
    const studentId = String(req.params.id || '').trim();

    // The student must exist in THIS tenant; a foreign id answers 404 so
    // existence is never leaked across tenants.
    const student = studentService.getStudent(ctx, studentId);
    if (!student) return error(res, 'Student not found', 404);

    const enrollments = enrollmentService.listEnrollments(ctx, { studentId }) || [];
    const enrollmentIds = new Set(enrollments.map((e) => String(e.id)));
    const classIds = new Set(
      enrollments
        .filter((e) => String(e.classId || ''))
        .map((e) => String(e.classId))
    );

    const classes = classService.listClasses(ctx, {}) || [];
    const classById = {};
    for (const c of classes) classById[String(c.id)] = c;

    const attendance = attendanceService.listAttendance(ctx, { studentId }) || [];
    const scheduled = schedulingService.listScheduling(ctx, {}) || [];

    const totalEnrollments = enrollments.length;
    const activeEnrollments = enrollments.filter((e) => e.status === 'active').length;
    const withdrawnEnrollments = enrollments.filter((e) => e.status === 'withdrawn').length;

    const enrolledClassIds = new Set(
      enrollments.map((e) => String(e.classId || ''))
    );
    const enrolledCourseIds = new Set(
      enrollments
        .map((e) => {
          const c = classById[String(e.classId || '')];
          return c ? String(c.courseId || '') : '';
        })
        .filter(Boolean)
    );

    const totalSessions = scheduled.filter((s) => enrolledClassIds.has(String(s.classId || ''))).length;
    const totalAttendance = attendance.filter((a) => enrollmentIds.has(String(a.enrollmentId || ''))).length;
    const presentAttendance = attendance.filter(
      (a) => enrollmentIds.has(String(a.enrollmentId || '')) && a.status === 'present'
    ).length;
    const absentAttendance = attendance.filter(
      (a) => enrollmentIds.has(String(a.enrollmentId || '')) && a.status === 'absent'
    ).length;
    const lateAttendance = attendance.filter(
      (a) => enrollmentIds.has(String(a.enrollmentId || '')) && a.status === 'late'
    ).length;
    const excusedAttendance = attendance.filter(
      (a) => enrollmentIds.has(String(a.enrollmentId || '')) && a.status === 'excused'
    ).length;

    // Raw counts only. No percentage, no GPA, no ranking, no fabricated
    // completion: the caller can compute a rate if they want, from numbers
    // that are provably real.
    success(res, {
      student: {
        id: String(student.id),
        studentCode: student.studentCode || null,
        displayName: [student.firstName, student.lastName].filter(Boolean).join(' ') || null,
        status: student.status || null
      },
      enrollments: {
        total: totalEnrollments,
        active: activeEnrollments,
        withdrawn: withdrawnEnrollments
      },
      courses: {
        enrolled: enrolledCourseIds.size
      },
      classes: {
        enrolled: enrolledClassIds.size
      },
      sessions: {
        scheduled: totalSessions
      },
      attendance: {
        total: totalAttendance,
        present: presentAttendance,
        absent: absentAttendance,
        late: lateAttendance,
        excused: excusedAttendance
      },
      lessons: {
        // The canonical P2 model has no lesson entity. Report zero rather
        // than fabricating a lesson set from sessions or attendance.
        total: 0
      }
    }, 'Student progress retrieved');
  } catch (err) {
    logger.error('student.getStudentProgress error:', err.message);
    error(res, 'Failed to retrieve student progress', 500);
  }
}

// GET /students/me — the learner portal's identity endpoint. Mirrors
// /teachers/me and /centers/me. Authorization is the LINK, not a permission
// grant. Anonymous is 401; authenticated-but-unlinked is 404 STUDENT_NOT_LINKED.
//
// BRANCH ISOLATION: same rule as center.getMe — when the user carries a
// trusted branch scope and the linked student record carries a different
// branchId, the request is refused 403 BRANCH_SCOPE_DENIED.
function getMe(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const student = studentService.getStudentByUserId({ tenantId }, req.user.id);
    if (!student) {
      return error(res, 'No student is linked to this account', 404, { code: 'STUDENT_NOT_LINKED' });
    }
    const userBranch = req.user.branchId;
    if (userBranch && student.branchId && String(student.branchId) !== String(userBranch)) {
      return error(res, 'Branch scope denied', 403, { code: 'BRANCH_SCOPE_DENIED' });
    }
    success(res, student, 'Student retrieved');
  } catch (err) {
    logger.error('student.getMe error:', err.message);
    error(res, 'Failed to resolve the linked student', 500);
  }
}

// POST /students/:id/link-user — Owner/Admin only.
function linkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const linked = studentService.linkUser({ tenantId }, req.params.id, body.userId);
    if (!linked) return error(res, 'Student not found', 404);
    success(res, linked, 'Account linked to student');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('student.linkUser error:', err.message);
    error(res, 'Failed to link account', 500);
  }
}

// DELETE /students/:id/link-user — Owner/Admin only, idempotent.
function unlinkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const unlinked = studentService.unlinkUser({ tenantId }, req.params.id);
    if (!unlinked) return error(res, 'Student not found', 404);
    success(res, unlinked, 'Account unlinked from student');
  } catch (err) {
    logger.error('student.unlinkUser error:', err.message);
    error(res, 'Failed to unlink account', 500);
  }
}

module.exports = {
  listStudents, getStudent, createStudent, updateStudent, archiveStudent,
  getStudentProgress, getMe, linkUser, unlinkUser
};