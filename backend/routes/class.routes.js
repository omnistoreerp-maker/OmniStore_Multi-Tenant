'use strict';

// class.routes — STU-6 Education Class records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center and
// STU-5 program/course routers. All declare disjoint literal paths, so none
// shadows another.
//
// A Class is an entity INSIDE the existing tenant. Its `courseId` and
// `teacherId` are the only relationships it stores; its Program and Center are
// DERIVED through the Course, so this router introduces no tenant hierarchy, no
// new authentication boundary and no new RBAC boundary. Students, Enrollment,
// Attendance, Scheduling, Grading, Exams, Guardians, Billing, Payments and
// Payroll are deliberately NOT declared.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, teacher.routes, center.routes and course.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// PERMISSIONS (P1-registered): `education.classes.view` /
// `education.classes.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions still
// fail closed; this file does NOT bypass the gate and does NOT weaken the
// middleware. The global scopedWriteRoleGuard (Owner/Admin/Manager writes)
// applies to these routes too — and a LINKED teacher (req.teacherActor) is
// confined to their own rows by the controller; see class.controller.

const router = require('express').Router();
const ctrl = require('../controllers/class.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/classes', requirePermission('education.classes.view'), asyncHandler(ctrl.listClasses));
router.get('/classes/:id', requirePermission('education.classes.view'), asyncHandler(ctrl.getClass));
router.post('/classes', requirePermission('education.classes.edit'), asyncHandler(ctrl.createClass));
router.put('/classes/:id', requirePermission('education.classes.edit'), asyncHandler(ctrl.updateClass));
router.patch('/classes/:id/archive', requirePermission('education.classes.edit'), asyncHandler(ctrl.archiveClass));

module.exports = router;
