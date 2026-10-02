'use strict';

// program.routes — STU-5 Education Program records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center and
// STU-5 course routers. All declare disjoint literal paths, so none shadows
// another.
//
// A Program is an entity INSIDE the existing tenant. These routes introduce NO
// tenant hierarchy, no new authentication boundary and no new RBAC boundary.
// A Program's optional centerId is a relationship validated inside the trusted
// tenant, never ownership.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, teacher.routes and center.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole Program surface unauthenticated by default.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.programs.view` / `education.programs.edit` are not yet
//   registered in backend/permissions/registry.js. Unknown permissions fail
//   closed, so only Owner/Admin can reach this surface until Master registers
//   them. This file does NOT register them, does NOT bypass the gate, and does
//   NOT weaken the middleware. The global scopedWriteRoleGuard interception
//   documented in the STU-1..STU-4 route files applies to these writes too.
//
// Program is one of only two Education domains added in STU-5. Courses live in
// course.routes.js. Classes, Enrollment, Attendance, Scheduling, Guardian/Parent
// portal, Teacher assignment, Billing, Payments, Payroll and financial logic
// are deliberately NOT declared.

const router = require('express').Router();
const ctrl = require('../controllers/program.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/programs', requirePermission('education.programs.view'), asyncHandler(ctrl.listPrograms));
router.get('/programs/:id', requirePermission('education.programs.view'), asyncHandler(ctrl.getProgram));
router.post('/programs', requirePermission('education.programs.edit'), asyncHandler(ctrl.createProgram));
router.put('/programs/:id', requirePermission('education.programs.edit'), asyncHandler(ctrl.updateProgram));
router.patch('/programs/:id/archive', requirePermission('education.programs.edit'), asyncHandler(ctrl.archiveProgram));

module.exports = router;