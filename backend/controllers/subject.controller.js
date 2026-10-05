'use strict';

// subject.controller — P1 Academic Foundation: Subject records.
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
// cross-tenant, 409 duplicate subjectCode inside the tenant, 500 unexpected
// only. Stack traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const subjectService = require('../services/subject.service');
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
// query/body value). A Subject stores its own `centerId`, so a linked center
// is force-scoped to it directly. Unlinked callers (operators) are unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listSubjects(req, res) {
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
    success(res, subjectService.listSubjects({ tenantId }, filters), 'Subjects retrieved');
  } catch (err) {
    logger.error('subject.listSubjects error:', err.message);
    error(res, 'Failed to retrieve subjects', 500);
  }
}

function getSubject(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = subjectService.getSubject({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Subject not found', 404);
    // Same-tenant subject of another center: refused as forbidden — a linked
    // center only ever reads its own subjects.
    if (_centerId(req) && !centerOwnership.centerOwnsSubject(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own subjects');
    }
    success(res, found, 'Subject retrieved');
  } catch (err) {
    logger.error('subject.getSubject error:', err.message);
    error(res, 'Failed to retrieve subject', 500);
  }
}

function createSubject(req, res) {
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
        return _ownership403(res, 'Centers may only create subjects in their own center');
      }
    }
    const created = subjectService.createSubject({ tenantId }, body);
    success(res, created, 'Subject created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('subject.createSubject error:', err.message);
    error(res, 'Failed to create subject', 500);
  }
}

function updateSubject(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own subjects (load-first 404/403), and
    // may not move a subject to another center via the body.
    if (_centerId(req)) {
      const existing = subjectService.getSubject({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Subject not found', 404);
      if (!centerOwnership.centerOwnsSubject(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own subjects');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.centerId !== undefined && body.centerId !== null &&
          String(body.centerId).trim() !== '' && String(body.centerId).trim() !== _centerId(req)) {
        return _ownership403(res, 'Centers may not move subjects to another center');
      }
    }
    const updated = subjectService.updateSubject({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Subject not found', 404);
    success(res, updated, 'Subject updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('subject.updateSubject error:', err.message);
    error(res, 'Failed to update subject', 500);
  }
}

function archiveSubject(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = subjectService.getSubject({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Subject not found', 404);
      if (!centerOwnership.centerOwnsSubject(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own subjects');
      }
    }
    const archived = subjectService.archiveSubject({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Subject not found', 404);
    success(res, archived, 'Subject archived');
  } catch (err) {
    logger.error('subject.archiveSubject error:', err.message);
    error(res, 'Failed to archive subject', 500);
  }
}

module.exports = {
  listSubjects,
  getSubject,
  createSubject,
  updateSubject,
  archiveSubject
};
