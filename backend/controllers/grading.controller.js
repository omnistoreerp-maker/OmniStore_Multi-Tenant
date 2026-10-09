'use strict';

// grading.controller — STU-10 Education Grading records (Device 2).
//
// Mirrors the student/teacher/center/course/class/enrollment/attendance
// controllers exactly: tenant identity is resolved EXCLUSIVELY through the
// canonical `trustedTenantId(req)` helper, which prefers the reconstructed
// `req.tenantContext` and falls back to the server-signed token claim. It NEVER
// reads query, body, or any request header, so a `tenantId`, `companyId` or
// `branchId` supplied in the body, the query string or `X-Tenant-Id` is inert.
// There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / an unresolvable Enrollment
// reference / a grading date in the future / an attempt to change the immutable
// enrollment relationship, 404 not found or cross-tenant, 409 a grade already
// recorded for that enrollment, 500 unexpected only. Stack traces, file paths,
// tenant identifiers, storage details and secrets are never returned.
//
// There is no DELETE handler and no /archive or /withdraw route: a grade is a
// historical academic outcome, and a re-mark is corrected through PUT, which is
// auditable in a way a delete would not be.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const gradingService = require('../services/grading.service');
const teacherOwnership = require('../middleware/teacherOwnership');
const centerOwnership = require('../middleware/centerOwnership');
const studentOwnership = require('../middleware/studentOwnership');
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

// Shared error mapping for the two write paths. A typed conflict becomes 409
// with its `GRADING_CONFLICT` code; a validation or reference failure becomes
// 400 with a `details` list; anything else is logged and hidden behind a generic
// 500 so no internal detail escapes.
function _handleWriteError(res, err, message) {
  if (err && err.conflict === true) {
    return error(res, err.message, 409, { code: err.code, conflict: true });
  }
  if (err && Array.isArray(err.validation)) {
    return error(res, err.message, 400, { details: err.validation });
  }
  logger.error('grading controller error:', err.message);
  error(res, message, 500);
}

// TEACHER OWNERSHIP - a Grade row stores only `enrollmentId`, so the owning
// teacher is resolved THROUGH the Enrollment and its Class. When
// `req.teacherActor` is set:
//   - listGrading is force-scoped to the Enrollment ids of that teacher's own
//     classes (a query filter narrows within that set, never widens it);
//   - getGrade / createGrade / updateGrade refuse an Enrollment of another
//     teacher's class with 403 OWNERSHIP_DENIED. 404 still wins across tenants,
//     so existence is never leaked (the row is loaded inside the trusted
//     tenant BEFORE ownership is judged). An enrollmentId that does not
//     resolve inside the trusted tenant answers the SAME 403 as a foreign one
//     — never a 403/400 split — so the check is not an existence oracle.
function _ownership403(res, message) {
  error(res, message, 403, { code: 'OWNERSHIP_DENIED' });
}

function _present(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function _teacherId(req) {
  return req && req.teacherActor && req.teacherActor.id ? String(req.teacherActor.id) : '';
}

function _teacherOwnsEnrollment(req, tenantId, enrollmentId) {
  const teacherId = _teacherId(req);
  if (!teacherId) return false;
  return teacherOwnership.teacherOwnsEnrollment(tenantId, enrollmentId, teacherId);
}

// CENTER OWNERSHIP — the server-resolved `req.centerActor.id` (never a
// query/body value). A Grade row stores only `enrollmentId`, so the owning
// center resolves THROUGH the Enrollment and its Class. A linked center sees
// only its own grades. Unlinked callers (operators) are unchanged, and any
// teacher narrowing composes by intersection.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _centerOwnsEnrollment(req, tenantId, enrollmentId) {
  const centerId = _centerId(req);
  if (!centerId) return false;
  return centerOwnership.centerOwnsGrade(tenantId, enrollmentId, centerId);
}

// STUDENT SELF-SCOPE — the server-resolved `req.educationStudent.id` (never a
// query/body value). A Grade row resolves to a student only THROUGH its
// Enrollment, so a LINKED student sees only their OWN grades. The post-filter
// runs after the query filters and after any teacher/center narrowing
// (intersection), so no query key can widen past the self scope. Unlinked
// callers (operators) are unchanged.
function _studentId(req) {
  return req && req.educationStudent && req.educationStudent.id ? String(req.educationStudent.id) : '';
}

function _studentOwnsEnrollment(req, tenantId, enrollmentId) {
  const studentId = _studentId(req);
  if (!studentId) return false;
  return studentOwnership.studentOwnsEnrollment(tenantId, enrollmentId, studentId);
}

function listGrading(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // `studentId` and `classId` are DERIVED filters resolved through the
    // Enrollment by the service - they are never stored on a Grade row.
    // courseId / programId / teacherId / centerId, free-text `search`,
    // `sessionId` and any assessment vocabulary are deliberately NOT offered:
    // none of them is an authoritative reference on this entity.
    const filters = {
      enrollmentId: req.query ? req.query.enrollmentId : undefined,
      gradingDate: req.query ? req.query.gradingDate : undefined,
      dateFrom: req.query ? req.query.dateFrom : undefined,
      dateTo: req.query ? req.query.dateTo : undefined,
      grade: req.query ? req.query.grade : undefined,
      studentId: req.query ? req.query.studentId : undefined,
      classId: req.query ? req.query.classId : undefined
    };
    const rows = gradingService.listGrading({ tenantId }, filters);
    // A LINKED teacher sees only grades for their own classes.
    let out = rows;
    if (_teacherId(req)) {
      const allowed = teacherOwnership.teacherEnrollmentIds(tenantId, _teacherId(req));
      out = teacherOwnership.filterRowsByEnrollment(out, allowed);
    }
    // A LINKED center sees only grades for its own center. The post-filter
    // composes with the teacher narrowing above (intersection).
    if (_centerId(req)) {
      const allowed = centerOwnership.centerEnrollmentIds(tenantId, _centerId(req));
      out = out.filter((r) => r && allowed.has(String(r.enrollmentId || '')));
    }
    // A LINKED student sees only grades for their own enrollments. The
    // post-filter runs LAST, so no filter above can widen past the self scope.
    if (_studentId(req)) {
      const allowed = studentOwnership.studentEnrollmentIds(tenantId, _studentId(req));
      out = studentOwnership.filterRowsByEnrollment(out, allowed);
    }
    return success(res, out, 'Grading retrieved');
  } catch (err) {
    logger.error('grading.listGrading error:', err.message);
    error(res, 'Failed to retrieve grading', 500);
  }
}

function getGrade(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = gradingService.getGrade({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Grading record not found', 404);
    if (_teacherId(req) && !_teacherOwnsEnrollment(req, tenantId, found.enrollmentId)) {
      return _ownership403(res, 'Teachers may only view grades for their own classes');
    }
    // Same-tenant grade of another center: refused as forbidden.
    if (_centerId(req) && !_centerOwnsEnrollment(req, tenantId, found.enrollmentId)) {
      return _ownership403(res, 'Centers may only view grades for their own center');
    }
    // Same-tenant grade of ANOTHER student's enrollment: refused as forbidden —
    // a linked student only ever reads their own grades (404 already won
    // across tenants).
    if (_studentId(req) && !_studentOwnsEnrollment(req, tenantId, found.enrollmentId)) {
      return _ownership403(res, 'Students may only view their own grades');
    }
    success(res, found, 'Grading record retrieved');
  } catch (err) {
    logger.error('grading.getGrade error:', err.message);
    error(res, 'Failed to retrieve grading record', 500);
  }
}

function createGrade(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const body = req.body || {};
    // A LINKED teacher records only against their own classes.
    if (_teacherId(req) && _present(body.enrollmentId) &&
        !_teacherOwnsEnrollment(req, tenantId, body.enrollmentId)) {
      return _ownership403(res, 'Teachers may only record grades for their own classes');
    }
    // A LINKED center records only against its own center. An enrollmentId
    // that does not resolve inside the trusted tenant answers the SAME 403
    // as a foreign one — never a 403/400 split — so the check is not an
    // existence oracle.
    if (_centerId(req) && _present(body.enrollmentId) &&
        !_centerOwnsEnrollment(req, tenantId, body.enrollmentId)) {
      return _ownership403(res, 'Centers may only record grades for their own center');
    }
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned, derived and later-phase fields, resolves the
    // required Enrollment reference inside the trusted tenant, refuses a future
    // grading date, enforces one-grade-per-enrollment uniqueness and stamps the
    // trusted tenantId.
    const created = gradingService.createGrade({ tenantId }, body);
    success(res, created, 'Grading record created', 201);
  } catch (err) {
    _handleWriteError(res, err, 'Failed to create grading record');
  }
}

function updateGrade(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A re-mark. `grade`, `gradingDate` and `notes` are mutable;
    // `enrollmentId` is immutable and any attempt to supply it is rejected
    // before the persisted record is touched. A LINKED teacher re-marks only
    // their own rows, with the same load-first 404/403 ordering as the read.
    const existing = gradingService.getGrade({ tenantId }, req.params.id);
    if (!existing) return error(res, 'Grading record not found', 404);
    if (_teacherId(req) && !_teacherOwnsEnrollment(req, tenantId, existing.enrollmentId)) {
      return _ownership403(res, 'Teachers may only re-mark grades for their own classes');
    }
    if (_centerId(req) && !_centerOwnsEnrollment(req, tenantId, existing.enrollmentId)) {
      return _ownership403(res, 'Centers may only re-mark grades for their own center');
    }
    const updated = gradingService.updateGrade({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Grading record not found', 404);
    success(res, updated, 'Grading record updated');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to update grading record');
  }
}

module.exports = {
  listGrading,
  getGrade,
  createGrade,
  updateGrade
};