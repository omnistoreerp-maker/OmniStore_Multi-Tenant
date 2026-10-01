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
    success(res, gradingService.listGrading({ tenantId }, filters), 'Grading retrieved');
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
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned, derived and later-phase fields, resolves the
    // required Enrollment reference inside the trusted tenant, refuses a future
    // grading date, enforces one-grade-per-enrollment uniqueness and stamps the
    // trusted tenantId.
    const created = gradingService.createGrade({ tenantId }, req.body || {});
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
    // before the persisted record is touched.
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