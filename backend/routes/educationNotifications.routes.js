'use strict';

// educationNotifications.routes — Phase 0 student-scoped notifications.
//
// Mounted at /api/v1/tenant/education (see backend/server.js).
//
// The literal prefix '/education-notifications/...' is deliberately disjoint
// from every other Education router ('/pack', '/students', '/teachers',
// '/centers', '/programs', '/courses', '/classes', '/enrollments',
// '/attendance', '/scheduling', '/grading', '/bookings', '/ratings',
// '/guardians'), so this router can neither be shadowed nor shadow anything.
//
// AUTHORIZATION. These routes carry NO permission grant and that is
// intentional, not an oversight: each one resolves its subject from a
// SERVER-OWNED account link. `requirePermission` is the right gate for a
// DIRECTORY an operator browses; it is the wrong gate for a portal that is
// already scoped to one person by that person's own link. Adding a grant here
// would widen what a linked parent or student can read beyond their own rows,
// which is exactly the widening the own-row checks exist to prevent. Anonymous
// traffic is refused 401 by the controller, not by a route middleware.
//
// The routes are still fully subject to the global Education middleware chain
// (attachTeacherActor, attachGuardianActor) and to tenant resolution through
// trustedTenantId(req).

const router = require('express').Router();
const ctrl = require('../controllers/educationNotifications.controller');
const asyncHandler = require('../utils/asyncHandler');

router.get('/education-notifications/me', asyncHandler(ctrl.getMyNotifications));
router.get(
  '/education-notifications/children/:studentId/notifications',
  asyncHandler(ctrl.getChildNotifications)
);

module.exports = router;