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
    success(res, ratingService.listRatings({ tenantId }, filters), 'Ratings retrieved');
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
    const archived = ratingService.archiveRating({ tenantId }, req.params.id);
    if (!archived) return error(res, 'Rating not found', 404);
    success(res, archived, 'Rating archived');
  } catch (err) {
    logger.error('rating.archiveRating error:', err.message);
    error(res, 'Failed to archive rating', 500);
  }
}

module.exports = { listRatings, getRating, createRating, updateRating, archiveRating };
