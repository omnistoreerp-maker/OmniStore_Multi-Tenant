'use strict';

// program.controller — STU-5 Education Program records (Device 2).
//
// Mirrors the student/teacher/center controllers exactly: tenant identity is
// resolved EXCLUSIVELY through the canonical `trustedTenantId(req)` helper.
// It prefers the reconstructed `req.tenantContext` and falls back to the
// server-signed token claim, and it NEVER reads query, body, or any request
// header. There is no second tenant resolver here.
//
// A Program is an entity INSIDE the trusted tenant. Nothing in this controller
// creates, selects, or implies a different tenant.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable reference,
// 404 not found or cross-tenant, 409 duplicate programCode, 500 unexpected
// only. Stack traces, tenant identifiers, storage details and secrets are
// never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const programService = require('../services/program.service');
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
// query/body value). Program is the one row type that stores its own
// `centerId`, so a linked center is force-scoped to it directly. Unlinked
// callers (operators) are unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listPrograms(req, res) {
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
    success(res, programService.listPrograms({ tenantId }, filters), 'Programs retrieved');
  } catch (err) {
    logger.error('program.listPrograms error:', err.message);
    error(res, 'Failed to retrieve programs', 500);
  }
}

function getProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = programService.getProgram({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Program not found', 404);
    // Same-tenant program of another center: refused as forbidden — a linked
    // center only ever reads its own programs.
    if (_centerId(req) && !centerOwnership.centerOwnsProgram(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own programs');
    }
    success(res, found, 'Program retrieved');
  } catch (err) {
    logger.error('program.getProgram error:', err.message);
    error(res, 'Failed to retrieve program', 500);
  }
}

function createProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the Center reference
    // inside the trusted tenant and stamps the trusted tenantId.
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
        return _ownership403(res, 'Centers may only create programs in their own center');
      }
    }
    const created = programService.createProgram({ tenantId }, body);
    success(res, created, 'Program created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('program.createProgram error:', err.message);
    error(res, 'Failed to create program', 500);
  }
}

function updateProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own programs (load-first 404/403), and
    // may not move a program to another center via the body.
    if (_centerId(req)) {
      const existing = programService.getProgram({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Program not found', 404);
      if (!centerOwnership.centerOwnsProgram(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own programs');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.centerId !== undefined && body.centerId !== null &&
          String(body.centerId).trim() !== '' && String(body.centerId).trim() !== _centerId(req)) {
        return _ownership403(res, 'Centers may not move programs to another center');
      }
    }
    const updated = programService.updateProgram({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Program not found', 404);
    success(res, updated, 'Program updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('program.updateProgram error:', err.message);
    error(res, 'Failed to update program', 500);
  }
}

function archiveProgram(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Archives the Program only. There is no cascade: existing Courses are
    // preserved and keep their programId. A LINKED center archives only its
    // own programs (load-first 404/403).
    if (_centerId(req)) {
      const existing = programService.getProgram({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Program not found', 404);
      if (!centerOwnership.centerOwnsProgram(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own programs');
      }
    }
    const archived = programService.archiveProgram({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Program not found', 404);
    success(res, archived, 'Program archived');
  } catch (err) {
    logger.error('program.archiveProgram error:', err.message);
    error(res, 'Failed to archive program', 500);
  }
}

module.exports = { listPrograms, getProgram, createProgram, updateProgram, archiveProgram };