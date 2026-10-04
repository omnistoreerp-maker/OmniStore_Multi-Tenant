'use strict';

// rating.routes — Education Ratings (P2 Teacher portal).
//
// Mounted at /api/v1/tenant/education (see backend/server.js). The paths
// ('/ratings', '/ratings/:id', '/ratings/:id/archive') are disjoint from every
// other education router, so none shadows another.
//
// AUTHORIZATION — the same deliberate STRICT `requirePermission` choice as the
// rest of Education, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false (the default),
// which would leave the whole ratings surface unauthenticated by default.
// `education.ratings.view` / `education.ratings.edit` are registered in
// backend/permissions/registry.js, so the gate is enforceable today and an
// unknown permission still fails closed.
//
// The permission gate answers MAY this principal act on ratings at all. It
// does not answer WHICH ratings: a linked teacher may only ever READ their own
// rows (and never write any), enforced in the controller against
// `req.teacherActor`, independently of the grants.

const router = require('express').Router();
const ctrl = require('../controllers/rating.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/ratings', requirePermission('education.ratings.view'), asyncHandler(ctrl.listRatings));
router.get('/ratings/:id', requirePermission('education.ratings.view'), asyncHandler(ctrl.getRating));
router.post('/ratings', requirePermission('education.ratings.edit'), asyncHandler(ctrl.createRating));
router.put('/ratings/:id', requirePermission('education.ratings.edit'), asyncHandler(ctrl.updateRating));
router.patch('/ratings/:id/archive', requirePermission('education.ratings.edit'), asyncHandler(ctrl.archiveRating));

module.exports = router;
