'use strict';

// scheduling.controller — STU-9 Education Scheduling records (Device 2).
//
// Mirrors the student/teacher/center/course/class/enrollment/attendance
// controllers exactly: tenant identity is resolved EXCLUSIVELY through the
// canonical `trustedTenantId(req)` helper, which prefers the reconstructed
// `req.tenantContext` and falls back to the server-signed token claim. It NEVER
// reads query, body, or any request header, so a `tenantId`, `companyId` or
// `branchId` supplied in the body, the query string or `X-Tenant-Id` is inert.
// There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / an unresolvable or archived
// Class reference / an empty or inverted time range, 404 not found or
// cross-tenant, 409 a class or teacher already committed to that slot,
// 500 unexpected only. Stack traces, file paths, tenant identifiers, storage
// details and secrets are never returned.
//
// There is no DELETE handler and no /archive or /cancel route: a scheduled
// session is a plan, and a wrong plan is corrected through PUT, which is
// auditable in a way a delete is not.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
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

// Shared error mapping for the two write paths. A typed conflict becomes 409
// with its `SCHEDULING_CONFLICT` code; a validation or reference failure
// becomes 400 with a `details` list; anything else is logged and hidden behind
// a generic 500 so no internal detail escapes.
function _handleWriteError(res, err, message) {
  if (err && err.conflict === true) {
    return error(res, err.message, 409, { code: err.code, conflict: true, scheduledDate: err.scheduledDate });
  }
  if (err && Array.isArray(err.validation)) {
    return error(res, err.message, 400, { details: err.validation });
  }
  logger.error('scheduling controller error:', err.message);
  error(res, message, 500);
}

function listScheduling(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // `teacherId` is a DERIVED filter resolved through the Class by the service
    // - it is never stored on a session. courseId / programId / centerId /
    // studentId are NOT offered: none of them is an authoritative reference on
    // this entity, and free-text `search` has nothing to match against.
    const filters = {
      classId: req.query ? req.query.classId : undefined,
      teacherId: req.query ? req.query.teacherId : undefined,
      scheduledDate: req.query ? req.query.scheduledDate : undefined,
      dateFrom: req.query ? req.query.dateFrom : undefined,
      dateTo: req.query ? req.query.dateTo : undefined
    };
    success(res, schedulingService.listScheduling({ tenantId }, filters), 'Scheduling retrieved');
  } catch (err) {
    logger.error('scheduling.listScheduling error:', err.message);
    error(res, 'Failed to retrieve scheduling', 500);
  }
}

function getSession(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = schedulingService.getSession({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Scheduling session not found', 404);
    success(res, found, 'Scheduling session retrieved');
  } catch (err) {
    logger.error('scheduling.getSession error:', err.message);
    error(res, 'Failed to retrieve scheduling session', 500);
  }
}

function createSession(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned, derived and later-phase fields, resolves the
    // required Class reference inside the trusted tenant, refuses an empty or
    // inverted time range, enforces both conflict rules and stamps the trusted
    // tenantId.
    const created = schedulingService.createSession({ tenantId }, req.body || {});
    success(res, created, 'Scheduling session created', 201);
  } catch (err) {
    _handleWriteError(res, err, 'Failed to create scheduling session');
  }
}

function updateSession(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A correction. `scheduledDate`, `startTime`, `endTime` and `notes` are
    // mutable; `classId` is immutable and any attempt to supply it is rejected
    // before the persisted record is touched.
    const updated = schedulingService.updateSession({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Scheduling session not found', 404);
    success(res, updated, 'Scheduling session updated');
  } catch (err) {
    _handleWriteError(res, err, 'Failed to update scheduling session');
  }
}

module.exports = {
  listScheduling,
  getSession,
  createSession,
  updateSession
};