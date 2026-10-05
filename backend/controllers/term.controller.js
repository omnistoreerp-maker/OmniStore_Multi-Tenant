'use strict';

// term.controller — P1 Academic Foundation: Term / Semester records.
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
// cross-tenant, 409 duplicate termCode inside the tenant, 500 unexpected
// only. Stack traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const termService = require('../services/term.service');
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
// query/body value). A Term carries no center of its own: it resolves
// through its required Academic Year (Term -> Year.centerId). A linked center
// sees only its own terms. Unlinked callers (operators) are unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listTerms(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      academicYearId: req.query ? req.query.academicYearId : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = termService.listTerms({ tenantId }, filters);
    // A LINKED center lists only the terms of its own academic years. The
    // post-filter composes with any other actor narrowing.
    if (_centerId(req)) {
      const allowed = centerOwnership.centerTermIds(tenantId, _centerId(req));
      rows = rows.filter((t) => t && allowed.has(String(t.id)));
    }
    success(res, rows, 'Terms retrieved');
  } catch (err) {
    logger.error('term.listTerms error:', err.message);
    error(res, 'Failed to retrieve terms', 500);
  }
}

function getTerm(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = termService.getTerm({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Term not found', 404);
    // Same-tenant term of another center: refused as forbidden.
    if (_centerId(req) && !centerOwnership.centerOwnsTerm(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own terms');
    }
    success(res, found, 'Term retrieved');
  } catch (err) {
    logger.error('term.getTerm error:', err.message);
    error(res, 'Failed to retrieve term', 500);
  }
}

function createTerm(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the REQUIRED Academic
    // Year reference inside the trusted tenant, enforces the year date
    // bounds and stamps the trusted tenantId.
    //
    // A LINKED center creates only UNDER its own academic years: a yearId
    // that resolves to a known other-center year is refused here with 403,
    // while an unresolvable yearId falls through to the service's 400 so
    // this check never becomes an existence oracle.
    if (_centerId(req) && req.body && req.body.academicYearId !== undefined &&
        req.body.academicYearId !== null && String(req.body.academicYearId).trim() !== '') {
      const year = academicYearService.getAcademicYear({ tenantId }, req.body.academicYearId);
      if (year && centerOwnership.yearCenterId(tenantId, year.id) !== _centerId(req)) {
        return _ownership403(res, 'Centers may only create terms under their own academic years');
      }
    }
    const created = termService.createTerm({ tenantId }, req.body || {});
    success(res, created, 'Term created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('term.createTerm error:', err.message);
    error(res, 'Failed to create term', 500);
  }
}

function updateTerm(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own terms (load-first 404/403), and may
    // not move a term under another center's year via the body.
    if (_centerId(req)) {
      const existing = termService.getTerm({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Term not found', 404);
      if (!centerOwnership.centerOwnsTerm(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own terms');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.academicYearId !== undefined && body.academicYearId !== null &&
          String(body.academicYearId).trim() !== '') {
        const year = academicYearService.getAcademicYear({ tenantId }, body.academicYearId);
        if (year && centerOwnership.yearCenterId(tenantId, year.id) !== _centerId(req)) {
          return _ownership403(res, 'Centers may not move terms to another center');
        }
      }
    }
    const updated = termService.updateTerm({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Term not found', 404);
    success(res, updated, 'Term updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('term.updateTerm error:', err.message);
    error(res, 'Failed to update term', 500);
  }
}

function archiveTerm(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = termService.getTerm({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Term not found', 404);
      if (!centerOwnership.centerOwnsTerm(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own terms');
      }
    }
    const archived = termService.archiveTerm({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Term not found', 404);
    success(res, archived, 'Term archived');
  } catch (err) {
    logger.error('term.archiveTerm error:', err.message);
    error(res, 'Failed to archive term', 500);
  }
}

module.exports = {
  listTerms,
  getTerm,
  createTerm,
  updateTerm,
  archiveTerm
};
