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
//
// TEACHER OWNERSHIP - a session stores only `classId`; the owning teacher is
// resolved THROUGH the Class. When `req.teacherActor` is set (linked account):
//   - listScheduling is force-scoped to that teacher's classes (the query
//     `teacherId` is overridden, never trusted);
//   - getSession / updateSession refuse a session of another teacher's class
//     with 403 OWNERSHIP_DENIED (404 still wins across tenants — existence is
//     never leaked);
//   - createSession may only schedule INTO one of the linked teacher's own
//     classes; an unknown classId still falls through to the service's 400
//     (no existence oracle), a known foreign class is 403.
// Unlinked callers (Owner/Admin/Manager role gate, operators) are unchanged.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const schedulingService = require('../services/scheduling.service');
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

function _ownership403(res, message) {
  error(res, message, 403, { code: 'OWNERSHIP_DENIED' });
}

// CENTER OWNERSHIP — the server-resolved `req.centerActor.id` (never a
// query/body value). A session stores only `classId`, so the owning center
// resolves THROUGH the Class (Session -> Class -> Course -> Program.centerId).
// A linked center sees only its own timetable. Unlinked callers (operators)
// are unchanged, and any teacher narrowing composes by intersection.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

// Resolves the Class that owns a session for the ownership checks. Returns the
// Class row, or null when the classId does not resolve inside the tenant (the
// caller then falls through to the service's own 400/404 handling — no
// existence oracle is opened here).
function _classOfSession(tenantId, session) {
  if (!session || !session.classId) return null;
  return classService.getClass({ tenantId }, session.classId);
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
    // A LINKED teacher's timetable is force-scoped through their own classes:
    // the query `teacherId` is overridden by the linked record, never trusted.
    if (req.teacherActor) filters.teacherId = String(req.teacherActor.id);
    let rows = schedulingService.listScheduling({ tenantId }, filters);
    // A LINKED center's timetable is narrowed to its own classes. The
    // post-filter composes with the teacher override above (intersection).
    if (_centerId(req)) {
      const allowed = centerOwnership.centerClassIds(tenantId, _centerId(req));
      rows = rows.filter((s) => s && allowed.has(String(s.classId || '')));
    }
    success(res, rows, 'Scheduling retrieved');
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
    // Same-tenant session of ANOTHER teacher's class: forbidden.
    if (req.teacherActor) {
      const owner = _classOfSession(tenantId, found);
      if (owner && String(owner.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only access sessions of their own classes');
      }
    }
    // Same-tenant session of another center: forbidden — a linked center only
    // ever reads its own timetable.
    if (_centerId(req) && !centerOwnership.centerOwnsSession(tenantId, found.classId, _centerId(req))) {
      return _ownership403(res, 'Centers may only access sessions of their own center');
    }
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
    //
    // A LINKED teacher schedules only INTO their own classes: a classId that
    // resolves to a known foreign class is refused here with 403, while an
    // unresolvable classId falls through to the service's 400 so this check
    // never becomes an existence oracle.
    if (req.teacherActor && req.body && req.body.classId) {
      const target = classService.getClass({ tenantId }, req.body.classId);
      if (target && String(target.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only schedule sessions for their own classes');
      }
    }
    // A LINKED center schedules only INTO its own center: a classId that
    // resolves to a known other-center class is refused here with 403, while
    // an unresolvable classId falls through to the service's 400 so this
    // check never becomes an existence oracle.
    if (_centerId(req) && req.body && req.body.classId !== undefined &&
        req.body.classId !== null && String(req.body.classId).trim() !== '') {
      const target = classService.getClass({ tenantId }, req.body.classId);
      if (target && centerOwnership.classCenterId(tenantId, target.id) !== _centerId(req)) {
        return _ownership403(res, 'Centers may only schedule sessions for their own center');
      }
    }
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
    //
    // A LINKED teacher corrects only sessions of their own classes: the row is
    // loaded first so a foreign same-tenant session is refused BEFORE the
    // update runs (404 across tenants still wins — no existence leak).
    if (req.teacherActor) {
      const existing = schedulingService.getSession({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Scheduling session not found', 404);
      const owner = _classOfSession(tenantId, existing);
      if (owner && String(owner.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only correct sessions of their own classes');
      }
    }
    // A LINKED center corrects only sessions of its own center: the row is
    // loaded first so a foreign same-tenant session is refused BEFORE the
    // update runs (404 across tenants still wins — no existence leak).
    if (_centerId(req)) {
      const existing = schedulingService.getSession({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Scheduling session not found', 404);
      if (!centerOwnership.centerOwnsSession(tenantId, existing.classId, _centerId(req))) {
        return _ownership403(res, 'Centers may only correct sessions of their own center');
      }
    }
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