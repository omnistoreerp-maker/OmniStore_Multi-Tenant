'use strict';

// course.controller — STU-5 Education Course records (Device 2).
//
// Mirrors the student/teacher/center/program controllers exactly: tenant
// identity is resolved EXCLUSIVELY through the canonical `trustedTenantId(req)`
// helper. It prefers the reconstructed `req.tenantContext` and falls back to
// the server-signed token claim, and it NEVER reads query, body, or any
// request header. There is no second tenant resolver here.
//
// HTTP mapping: 400 validation / missing tenant / unresolvable Program
// reference, 404 not found or cross-tenant, 409 duplicate courseCode, 500
// unexpected only. Stack traces, tenant identifiers, storage details and
// secrets are never returned.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const courseService = require('../services/course.service');
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
// query/body value). A Course carries no center of its own: it resolves
// through its required Program (Course -> Program.centerId). Unlinked callers
// (operators) are unchanged.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function listCourses(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Only the declared filters are honoured; any other query key is ignored.
    const filters = {
      status: req.query ? req.query.status : undefined,
      programId: req.query ? req.query.programId : undefined,
      search: req.query ? req.query.search : undefined
    };
    let rows = courseService.listCourses({ tenantId }, filters);
    // A LINKED center lists only the courses of its own programs. The
    // post-filter composes with any other actor narrowing.
    if (_centerId(req)) {
      const allowed = centerOwnership.centerCourseIds(tenantId, _centerId(req));
      rows = rows.filter((c) => c && allowed.has(String(c.id)));
    }
    success(res, rows, 'Courses retrieved');
  } catch (err) {
    logger.error('course.listCourses error:', err.message);
    error(res, 'Failed to retrieve courses', 500);
  }
}

function getCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = courseService.getCourse({ tenantId }, req.params.id);
    // A record owned by another tenant is reported as absent, never as
    // forbidden, so existence is not leaked across tenants.
    if (!found) return error(res, 'Course not found', 404);
    // Same-tenant course of another center's program: refused as forbidden.
    if (_centerId(req) && !centerOwnership.centerOwnsCourse(tenantId, found.id, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own courses');
    }
    success(res, found, 'Course retrieved');
  } catch (err) {
    logger.error('course.getCourse error:', err.message);
    error(res, 'Failed to retrieve course', 500);
  }
}

function createCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // The body is passed through untouched; the service whitelists writable
    // fields, rejects server-owned fields, resolves the required Program
    // reference inside the trusted tenant and stamps the trusted tenantId.
    //
    // A LINKED center creates only UNDER its own programs: a programId that
    // resolves to a known other-center program is refused here with 403,
    // while an unresolvable programId falls through to the service's 400 so
    // this check never becomes an existence oracle.
    if (_centerId(req) && req.body && req.body.programId !== undefined &&
        req.body.programId !== null && String(req.body.programId).trim() !== '') {
      const target = programService.getProgram({ tenantId }, req.body.programId);
      if (target && centerOwnership.programCenterId(tenantId, target.id) !== _centerId(req)) {
        return _ownership403(res, 'Centers may only create courses under their own programs');
      }
    }
    const created = courseService.createCourse({ tenantId }, req.body || {});
    success(res, created, 'Course created', 201);
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('course.createCourse error:', err.message);
    error(res, 'Failed to create course', 500);
  }
}

function updateCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // A LINKED center edits only its own courses (load-first 404/403), and
    // may not move a course under another center's program via the body.
    if (_centerId(req)) {
      const existing = courseService.getCourse({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Course not found', 404);
      if (!centerOwnership.centerOwnsCourse(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only edit their own courses');
      }
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      if (body.programId !== undefined && body.programId !== null && String(body.programId).trim() !== '') {
        const target = programService.getProgram({ tenantId }, body.programId);
        if (target && centerOwnership.programCenterId(tenantId, target.id) !== _centerId(req)) {
          return _ownership403(res, 'Centers may not move courses to another center');
        }
      }
    }
    const updated = courseService.updateCourse({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Course not found', 404);
    success(res, updated, 'Course updated');
  } catch (err) {
    if (err && err.conflict === true) {
      return error(res, err.message, 409, { code: err.code });
    }
    if (err && Array.isArray(err.validation)) {
      return error(res, err.message, 400, { details: err.validation });
    }
    logger.error('course.updateCourse error:', err.message);
    error(res, 'Failed to update course', 500);
  }
}

function archiveCourse(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    // Same load-first 404/403 ordering as the update path.
    if (_centerId(req)) {
      const existing = courseService.getCourse({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Course not found', 404);
      if (!centerOwnership.centerOwnsCourse(tenantId, existing.id, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own courses');
      }
    }
    const archived = courseService.archiveCourse({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Course not found', 404);
    success(res, archived, 'Course archived');
  } catch (err) {
    logger.error('course.archiveCourse error:', err.message);
    error(res, 'Failed to archive course', 500);
  }
}

module.exports = { listCourses, getCourse, createCourse, updateCourse, archiveCourse };