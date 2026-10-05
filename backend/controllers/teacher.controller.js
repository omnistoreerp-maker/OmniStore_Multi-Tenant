'use strict';

// teacher.controller — STU-3 Teacher records (Device 2).
//
// Mirrors student.controller exactly: tenant identity is resolved EXCLUSIVELY
// through the canonical `trustedTenantId(req)` helper from the authorization
// middleware. It prefers the reconstructed `req.tenantContext` and falls back
// to the server-signed token claim, and it NEVER reads query, body, or any
// request header. There is no second tenant resolver here.
//
// A missing trusted tenant is a hard 400 "Tenant context required", never a
// default tenant and never a fallback.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or cross-tenant,
// 409 duplicate teacherCode inside the tenant, 500 unexpected only. Stack
// traces and internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId, resolveTenantRoleForRequest } = require('../middleware/authorize');
const teacherService = require('../services/teacher.service');
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

// OWNERSHIP. When the signed-in account is LINKED to a teacher
// (`req.teacherActor`, attached for every education request), every other
// teacher's id is refused with 403 OWNERSHIP_DENIED — checked against the PATH
// alone, before any lookup, so the answer never depends on whether the other
// record exists. Holding `education.teachers.edit` never widens a linked
// teacher past their own row.
function _refuseOtherTeacher(req, res, id) {
  if (req.teacherActor && String(req.teacherActor.id) !== String(id)) {
    error(res, 'Teachers may only access their own record', 403, { code: 'OWNERSHIP_DENIED' });
    return true;
  }
  return false;
}

// CENTER OWNERSHIP — the server-resolved `req.centerActor.id` (never a
// query/body value). A linked center sees only teachers who teach at least
// one of its own classes. Unlinked callers (operators) are unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _refuseForeignCenterTeacher(req, res, tenantId, id) {
  if (_centerId(req) && !centerOwnership.centerOwnsTeacher(tenantId, id, _centerId(req))) {
    error(res, 'Centers may only access their own teachers', 403, { code: 'OWNERSHIP_DENIED' });
    return true;
  }
  return false;
}

function listTeachers(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      employmentType: req.query ? req.query.employmentType : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = teacherService.listTeachers({ tenantId }, filters);
    // A linked teacher's directory is themselves, whatever the query asked.
    if (req.teacherActor) {
      const own = String(req.teacherActor.id);
      rows = rows.filter(t => String(t.id) === own);
    }
    // A linked center's directory is the teachers of its own classes. Both
    // narrowings compose (intersection) when both actors are present.
    if (_centerId(req)) {
      rows = centerOwnership.filterTeachersByCenter(
        rows, centerOwnership.centerTeacherIds(tenantId, _centerId(req)));
    }
    success(res, rows, 'Teachers retrieved');
  } catch (err) {
    logger.error('teacher.listTeachers error:', err.message);
    error(res, 'Failed to retrieve teachers', 500);
  }
}

function getTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherTeacher(req, res, req.params.id)) return;
    const found = teacherService.getTeacher({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Teacher not found', 404);
    // Same-tenant teacher with no class in the linked center: refused as
    // forbidden — a linked center only ever reads its own teachers.
    if (_refuseForeignCenterTeacher(req, res, tenantId, found.id)) return;
    success(res, found, 'Teacher retrieved');
  } catch (err) {
    logger.error('teacher.getTeacher error:', err.message);
    error(res, 'Failed to retrieve teacher', 500);
  }
}

function createTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields and stamps the trusted tenantId.
    const created = teacherService.createTeacher({ tenantId }, req.body || {});
    success(res, created, 'Teacher created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('teacher.createTeacher error:', err.message);
    error(res, 'Failed to create teacher', 500);
  }
}

function updateTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherTeacher(req, res, req.params.id)) return;
    // A LINKED center edits only teachers of its own center: the row is
    // loaded first so a foreign same-tenant Teacher is refused BEFORE the
    // update runs (404 across tenants still wins — no existence leak).
    if (_centerId(req)) {
      const existing = teacherService.getTeacher({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Teacher not found', 404);
      if (_refuseForeignCenterTeacher(req, res, tenantId, existing.id)) return;
    }
    const updated = teacherService.updateTeacher({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Teacher not found', 404);
    success(res, updated, 'Teacher updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('teacher.updateTeacher error:', err.message);
    error(res, 'Failed to update teacher', 500);
  }
}

function archiveTeacher(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (_refuseOtherTeacher(req, res, req.params.id)) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = teacherService.getTeacher({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Teacher not found', 404);
      if (_refuseForeignCenterTeacher(req, res, tenantId, existing.id)) return;
    }
    const archived = teacherService.archiveTeacher({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Teacher not found', 404);
    success(res, archived, 'Teacher archived');
  } catch (err) {
    logger.error('teacher.archiveTeacher error:', err.message);
    error(res, 'Failed to archive teacher', 500);
  }
}

// GET /teachers/me — the portal's identity endpoint. Authorization here is
// NOT a permission grant: the LINK is the check. An authenticated account can
// only ever read the record linked to ITS OWN id, so there is nothing to
// delegate. Anonymous is 401; authenticated-but-unlinked is 404
// TEACHER_NOT_LINKED (a distinct, honest answer the portal uses to fall back
// to the operator view).
function getMe(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const actor = req.teacherActor ||
      teacherService.getTeacherByUserId({ tenantId }, req.user.id);
    if (!actor) {
      return error(res, 'No teacher is linked to this account', 404, { code: 'TEACHER_NOT_LINKED' });
    }
    success(res, actor, 'Teacher retrieved');
  } catch (err) {
    logger.error('teacher.getMe error:', err.message);
    error(res, 'Failed to resolve the linked teacher', 500);
  }
}

// POST /teachers/:id/link-user — Owner/Admin only (enforced by requireRole on
// the route, which resolves the TENANT role, not a client-supplied one).
function linkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    const linked = teacherService.linkUser({ tenantId }, req.params.id, body.userId);
    if (!linked) return error(res, 'Teacher not found', 404);
    success(res, linked, 'Account linked to teacher');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('teacher.linkUser error:', err.message);
    error(res, 'Failed to link account', 500);
  }
}

// DELETE /teachers/:id/link-user — Owner/Admin only, idempotent.
function unlinkUser(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const unlinked = teacherService.unlinkUser({ tenantId }, req.params.id);
    if (!unlinked) return error(res, 'Teacher not found', 404);
    success(res, unlinked, 'Account unlinked from teacher');
  } catch (err) {
    logger.error('teacher.unlinkUser error:', err.message);
    error(res, 'Failed to unlink account', 500);
  }
}

module.exports = {
  listTeachers, getTeacher, createTeacher, updateTeacher, archiveTeacher,
  getMe, linkUser, unlinkUser
};