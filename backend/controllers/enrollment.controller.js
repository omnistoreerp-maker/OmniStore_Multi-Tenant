'use strict';

// enrollment.controller — STU-7 Education Enrollment records (Device 2).
//
// Mirrors the student/class/course controllers exactly: tenant identity is
// resolved EXCLUSIVELY through the canonical `trustedTenantId(req)` helper. It
// prefers the reconstructed `req.tenantContext` and falls back to the
// server-signed token claim, and it NEVER reads query, body, or any request
// header. There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable Student or Class
// reference / an attempt to change the immutable relationship, 404 not found or
// cross-tenant, 409 duplicate active enrollment, 403 OWNERSHIP_DENIED when a
// LINKED teacher touches an Enrollment of a Class they do not teach, 500
// unexpected only. Stack traces, tenant identifiers, storage details and
// secrets are never returned.
//
// TEACHER OWNERSHIP - an Enrollment stores only `classId`; the owning teacher
// is resolved THROUGH the Class. When `req.teacherActor` is set (linked
// account):
//   - listEnrollments is force-scoped to that teacher's classes (the query
//     `teacherId` is overridden, never trusted);
//   - getEnrollment / updateEnrollment / withdrawEnrollment refuse an
//     Enrollment of another teacher's class with 403 OWNERSHIP_DENIED (404
//     still wins across tenants — existence is never leaked);
//   - createEnrollment may only enroll INTO one of the linked teacher's own
//     classes; an unknown classId still falls through to the service's 400
//     (no existence oracle), a known foreign class is 403.
// Unlinked callers (Owner/Admin/Manager role gate, operators) are unchanged.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const enrollmentService = require('../services/enrollment.service');
const classService = require('../services/class.service');
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

function listEnrollments(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    // courseId / programId / teacherId are DERIVED filters resolved through the
    // Class by the service - they are never stored on an Enrollment. A LINKED
    // teacher's roster list is force-scoped: the query `teacherId` is
    // overridden by the linked record, never trusted.
    const filters = {
      studentId: req.query ? req.query.studentId : undefined,
      classId: req.query ? req.query.classId : undefined,
      status: req.query ? req.query.status : undefined,
      search: req.query ? req.query.search : undefined,
      courseId: req.query ? req.query.courseId : undefined,
      programId: req.query ? req.query.programId : undefined,
      teacherId: req.query ? req.query.teacherId : undefined
    };
    if (req.teacherActor) filters.teacherId = String(req.teacherActor.id);
    success(res, enrollmentService.listEnrollments({ tenantId }, filters), 'Enrollments retrieved');
  } catch (err) {
    logger.error('enrollment.listEnrollments error:', err.message);
    error(res, 'Failed to retrieve enrollments', 500);
  }
}

function getEnrollment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = enrollmentService.getEnrollment({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Enrollment not found', 404);
    // Same-tenant Enrollment of ANOTHER teacher's class: forbidden.
    if (req.teacherActor) {
      const owner = found.classId ? classService.getClass({ tenantId }, found.classId) : null;
      if (owner && String(owner.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only view enrollments of their own classes');
      }
    }
    success(res, found, 'Enrollment retrieved');
  } catch (err) {
    logger.error('enrollment.getEnrollment error:', err.message);
    error(res, 'Failed to retrieve enrollment', 500);
  }
}

function createEnrollment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned and later-phase fields, resolves the
    // required Student and Class references inside the trusted tenant, checks
    // active-pair uniqueness and stamps the trusted tenantId.
    //
    // A LINKED teacher enrolls only INTO their own classes: a classId that
    // resolves to a known foreign class is refused here with 403, while an
    // unresolvable classId falls through to the service's 400 so this check
    // never becomes an existence oracle.
    if (req.teacherActor && req.body && req.body.classId) {
      const target = classService.getClass({ tenantId }, req.body.classId);
      if (target && String(target.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only enroll students into their own classes');
      }
    }
    const created = enrollmentService.createEnrollment({ tenantId }, req.body || {});
    success(res, created, 'Enrollment created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('enrollment.createEnrollment error:', err.message);
    error(res, 'Failed to create enrollment', 500);
  }
}

function updateEnrollment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED teacher corrects only enrollments of their own classes: the
    // row is loaded first so a foreign same-tenant Enrollment is refused
    // BEFORE the update runs (404 across tenants still wins).
    if (req.teacherActor) {
      const existing = enrollmentService.getEnrollment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Enrollment not found', 404);
      const owner = existing.classId ? classService.getClass({ tenantId }, existing.classId) : null;
      if (owner && String(owner.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only edit enrollments of their own classes');
      }
    }
    const updated = enrollmentService.updateEnrollment({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Enrollment not found', 404);
    success(res, updated, 'Enrollment updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('enrollment.updateEnrollment error:', err.message);
    error(res, 'Failed to update enrollment', 500);
  }
}

function withdrawEnrollment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Withdrawal is a write on a row: a LINKED teacher withdraws only from
    // their own classes, with the same load-first 404/403 ordering as the
    // update path.
    if (req.teacherActor) {
      const existing = enrollmentService.getEnrollment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Enrollment not found', 404);
      const owner = existing.classId ? classService.getClass({ tenantId }, existing.classId) : null;
      if (owner && String(owner.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only withdraw enrollments of their own classes');
      }
    }
    const withdrawn = enrollmentService.withdrawEnrollment({ tenantId }, req.params.id);
    if (!withdrawn) return error(res, 'Enrollment not found', 404);
    success(res, withdrawn, 'Enrollment withdrawn');
  } catch (err) {
    logger.error('enrollment.withdrawEnrollment error:', err.message);
    error(res, 'Failed to withdraw enrollment', 500);
  }
}

module.exports = {
  listEnrollments,
  getEnrollment,
  createEnrollment,
  updateEnrollment,
  withdrawEnrollment
};
