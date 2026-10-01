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
    success(res, attendanceService.listAttendance({ tenantId }, filters), 'Attendance retrieved');
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
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned and later-phase fields, resolves the
    // required Enrollment reference inside the trusted tenant, enforces the
    // enrollment window plus one-row-per-day uniqueness, and stamps the trusted
    // tenantId.
    const created = attendanceService.createAttendance({ tenantId }, req.body || {});
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
    // before the persisted record is touched.
    const updated = attendanceService.updateAttendance({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Attendance not found', 404);
    success(res, updated, 'Attendance updated');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to update attendance');
  }
}

module.exports = {
  listAttendance,
  getAttendance,
  createAttendance,
  updateAttendance
};