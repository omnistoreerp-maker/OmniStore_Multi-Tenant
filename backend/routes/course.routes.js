'use strict';

// course.routes — STU-5 Education Course records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center and
// STU-5 program routers. All declare disjoint literal paths, so none shadows
// another.
//
// A Course is an entity INSIDE the existing tenant. Its `programId` is
// REQUIRED and is the single ownership reference: a Course reaches its Center
// through Course -> Program -> centerId, so this router exposes no Center or
// Teacher or Class concept. No tenant hierarchy, no new authentication
// boundary and no new RBAC boundary is introduced here.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, teacher.routes, center.routes and program.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.courses.view` / `education.courses.edit` are not yet registered
//   in backend/permissions/registry.js. Unknown permissions fail closed, so
//   only Owner/Admin can reach this surface until Master registers them. This
//   file does NOT register them, does NOT bypass the gate, and does NOT weaken
//   the middleware.
//
// Classes, Enrollment, Attendance, Scheduling, Teacher assignment,
// Guardian/Parent portal, Student portal, Teacher portal, Billing, Payments,
// Payroll and financial logic are deliberately NOT declared.

const router = require('express').Router();
const ctrl = require('../controllers/course.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/courses', requirePermission('education.courses.view'), asyncHandler(ctrl.listCourses));
router.get('/courses/:id', requirePermission('education.courses.view'), asyncHandler(ctrl.getCourse));
router.post('/courses', requirePermission('education.courses.edit'), asyncHandler(ctrl.createCourse));
router.put('/courses/:id', requirePermission('education.courses.edit'), asyncHandler(ctrl.updateCourse));
router.patch('/courses/:id/archive', requirePermission('education.courses.edit'), asyncHandler(ctrl.archiveCourse));

module.exports = router;