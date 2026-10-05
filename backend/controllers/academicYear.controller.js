'use strict';

// academicYear.controller — P1 Academic Foundation: Academic Year records.
//
// Mirrors the STU entity controllers exactly: tenant identity is resolved
// EXCLUSIVELY through the canonical `trustedTenantId(req)` helper. It prefers
// the reconstructed `req.tenantContext` and falls back to the signed token
// claim, and it NEVER reads query, body, or any request header. There is no
// second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or
// cross-tenant, 409 duplicate yearCode inside the tenant, 500 unexpected
// only. Stack traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const academicYearService = require('../services/academicYear.service');
const centerOwnership = require('../middleware/centerOwnership');
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

function _ownership403(res, message) {
  error(res, message, 403, { code: 'OWNERSHIP_DENIED' });
}

// CENTER OWNERSHIP — the server-resolved `req.centerActor.id` (never a
// query/body value). An Academic Year stores its own `centerId`, so a linked
// center is force-scoped to it directly. Unlinked callers (operators) are
// unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listAcademicYears(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // A LINKED center's list is force-scoped to its own center: the query
    // `centerId` is overridden by the linked record, never trusted.
    const filters = {
      status: req.query ? req.query.status : undefined,
      centerId: req.query ? req.query.centerId : undefined,
      search: req.query ? req.query.search : undefined
    };
    if (_centerId(req)) filters.centerId = _centerId(req);
    success(res, academicYearService.listAcademicYears({ tenantId }, filters), 'Academic years retrieved');
  } catch (err) {
    logger.error('academicYear.listAcademicYears error:', err.message);
    error(res, 'Failed to retrieve academic years', 500);
  }
}

function getAcademicYear(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = academicYearService.getAcademicYear({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Academic year not found', 404);
    // Same-tenant year of another center: refused as forbidden — a linked
    // center only ever reads its own academic years.
    if (_centerId(req) && !centerOwnership.centerOwnsAcademicYear(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own academic years');
    }
    success(res, found, 'Academic year retrieved');
  } catch (err) {
    logger.error('academicYear.getAcademicYear error:', err.message);
    error(res, 'Failed to retrieve academic year', 500);
  }
}

function createAcademicYear(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the REQUIRED Center
    // reference inside the trusted tenant and stamps the trusted tenantId.
    //
    // A LINKED center creates only INTO its own center: an absent centerId is
    // stamped by the server (whoever they tried to name is overridden), while
    // a supplied centerId naming any other center is refused here with 403.
    // Unknown and foreign ids are refused IDENTICALLY, so this check never
    // becomes an existence oracle.
    const body = { ...(req.body || {}) };
    if (_centerId(req)) {
      if (body.centerId === undefined || body.centerId === null || String(body.centerId).trim() === '') {
        body.centerId = _centerId(req);
      } else if (String(body.centerId).trim() !== _centerId(req)) {
        return _ownership403(res, 'Centers may only create academic years in their own center');
      }
    }
    const created = academicYearService.createAcademicYear({ tenantId }, body);
    success(res, created, 'Academic year created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('academicYear.createAcademicYear error:', err.message);
    error(res, 'Failed to create academic year', 500);
  }
}

function updateAcademicYear(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own academic years (load-first
    // 404/403), and may not move a year to another center via the body.
    if (_centerId(req)) {
      const existing = academicYearService.getAcademicYear({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Academic year not found', 404);
      if (!centerOwnership.centerOwnsAcademicYear(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own academic years');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.centerId !== undefined && body.centerId !== null &&
          String(body.centerId).trim() !== '' && String(body.centerId).trim() !== _centerId(req)) {
        return _ownership403(res, 'Centers may not move academic years to another center');
      }
    }
    const updated = academicYearService.updateAcademicYear({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Academic year not found', 404);
    success(res, updated, 'Academic year updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('academicYear.updateAcademicYear error:', err.message);
    error(res, 'Failed to update academic year', 500);
  }
}

function archiveAcademicYear(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = academicYearService.getAcademicYear({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Academic year not found', 404);
      if (!centerOwnership.centerOwnsAcademicYear(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own academic years');
      }
    }
    const archived = academicYearService.archiveAcademicYear({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Academic year not found', 404);
    success(res, archived, 'Academic year archived');
  } catch (err) {
    logger.error('academicYear.archiveAcademicYear error:', err.message);
    error(res, 'Failed to archive academic year', 500);
  }
}

module.exports = {
  listAcademicYears,
  getAcademicYear,
  createAcademicYear,
  updateAcademicYear,
  archiveAcademicYear
};
