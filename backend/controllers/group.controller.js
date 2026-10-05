'use strict';

// group.controller — P1 Academic Foundation: Class Group records.
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
// cross-tenant, 409 duplicate groupCode inside the tenant, 500 unexpected
// only. Stack traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const groupService = require('../services/group.service');
const classService = require('../services/class.service');
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
// query/body value). A Group carries no center of its own: it resolves
// through its required Class (Group -> Class -> Course -> Program.centerId).
// A linked center sees only its own groups. Unlinked callers (operators) are
// unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listGroups(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      classId: req.query ? req.query.classId : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = groupService.listGroups({ tenantId }, filters);
    // A LINKED center lists only the groups of its own classes. The
    // post-filter composes with any other actor narrowing.
    if (_centerId(req)) {
      const allowed = centerOwnership.centerGroupIds(tenantId, _centerId(req));
      rows = rows.filter((g) => g && allowed.has(String(g.id)));
    }
    success(res, rows, 'Groups retrieved');
  } catch (err) {
    logger.error('group.listGroups error:', err.message);
    error(res, 'Failed to retrieve groups', 500);
  }
}

function getGroup(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = groupService.getGroup({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Group not found', 404);
    // Same-tenant group of another center: refused as forbidden.
    if (_centerId(req) && !centerOwnership.centerOwnsGroup(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own groups');
    }
    success(res, found, 'Group retrieved');
  } catch (err) {
    logger.error('group.getGroup error:', err.message);
    error(res, 'Failed to retrieve group', 500);
  }
}

function createGroup(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the REQUIRED Class
    // reference inside the trusted tenant and stamps the trusted tenantId.
    //
    // A LINKED center creates only UNDER its own classes: a classId that
    // resolves to a known other-center class is refused here with 403, while
    // an unresolvable classId falls through to the service's 400 so this
    // check never becomes an existence oracle.
    if (_centerId(req) && req.body && req.body.classId !== undefined &&
        req.body.classId !== null && String(req.body.classId).trim() !== '') {
      const cls = classService.getClass({ tenantId }, req.body.classId);
      if (cls && centerOwnership.classCenterId(tenantId, cls.id) !== _centerId(req)) {
        return _ownership403(res, 'Centers may only create groups under their own classes');
      }
    }
    const created = groupService.createGroup({ tenantId }, req.body || {});
    success(res, created, 'Group created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('group.createGroup error:', err.message);
    error(res, 'Failed to create group', 500);
  }
}

function updateGroup(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own groups (load-first 404/403). The
    // classId is immutable at the service layer, so no move check is needed
    // here: a body classId is refused with 400 before anything is stored.
    if (_centerId(req)) {
      const existing = groupService.getGroup({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Group not found', 404);
      if (!centerOwnership.centerOwnsGroup(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own groups');
      }
    }
    const updated = groupService.updateGroup({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Group not found', 404);
    success(res, updated, 'Group updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('group.updateGroup error:', err.message);
    error(res, 'Failed to update group', 500);
  }
}

function archiveGroup(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = groupService.getGroup({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Group not found', 404);
      if (!centerOwnership.centerOwnsGroup(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own groups');
      }
    }
    const archived = groupService.archiveGroup({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Group not found', 404);
    success(res, archived, 'Group archived');
  } catch (err) {
    logger.error('group.archiveGroup error:', err.message);
    error(res, 'Failed to archive group', 500);
  }
}

module.exports = {
  listGroups,
  getGroup,
  createGroup,
  updateGroup,
  archiveGroup
};
