'use strict';

// rating.controller — Education Ratings (P2 Teacher portal).
//
// Tenant identity is resolved EXCLUSIVELY through the canonical
// `trustedTenantId(req)` helper; a missing trusted tenant is a hard 400, never
// a default and never a fallback. There is no second tenant resolver here.
//
// OWNERSHIP — `req.teacherActor` is the teacher record linked to the
// signed-in account (attached for every education request by
// middleware/teacherActor). A teacher actor may READ ratings ABOUT THEMSELVES
// and nothing else:
//   - the list filter is force-set to their own id regardless of query;
//   - every other teacher's row answers 403 OWNERSHIP_DENIED;
//   - create, edit and archive are refused outright: entering or withdrawing
//     feedback is an operator action, so holding `education.ratings.edit`
//     never widens a linked teacher past read-only on their own rows.
// An operator (no linked teacher) manages everything through the permission
// gate alone, exactly like every other Education surface.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or
// cross-tenant, 403 ownership refusal, 500 unexpected only. Stack traces and
// internal messages are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const ratingService = require('../services/rating.service');
const classService = require('../services/class.service');
const teacherService = require('../services/teacher.service');
const studentService = require('../services/student.service');
const centerOwnership = require('../middleware/centerOwnership');
const logger = require('../utils/logger');

// Declared query filters, honoured verbatim; any other query key is ignored.
const LIST_FILTERS = ['teacherId', 'studentId', 'classId', 'score', 'status', 'scheduledDate', 'dateFrom', 'dateTo'];

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
// query/body value). A rating touches the centers of the rated teacher's
// classes, intersected with the classId chain when a classId is stored. A
// linked center sees only its own ratings. Unlinked callers (operators) are
// unchanged, and any teacher narrowing composes by intersection.
function _centerId(req) {
  return req && req.centerActor && req.centerActor.id ? String(req.centerActor.id) : '';
}

function _present(v) {
  return v !== undefined && v !== null && String(v).trim() !== '';
}

// Validates the effective refs of a rating write for a linked center: every
// SUPPLIED ref that resolves must resolve inside the actor's center. Unknown
// refs fall through to the service's own 400 (no oracle). Returns an error
// message when refused, or null when the refs raise no center objection.
function _ratingRefsCenterError(tenantId, centerId, refs) {
  const r = (refs && typeof refs === 'object') ? refs : {};
  if (_present(r.classId)) {
    const cls = classService.getClass({ tenantId }, r.classId);
    if (cls && centerOwnership.classCenterId(tenantId, cls.id) !== centerId) {
      return 'Centers may only rate classes of their own center';
    }
  }
  if (_present(r.teacherId)) {
    const teacher = teacherService.getTeacher({ tenantId }, r.teacherId);
    if (teacher && !centerOwnership.teacherTeachesInCenter(tenantId, teacher.id, centerId)) {
      return 'Centers may only rate teachers of their own center';
    }
  }
  if (_present(r.studentId)) {
    const student = studentService.getStudent({ tenantId }, r.studentId);
    if (student && !centerOwnership.centerStudentIds(tenantId, centerId).has(String(student.id))) {
      return 'Centers may only rate students of their own center';
    }
  }
  return null;
}

// Maps the service's validation errors to the HTTP contract (400 with a
// details list). Returns true when the error was handled.
function _mapError(res, err) {
  if (err && Array.isArray(err.validation)) {
    error(res, err.message, 400, { details: err.validation });
    return true;
  }
  return false;
}

function listRatings(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const filters = {};
    for (const key of LIST_FILTERS) {
      if (req.query && req.query[key] !== undefined) filters[key] = req.query[key];
    }
    // Server-authoritative scoping: a teacher actor's list is ALWAYS their
    // own, whatever the query asked for.
    if (req.teacherActor) filters.teacherId = String(req.teacherActor.id);
    let rows = ratingService.listRatings({ tenantId }, filters);
    // A LINKED center's list is narrowed to its own ratings. The post-filter
    // composes with the teacher override above (intersection).
    if (_centerId(req)) {
      const filter = centerOwnership.centerRatingFilter(tenantId, _centerId(req));
      rows = rows.filter((r) => centerOwnership.ratingRowInCenter(r, filter));
    }
    success(res, rows, 'Ratings retrieved');
  } catch (err) {
    logger.error('rating.listRatings error:', err.message);
    error(res, 'Failed to retrieve ratings', 500);
  }
}

function getRating(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = ratingService.getRating({ tenantId }, req.params.id);
    if (!found) return error(res, 'Rating not found', 404);
    if (req.teacherActor && String(found.teacherId) !== String(req.teacherActor.id)) {
      return _ownership403(res, 'Teachers may only access their own ratings');
    }
    // Same-tenant rating of another center: refused as forbidden.
    if (_centerId(req) && !centerOwnership.centerOwnsRating(tenantId, found, _centerId(req))) {
      return _ownership403(res, 'Centers may only access their own ratings');
    }
    success(res, found, 'Rating retrieved');
  } catch (err) {
    logger.error('rating.getRating error:', err.message);
    error(res, 'Failed to retrieve rating', 500);
  }
}

function createRating(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (req.teacherActor) {
      return _ownership403(res, 'Teachers may not enter ratings; entering feedback is an operator action');
    }
    // A LINKED center rates only inside its own center (unknown refs fall
    // through to the service's own 400 — no oracle).
    if (_centerId(req)) {
      const refused = _ratingRefsCenterError(tenantId, _centerId(req), req.body || {});
      if (refused) return _ownership403(res, refused);
    }
    const created = ratingService.createRating({ tenantId }, req.body || {});
    success(res, created, 'Rating created', 201);
  } catch (err) {
    if (_mapError(res, err)) return;
    logger.error('rating.createRating error:', err.message);
    error(res, 'Failed to create rating', 500);
  }
}

function updateRating(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (req.teacherActor) {
      return _ownership403(res, 'Teachers may not edit ratings; editing feedback is an operator action');
    }
    // A LINKED center edits only its own ratings: the row is loaded first
    // (404 still wins), then the EFFECTIVE refs (stored row overlaid with any
    // supplied body refs) must all resolve in-center.
    if (_centerId(req)) {
      const existing = ratingService.getRating({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Rating not found', 404);
      const body = (req.body && typeof req.body === 'object') ? req.body : {};
      const effective = {
        teacherId: _present(body.teacherId) ? body.teacherId : existing.teacherId,
        studentId: _present(body.studentId) ? body.studentId : existing.studentId,
        classId: _present(body.classId) ? body.classId : existing.classId
      };
      const refused = _ratingRefsCenterError(tenantId, _centerId(req), effective);
      if (refused) return _ownership403(res, refused);
    }
    const updated = ratingService.updateRating({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Rating not found', 404);
    success(res, updated, 'Rating updated');
  } catch (err) {
    if (_mapError(res, err)) return;
    logger.error('rating.updateRating error:', err.message);
    error(res, 'Failed to update rating', 500);
  }
}

function archiveRating(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (req.teacherActor) {
      return _ownership403(res, 'Teachers may not archive ratings; withdrawing feedback is an operator action');
    }
    // A LINKED center archives only its own ratings (load-first 404/403).
    if (_centerId(req)) {
      const existing = ratingService.getRating({ tenantId }, req.params.id);
      if (!existing) return error(res, 'Rating not found', 404);
      if (!centerOwnership.centerOwnsRating(tenantId, existing, _centerId(req))) {
        return _ownership403(res, 'Centers may only archive their own ratings');
      }
    }
    const archived = ratingService.archiveRating({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Rating not found', 404);
    success(res, archived, 'Rating archived');
  } catch (err) {
    logger.error('rating.archiveRating error:', err.message);
    error(res, 'Failed to archive rating', 500);
  }
}

module.exports = { listRatings, getRating, createRating, updateRating, archiveRating };
