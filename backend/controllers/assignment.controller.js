'use strict';

// assignment.controller — EDU-ASG Assignment records.
//
// Mirrors the enrollment/class controllers exactly: tenant identity is resolved
// EXCLUSIVELY through the canonical `trustedTenantId(req)` helper. It prefers
// the reconstructed `req.tenantContext` and falls back to the server-signed
// token claim, and it NEVER reads query, body, or any request header. There is
// no second tenant resolver here.
//
// An Assignment is owned by exactly one Class. Ownership of a row is therefore
// ownership of its Class, resolved through the same helpers the other
// controllers use — never from a client-supplied teacher, center or student id.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable Class / an
// attempt to change the immutable parent, 404 not found or cross-tenant,
// 403 OWNERSHIP_DENIED when a LINKED teacher/center/student touches a row
// outside their scope, 500 unexpected only. Stack traces, tenant identifiers,
// file paths and secrets are never returned.
//
// TEACHER OWNERSHIP — a linked teacher (req.teacherActor) reads and writes
// only assignments of their own classes. CENTER OWNERSHIP — a linked center
// (req.centerActor) sees only assignments whose class resolves into its own
// center. STUDENT SELF-SCOPE — a linked student (req.educationStudent) reads
// only assignments of classes they are enrolled in. Students never write:
// every write route keeps strict requirePermission plus the global role gate.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const assignmentService = require('../services/assignment.service');
const classService = require('../services/class.service');
const teacherOwnership = require('../middleware/teacherOwnership');
const centerOwnership = require('../middleware/centerOwnership');
const studentOwnership = require('../middleware/studentOwnership');
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

function _teacherId(req) {
  return req && req.teacherActor && req.teacherActor.id ? String(req.teacherActor.id) : '';
}

function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _studentId(req) {
  return req && req.educationStudent && req.educationStudent.id ? String(req.educationStudent.id) : '';
}

// The Class ids a linked teacher teaches. Empty set for unlinked callers so a
// missing link can never widen anything.
function _teacherClassIds(tenantId, req) {
  const teacherId = _teacherId(req);
  if (!teacherId) return new Set();
  return new Set(teacherOwnership.teacherClassIds(tenantId, teacherId));
}

// The Class ids a linked center owns. Empty set for unlinked callers.
function _centerClassIds(tenantId, req) {
  const centerId = _centerId(req);
  if (!centerId) return new Set();
  return centerOwnership.centerClassIds(tenantId, centerId);
}

// The Class ids a linked student is enrolled in. Empty set for unlinked
// callers.
function _studentClassIds(tenantId, req) {
  const studentId = _studentId(req);
  if (!studentId) return new Set();
  return studentOwnership.studentClassIds(tenantId, studentId);
}

function listAssignments(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      classId: req.query ? req.query.classId : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = assignmentService.listAssignments({ tenantId }, filters);
    // Every narrowing below composes by intersection: a query can narrow
    // within an actor scope, never widen past it.
    if (_teacherId(req)) {
      const allowed = _teacherClassIds(tenantId, req);
      rows = rows.filter((a) => a && allowed.has(String(a.classId || '')));
    }
    if (_centerId(req)) {
      const allowed = _centerClassIds(tenantId, req);
      rows = rows.filter((a) => a && allowed.has(String(a.classId || '')));
    }
    if (_studentId(req)) {
      const allowed = _studentClassIds(tenantId, req);
      rows = rows.filter((a) => a && allowed.has(String(a.classId || '')));
    }
    success(res, rows, 'Assignments retrieved');
  } catch (err) {
    logger.error('assignment.listAssignments error:', err.message);
    error(res, 'Failed to retrieve assignments', 500);
  }
}

function getAssignment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = assignmentService.getAssignment({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Assignment not found', 404);
    if (_teacherId(req) && !_teacherClassIds(tenantId, req).has(String(found.classId || ''))) {
      return _ownership403(res, 'Teachers may only view assignments of their own classes');
    }
    if (_centerId(req) && !_centerClassIds(tenantId, req).has(String(found.classId || ''))) {
      return _ownership403(res, 'Centers may only view assignments of their own center');
    }
    if (_studentId(req) && !_studentClassIds(tenantId, req).has(String(found.classId || ''))) {
      return _ownership403(res, 'Students may only view assignments of their own classes');
    }
    success(res, found, 'Assignment retrieved');
  } catch (err) {
    logger.error('assignment.getAssignment error:', err.message);
    error(res, 'Failed to retrieve assignment', 500);
  }
}

function createAssignment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned and immutable fields, resolves the Class
    // inside the trusted tenant, and stamps the trusted tenantId.
    //
    // A LINKED teacher creates only INTO their own classes: a classId that
    // resolves to a known foreign class is refused here with 403, while an
    // unresolvable classId falls through to the service's 400 so this check
    // never becomes an existence oracle.
    if (_teacherId(req) && req.body && req.body.classId !== undefined &&
        req.body.classId !== null && String(req.body.classId).trim() !== '') {
      const target = classService.getClass({ tenantId }, req.body.classId);
      if (target && !_teacherClassIds(tenantId, req).has(String(target.id))) {
        return _ownership403(res, 'Teachers may only create assignments in their own classes');
      }
    }
    // A LINKED center creates only INTO its own center, with the same
    // load-first 403/400 ordering.
    if (_centerId(req) && req.body && req.body.classId !== undefined &&
        req.body.classId !== null && String(req.body.classId).trim() !== '') {
      const target = classService.getClass({ tenantId }, req.body.classId);
      if (target && !_centerClassIds(tenantId, req).has(String(target.id))) {
        return _ownership403(res, 'Centers may only create assignments in their own center');
      }
    }
    const created = assignmentService.createAssignment({ tenantId }, req.body || {});
    success(res, created, 'Assignment created', 201);
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('assignment.createAssignment error:', err.message);
    error(res, 'Failed to create assignment', 500);
  }
}

function updateAssignment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED teacher edits only assignments of their own classes: the row
    // is loaded first so a foreign same-tenant row is refused BEFORE the
    // update runs (404 across tenants still wins).
    if (_teacherId(req)) {
      const existing = assignmentService.getAssignment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Assignment not found', 404);
      if (!_teacherClassIds(tenantId, req).has(String(existing.classId || ''))) {
        return _ownership403(res, 'Teachers may only edit assignments of their own classes');
      }
    }
    // A LINKED center edits only its own assignments (load-first 404/403).
    if (_centerId(req)) {
      const existing = assignmentService.getAssignment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Assignment not found', 404);
      if (!_centerClassIds(tenantId, req).has(String(existing.classId || ''))) {
        return _ownership403(res, 'Centers may only edit assignments of their own center');
      }
    }
    const updated = assignmentService.updateAssignment({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Assignment not found', 404);
    success(res, updated, 'Assignment updated');
  } catch (err) {
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('assignment.updateAssignment error:', err.message);
    error(res, 'Failed to update assignment', 500);
  }
}

function archiveAssignment(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_teacherId(req)) {
      const existing = assignmentService.getAssignment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Assignment not found', 404);
      if (!_teacherClassIds(tenantId, req).has(String(existing.classId || ''))) {
        return _ownership403(res, 'Teachers may only archive assignments of their own classes');
      }
    }
    if (_centerId(req)) {
      const existing = assignmentService.getAssignment({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Assignment not found', 404);
      if (!_centerClassIds(tenantId, req).has(String(existing.classId || ''))) {
        return _ownership403(res, 'Centers may only archive assignments of their own center');
      }
    }
    const archived = assignmentService.archiveAssignment({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Assignment not found', 404);
    success(res, archived, 'Assignment archived');
  } catch (err) {
    logger.error('assignment.archiveAssignment error:', err.message);
    error(res, 'Failed to archive assignment', 500);
  }
}

module.exports = {
  listAssignments,
  getAssignment,
  createAssignment,
  updateAssignment,
  archiveAssignment
};
