'use strict';

// guardian.controller — Phase 0 Parent / Guardian records (Education V2).
//
// Mirrors teacher.controller exactly: tenant identity is resolved EXCLUSIVELY
// through the canonical `trustedTenantId(req)` helper. It never reads query,
// body, or any request header, and there is no second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.
//
// HTTP mapping: 400 validation / missing tenant, 401 unauthenticated,
// 403 OWNERSHIP_DENIED / PERMISSION_DENIED, 404 not found or cross-tenant,
// 409 duplicate guardianCode or link conflict, 500 unexpected only. Stack
// traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const guardianService = require('../services/guardian.service');
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

// OWNERSHIP. When the signed-in account is LINKED to a guardian
// (`req.guardianActor`, attached for every education request), every other
// guardian's id is refused with 403 OWNERSHIP_DENIED — checked against the
// PATH alone, before any lookup, so the answer never depends on whether the
// other record exists. Holding `education.guardians.edit` never widens a linked
// parent past their own row.
function _refuseOtherGuardian(req, res, id) {
  if (req.guardianActor && String(req.guardianActor.id) !== String(id)) {
    error(res, 'Guardians may only access their own record', 403, { code: 'OWNERSHIP_DENIED' });
    return true;
  }
  return false;
}

// A linked parent may only ever read the students on their OWN child list.
// Checked against the stored relationship before any lookup, so it cannot be
// satisfied by guessing an id that belongs to somebody else's child.
function _refuseForeignChild(req, res, studentId) {
  if (!req.guardianActor) return false;
  const mine = Array.isArray(req.guardianActor.childStudentIds)
    ? req.guardianActor.childStudentIds.map(String)
    : [];
  if (mine.indexOf(String(studentId)) === -1) {
    error(res, 'Guardians may only access their own children', 403, { code: 'OWNERSHIP_DENIED' });
    return true;
  }
  return false;
}

function listGuardians(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      relation: req.query ? req.query.relation : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = guardianService.listGuardians({ tenantId }, filters);
    // A linked parent's directory is themselves, whatever the query asked.
    if (req.guardianActor) {
      const own = String(req.guardianActor.id);
      rows = rows.filter(g => String(g.id) === own);
    }
    success(res, rows, 'Guardians retrieved');
  } catch (err) {
    logger.error('guardian.listGuardians error:', err.message);
    error(res, 'Failed to retrieve guardians', 500);
  }
}

function getGuardian(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherGuardian(req, res, req.params.id)) return;
    const found = guardianService.getGuardian({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Guardian not found', 404);
    success(res, found, 'Guardian retrieved');
  } catch (err) {
    logger.error('guardian.getGuardian error:', err.message);
    error(res, 'Failed to retrieve guardian', 500);
  }
}

function createGuardian(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = guardianService.createGuardian({ tenantId }, req.body || {});
    success(res, created, 'Guardian created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('guardian.createGuardian error:', err.message);
    error(res, 'Failed to create guardian', 500);
  }
}

function updateGuardian(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherGuardian(req, res, req.params.id)) return;
    const updated = guardianService.updateGuardian({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Guardian not found', 404);
    success(res, updated, 'Guardian updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('guardian.updateGuardian error:', err.message);
    error(res, 'Failed to update guardian', 500);
  }
}

function archiveGuardian(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherGuardian(req, res, req.params.id)) return;
    const archived = guardianService.archiveGuardian({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Guardian not found', 404);
    success(res, archived, 'Guardian archived');
  } catch (err) {
    logger.error('guardian.archiveGuardian error:', err.message);
    error(res, 'Failed to archive guardian', 500);
  }
}

// GET /guardians/me — the Parent portal's identity endpoint.
// Authorization here is NOT a permission grant: the LINK is the check. An
// authenticated account can only ever read the record linked to ITS OWN id,
// so there is nothing to delegate. Anonymous is 401; authenticated-but-unlinked
// is 404 GUARDIAN_NOT_LINKED (a distinct, honest answer the portal uses to
// offer the operator sign-in path instead of pretending to be a parent).
function getMe(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const actor = req.guardianActor ||
      guardianService.getGuardianByUserId({ tenantId }, req.user.id);
    if (!actor) {
      return error(res, 'No guardian is linked to this account', 404, { code: 'GUARDIAN_NOT_LINKED' });
    }
    success(res, actor, 'Guardian retrieved');
  } catch (err) {
    logger.error('guardian.getMe error:', err.message);
    error(res, 'Failed to resolve the linked guardian', 500);
  }
}

// GET /guardians/me/children — the students this account's linked guardian may
// read. The list comes from the server-owned relationship and is re-resolved
// inside the trusted tenant, so it can never contain a row from another tenant
// or a child that is not on the guardian's own list.
function getMyChildren(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const actor = req.guardianActor ||
      guardianService.getGuardianByUserId({ tenantId }, req.user.id);
    if (!actor) {
      return error(res, 'No guardian is linked to this account', 404, { code: 'GUARDIAN_NOT_LINKED' });
    }
    const children = guardianService.getGuardianChildren({ tenantId }, actor.id) || [];
    success(res, children, 'Children retrieved');
  } catch (err) {
    logger.error('guardian.getMyChildren error:', err.message);
    error(res, 'Failed to resolve children', 500);
  }
}

// GET /guardians/:id/children — operator view of one guardian's children, with
// the same own-row rule: a linked parent is refused any id but their own.
function getGuardianChildren(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherGuardian(req, res, req.params.id)) return;
    const children = guardianService.getGuardianChildren({ tenantId }, req.params.id);
    if (children === null) return error(res, 'Guardian not found', 404);
    success(res, children, 'Children retrieved');
  } catch (err) {
    logger.error('guardian.getGuardianChildren error:', err.message);
    error(res, 'Failed to resolve children', 500);
  }
}

// POST /guardians/:id/link-user — Owner/Admin only (enforced by requireRole on
// the route, which resolves the TENANT role, not a client-supplied one).
function linkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const linked = guardianService.linkUser({ tenantId }, req.params.id, body.userId);
    if (!linked) return error(res, 'Guardian not found', 404);
    success(res, linked, 'Account linked to guardian');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('guardian.linkUser error:', err.message);
    error(res, 'Failed to link account', 500);
  }
}

// DELETE /guardians/:id/link-user — Owner/Admin only, idempotent.
function unlinkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const unlinked = guardianService.unlinkUser({ tenantId }, req.params.id);
    if (!unlinked) return error(res, 'Guardian not found', 404);
    success(res, unlinked, 'Account unlinked from guardian');
  } catch (err) {
    logger.error('guardian.unlinkUser error:', err.message);
    error(res, 'Failed to unlink account', 500);
  }
}

// POST /guardians/:id/children — Owner/Admin only. Granting a parent access to
// a child IS granting a portal identity, so it carries the same role gate as
// link-user. The service resolves the student inside the trusted tenant.
function linkChild(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const linked = guardianService.linkChild({ tenantId }, req.params.id, body.studentId);
    if (!linked) return error(res, 'Guardian not found', 404);
    success(res, linked, 'Child linked to guardian');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('guardian.linkChild error:', err.message);
    error(res, 'Failed to link child', 500);
  }
}

// DELETE /guardians/:id/children/:studentId — Owner/Admin only, idempotent.
function unlinkChild(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const unlinked = guardianService.unlinkChild({ tenantId }, req.params.id, req.params.studentId);
    if (!unlinked) return error(res, 'Guardian not found', 404);
    success(res, unlinked, 'Child unlinked from guardian');
  } catch (err) {
    logger.error('guardian.unlinkChild error:', err.message);
    error(res, 'Failed to unlink child', 500);
  }
}

// Exported for the controller-level tests so the own-row rules can be asserted
// directly against a request/response pair.
module.exports = {
  listGuardians, getGuardian, createGuardian, updateGuardian, archiveGuardian,
  getMe, getMyChildren, getGuardianChildren,
  linkUser, unlinkUser, linkChild, unlinkChild,
  _refuseOtherGuardian, _refuseForeignChild
};