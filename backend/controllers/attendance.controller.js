'use strict';

// attendance.controller — STU-8 Education Attendance records (Device 2).
//
// Mirrors the student/teacher/center/course/class/enrollment controllers exactly:
// tenant identity is resolved EXCLUSIVELY through the canonical
// `trustedTenantId(req)` helper, which prefers the reconstructed
// `req.tenantContext` and falls back to the server-signed token claim. It NEVER
// reads query, body, or any request header, so a `tenantId`, `companyId` or
// `branchId` supplied in the body, the query string or `X-Tenant-Id` is inert.
// There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / an unresolvable Enrollment
// reference / a date outside the enrollment window or in the future / an attempt
// to change the immutable enrollment relationship, 404 not found or
// cross-tenant, 409 a date already recorded for that enrollment, 500 unexpected
// only. Stack traces, file paths, tenant identifiers, storage details and
// secrets are never returned.
//
// There is no DELETE handler and no /archive or /withdraw route: an attendance
// record is a historical fact, and a mis-marked register is corrected through
// PUT, which is auditable in a way that a delete would not be.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const attendanceService = require('../services/attendance.service');
const teacherOwnership = require('../middleware/teacherOwnership');
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
// with its `ATTENDANCE_CONFLICT` code; a validation or reference failure
// becomes 400 with a `details` list; anything else is logged and hidden behind
// a generic 500 so no internal detail escapes.
function _handleWriteError(res, err, message) {
  if (err && err.conflict === true) {
    return error(res, err.message, 409, { code: err.code });
  }
  if (err && Array.isArray(err.validation)) {
    return error(res, err.message, 400, { details: err.validation });
  }
  logger.error('attendance controller error:', err.message);
  error(res, message, 500);
}

// TEACHER OWNERSHIP - an Attendance row stores only `enrollmentId`, so the
// owning teacher is resolved THROUGH the Enrollment and its Class. When
// `req.teacherActor` is set:
//   - listAttendance is force-scoped to the Enrollment ids of that teacher's
//     own classes (a query `classId` narrows within that set, it never widens
//     it);
//   - getAttendance / createAttendance / updateAttendance / bulkCreateAttendance
//     refuse an Enrollment of another teacher's class with 403 OWNERSHIP_DENIED.
//     404 still wins across tenants — existence is never leaked, because the
//     row is loaded inside the trusted tenant BEFORE ownership is judged.
//   - an enrollmentId that does not resolve inside the trusted tenant answers
//     the SAME 403 as a foreign one (never a 403/400 split), so the ownership
//     check is not an existence oracle. An ABSENT enrollmentId is a malformed
//     body, not an ownership question, and still falls through to the 400.
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

function listAttendance(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // `studentId` and `classId` are DERIVED filters resolved through the
    // Enrollment by the service - they are never stored on an Attendance row.
    // courseId / programId / teacherId / centerId and free-text `search` are
    // deliberately NOT offered in STU-8.
    const filters = {
      enrollmentId: req.query ? req.query.enrollmentId : undefined,
      attendanceDate: req.query ? req.query.attendanceDate : undefined,
      dateFrom: req.query ? req.query.dateFrom : undefined,
      dateTo: req.query ? req.query.dateTo : undefined,
      status: req.query ? req.query.status : undefined,
      studentId: req.query ? req.query.studentId : undefined,
      classId: req.query ? req.query.classId : undefined
    };
    const rows = attendanceService.listAttendance({ tenantId }, filters);
    // A LINKED teacher sees only registers for their own classes.
    if (!!_teacherId(req)) {
      const allowed = teacherOwnership.teacherEnrollmentIds(tenantId, _teacherId(req));
      return success(res, teacherOwnership.filterRowsByEnrollment(rows, allowed), 'Attendance retrieved');
    }
    success(res, rows, 'Attendance retrieved');
  } catch (err) {
    logger.error('attendance.listAttendance error:', err.message);
    error(res, 'Failed to retrieve attendance', 500);
  }
}

function getAttendance(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = attendanceService.getAttendance({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Attendance not found', 404);
    if (!!_teacherId(req) && !_teacherOwnsEnrollment(req, tenantId, found.enrollmentId)) {
      return _ownership403(res, 'Teachers may only view attendance for their own classes');
    }
    success(res, found, 'Attendance retrieved');
  } catch (err) {
    logger.error('attendance.getAttendance error:', err.message);
    error(res, 'Failed to retrieve attendance', 500);
  }
}

function createAttendance(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED teacher records only against their own classes.
    const body = req.body || {};
    if (!!_teacherId(req) && _present(body.enrollmentId) &&
        !_teacherOwnsEnrollment(req, tenantId, body.enrollmentId)) {
      return _ownership403(res, 'Teachers may only record attendance for their own classes');
    }
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned and later-phase fields, resolves the
    // required Enrollment reference inside the trusted tenant, enforces the
    // enrollment window plus one-row-per-day uniqueness, and stamps the trusted
    // tenantId.
    const created = attendanceService.createAttendance({ tenantId }, body);
    success(res, created, 'Attendance created', 201);
  } catch (err) {
    _handleWriteError(res, err, 'Failed to create attendance');
  }
}

function updateAttendance(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A correction. `status`, `notes` and `attendanceDate` are mutable;
    // `enrollmentId` is immutable and any attempt to supply it is rejected
    // before the persisted record is touched. A LINKED teacher corrects only
    // their own rows, with the same load-first 404/403 ordering as the read.
    const existing = attendanceService.getAttendance({ tenantId }, req.params.id);
    if (!existing) return error(res, 'Attendance not found', 404);
    if (!!_teacherId(req) && !_teacherOwnsEnrollment(req, tenantId, existing.enrollmentId)) {
      return _ownership403(res, 'Teachers may only correct attendance for their own classes');
    }
    const updated = attendanceService.updateAttendance({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Attendance not found', 404);
    success(res, updated, 'Attendance updated');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to update attendance');
  }
}

function bulkCreateAttendance(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED teacher's register is force-scoped BEFORE the service runs, so
    // not one foreign row is ever validated or persisted. Every entry must be
    // theirs; one foreign entry refuses the whole batch.
    const body = req.body || {};
    if (!!_teacherId(req)) {
      const entries = Array.isArray(body.entries) ? body.entries : [];
      for (const entry of entries) {
        const eid = entry ? entry.enrollmentId : undefined;
        // A MISSING enrollmentId is a malformed entry, not a foreign one: it
        // falls through to the service's own 400. A PRESENT one that does not
        // resolve to one of this teacher's classes answers 403 — unknown and
        // foreign ids are refused IDENTICALLY, so the batch is no oracle.
        if (!_present(eid)) continue;
        if (!_teacherOwnsEnrollment(req, tenantId, eid)) {
          return _ownership403(res, 'Teachers may only record attendance for their own classes');
        }
      }
    }
    // The batch path writes exactly the record `createAttendance` writes, one
    // per entry, under the same trusted tenant and the same rules. It records a
    // register; it never corrects one, so an already-recorded day is a typed 409
    // rather than a silent overwrite. All validation completes before the
    // single store write, so a refused batch persists nothing.
    const result = attendanceService.bulkCreateAttendance({ tenantId }, body);
    success(res, result, 'Attendance recorded', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, {
        code: err.code,
        attendanceDate: err.attendanceDate || null,
        conflicts: Array.isArray(err.conflicts) ? err.conflicts : []
      });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('attendance controller error:', err.message);
    error(res, 'Failed to record attendance', 500);
  }
}

module.exports = {
  listAttendance,
  getAttendance,
  createAttendance,
  updateAttendance,
  bulkCreateAttendance
};