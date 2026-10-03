'use strict';

// booking.routes — Education Bookings (P2 Teacher portal).
//
// Mounted at /api/v1/tenant/education (see backend/server.js). The paths
// ('/bookings', '/bookings/:id', '/bookings/:id/status') are disjoint from
// every other education router, so none shadows another.
//
// AUTHORIZATION — the same deliberate STRICT `requirePermission` choice as the
// rest of Education, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false (which is the
// default), which would leave the whole booking surface unauthenticated by
// default. `education.bookings.view` / `education.bookings.edit` are
// registered in backend/permissions/registry.js, so the gate is enforceable
// today and an unknown permission still fails closed.
//
// The permission gate answers MAY this principal act on bookings at all. It
// does not answer WHICH bookings: ownership (a linked teacher may only ever
// see and confirm/cancel their own rows) is enforced in the controller
// against `req.teacherActor`, independently of the grants.

const router = require('express').Router();
const ctrl = require('../controllers/booking.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/bookings', requirePermission('education.bookings.view'), asyncHandler(ctrl.listBookings));
router.get('/bookings/:id', requirePermission('education.bookings.view'), asyncHandler(ctrl.getBooking));
router.post('/bookings', requirePermission('education.bookings.edit'), asyncHandler(ctrl.createBooking));
router.put('/bookings/:id', requirePermission('education.bookings.edit'), asyncHandler(ctrl.updateBooking));
router.patch('/bookings/:id/status', requirePermission('education.bookings.edit'), asyncHandler(ctrl.transitionBooking));

module.exports = router;
