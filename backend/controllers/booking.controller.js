'use strict';

// booking.controller — Education Bookings (P2 Teacher portal).
//
// Tenant identity is resolved EXCLUSIVELY through the canonical
// `trustedTenantId(req)` helper; a missing trusted tenant is a hard 400, never
// a default and never a fallback. There is no second tenant resolver here.
//
// OWNERSHIP — `req.teacherActor` is the teacher record linked to the
// signed-in account (attached by middleware/teacherActor for every education
// request). A teacher actor:
//   - always reads BOOKINGS FOR THEMSELVES: the list filter is force-set to
//     their own id regardless of any query parameter;
//   - may transition (confirm/cancel) their OWN bookings;
//   - is refused 403 OWNERSHIP_DENIED on anyone else's booking, on creating a
//     booking, and on editing a booking — creating and editing are operator
//     actions. None of these refusals depend on the account also holding
//     `education.bookings.edit`: holding edit never widens a teacher past
//     their own records.
// An operator (no linked teacher) manages everything through the permission
// gate alone, exactly like every other Education surface.
//
// HTTP mapping: 400 validation / missing tenant, 404 not found or
// cross-tenant, 409 booking conflict / illegal status transition, 403
// ownership refusal, 500 unexpected only. Stack traces and internal messages
// are never returned to the client.

const { success, error } = require('../utils/apiResponse');
const { trustedTenantId } = require('../middleware/authorize');
const bookingService = require('../services/booking.service');
const logger = require('../utils/logger');

// Declared query filters, honoured verbatim; any other query key is ignored.
const LIST_FILTERS = ['teacherId', 'studentId', 'classId', 'status', 'scheduledDate', 'dateFrom', 'dateTo'];

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

// Maps the service's typed errors to the HTTP contract. Returns true when the
// error was handled: 409 for an overlap or an illegal status edge, 400 for a
// validation or reference error.
function _mapError(res, err) {
  if (err && err.conflict === true && err.code === 'BOOKING_TRANSITION_INVALID') {
    error(res, err.message, 409, { code: err.code, details: { from: err.from, to: err.to } });
    return true;
  }
  if (err && err.conflict === true && err.code === 'BOOKING_CONFLICT') {
    error(res, err.message, 409, {
      code: err.code,
      details: { conflictKind: err.conflictKind, conflictingId: err.conflictingId, scheduledDate: err.scheduledDate }
    });
    return true;
  }
  if (err && Array.isArray(err.validation)) {
    error(res, err.message, 400, { details: err.validation });
    return true;
  }
  return false;
}

function listBookings(req, res) {
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
    success(res, bookingService.listBookings({ tenantId }, filters), 'Bookings retrieved');
  } catch (err) {
    logger.error('booking.listBookings error:', err.message);
    error(res, 'Failed to retrieve bookings', 500);
  }
}

function getBooking(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = bookingService.getBooking({ tenantId }, req.params.id);
    if (!found) return error(res, 'Booking not found', 404);
    if (req.teacherActor && String(found.teacherId) !== String(req.teacherActor.id)) {
      return _ownership403(res, 'Teachers may only access their own bookings');
    }
    success(res, found, 'Booking retrieved');
  } catch (err) {
    logger.error('booking.getBooking error:', err.message);
    error(res, 'Failed to retrieve booking', 500);
  }
}

function createBooking(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (req.teacherActor) {
      return _ownership403(res, 'Teachers may not create bookings; creating is an operator action');
    }
    const created = bookingService.createBooking({ tenantId }, req.body || {});
    success(res, created, 'Booking created', 201);
  } catch (err) {
    if (_mapError(res, err)) return;
    logger.error('booking.createBooking error:', err.message);
    error(res, 'Failed to create booking', 500);
  }
}

function updateBooking(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    if (req.teacherActor) {
      return _ownership403(res, 'Teachers may not edit bookings; editing is an operator action');
    }
    const updated = bookingService.updateBooking({ tenantId }, req.params.id, req.body || {});
    if (!updated) return error(res, 'Booking not found', 404);
    success(res, updated, 'Booking updated');
  } catch (err) {
    if (_mapError(res, err)) return;
    logger.error('booking.updateBooking error:', err.message);
    error(res, 'Failed to update booking', 500);
  }
}

// The status transition. A teacher actor may move their OWN booking only to
// `confirmed` or `cancelled` — the two verbs the portal exposes. Completing a
// booking is an operator action, so a teacher sending `completed` is refused
// with 403 even on their own row and even with the edit grant.
function transitionBooking(req, res) {
  try {
    const tenantId = _tenantIdOr400(req, res);
    if (!tenantId) return;
    const found = bookingService.getBooking({ tenantId }, req.params.id);
    if (!found) return error(res, 'Booking not found', 404);
    const body = (req.body && typeof req.body === 'object') ? req.body : {};
    if (req.teacherActor) {
      if (String(found.teacherId) !== String(req.teacherActor.id)) {
        return _ownership403(res, 'Teachers may only transition their own bookings');
      }
      if (body.status !== 'confirmed' && body.status !== 'cancelled') {
        return _ownership403(res, 'Teachers may only confirm or cancel their own bookings');
      }
    }
    const updated = bookingService.transitionBooking({ tenantId }, req.params.id, body.status);
    if (!updated) return error(res, 'Booking not found', 404);
    success(res, updated, 'Booking status updated');
  } catch (err) {
    if (_mapError(res, err)) return;
    logger.error('booking.transitionBooking error:', err.message);
    error(res, 'Failed to update booking status', 500);
  }
}

module.exports = { listBookings, getBooking, createBooking, updateBooking, transitionBooking };
