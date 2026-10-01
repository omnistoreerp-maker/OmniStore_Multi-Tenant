'use strict';

// teacher.routes — STU-3 Teacher records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student router. All three declare disjoint
// literal paths ('/pack', '/capabilities', '/students...', '/teachers...'), so
// none shadows another. educationPack.routes.js is deliberately NOT touched.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes and
// student.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole Teacher surface unauthenticated by default.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.teachers.view` / `education.teachers.edit` are not yet
//   registered in backend/permissions/registry.js. Unknown permissions fail
//   closed, so only Owner/Admin can reach this surface until Master registers
//   them. This route file does NOT register them, does NOT bypass the gate, and
//   does NOT weaken the middleware. The same global
//   scopedWriteRoleGuard('Owner','Admin','Manager') interception documented in
//   the STU-1/STU-2 route files also applies to these writes.
//
// Teacher is the ONLY Education domain added here. Centers, Programs, Courses,
// Classes, Enrollment, Attendance, Scheduling, Guardian/Parent portal, Teacher
// portal, Billing, Payments and financial logic are deliberately NOT declared.

const router = require('express').Router();
const ctrl = require('../controllers/teacher.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/teachers', requirePermission('education.teachers.view'), asyncHandler(ctrl.listTeachers));
router.get('/teachers/:id', requirePermission('education.teachers.view'), asyncHandler(ctrl.getTeacher));
router.post('/teachers', requirePermission('education.teachers.edit'), asyncHandler(ctrl.createTeacher));
router.put('/teachers/:id', requirePermission('education.teachers.edit'), asyncHandler(ctrl.updateTeacher));
router.patch('/teachers/:id/archive', requirePermission('education.teachers.edit'), asyncHandler(ctrl.archiveTeacher));

module.exports = router;