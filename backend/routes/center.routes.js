'use strict';

// center.routes — STU-4 Education Center records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router, the STU-2 student router and the STU-3 teacher router.
// All four declare disjoint literal paths ('/pack', '/capabilities',
// '/students...', '/teachers...', '/centers...'), so none shadows another.
//
// A Center is an entity INSIDE the existing tenant. These routes introduce NO
// tenant hierarchy, no new authentication boundary and no new RBAC boundary.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes and teacher.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole Center surface unauthenticated by default.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.centers.view` / `education.centers.edit` are not yet registered
//   in backend/permissions/registry.js. Unknown permissions fail closed, so
//   only Owner/Admin can reach this surface until Master registers them. This
//   file does NOT register them, does NOT bypass the gate, and does NOT
//   weaken the middleware. The global scopedWriteRoleGuard interception
//   documented in the STU-1/STU-2/STU-3 route files applies to these writes
//   too.
//
// Center is the ONLY Education domain added here. Programs, Courses, Classes,
// Enrollment, Attendance, Scheduling, Guardian/Parent portal, Teacher portal,
// Billing, Payments, Payroll and financial logic are deliberately NOT
// declared.

const router = require('express').Router();
const ctrl = require('../controllers/center.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/centers', requirePermission('education.centers.view'), asyncHandler(ctrl.listCenters));
router.get('/centers/:id', requirePermission('education.centers.view'), asyncHandler(ctrl.getCenter));
router.post('/centers', requirePermission('education.centers.edit'), asyncHandler(ctrl.createCenter));
router.put('/centers/:id', requirePermission('education.centers.edit'), asyncHandler(ctrl.updateCenter));
router.patch('/centers/:id/archive', requirePermission('education.centers.edit'), asyncHandler(ctrl.archiveCenter));

module.exports = router;