'use strict';

// enrollment.routes — STU-7 Education Enrollment records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center,
// STU-5 program/course and STU-6 class routers. All declare disjoint literal
// paths, so none shadows another.
//
// An Enrollment is the RELATIONSHIP between a Student and a Class. It owns
// `studentId` and `classId` and nothing else: no student array on Student, no
// class array on Class, and nothing denormalized from the Class chain. This
// router therefore introduces no tenant hierarchy, no new authentication
// boundary and no new RBAC boundary.
//
// LIFECYCLE — deliberately one fewer route than the other Education routers.
// There is no DELETE and no `/archive`: an Enrollment is withdrawn, never
// deleted, so future Attendance and grading keep a resolvable record.
// `PUT` edits `notes` only; the relationship is immutable and re-enrollment
// always means a NEW row. Attendance, Grading, Exams, Scheduling, Guardians,
// Certificates, Billing, Payments, Tuition and Payroll are NOT declared.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, class.routes and course.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// PERMISSIONS (P1-registered): `education.enrollments.view` /
// `education.enrollments.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions still
// fail closed; this file does NOT bypass the gate and does NOT weaken the
// middleware. The global scopedWriteRoleGuard (Owner/Admin/Manager writes)
// applies to these routes too — and a LINKED teacher (req.teacherActor) is
// confined to their own classes' enrollments by the controller; see
// enrollment.controller.

const router = require('express').Router();
const ctrl = require('../controllers/enrollment.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/enrollments', requirePermission('education.enrollments.view'), asyncHandler(ctrl.listEnrollments));
router.get('/enrollments/:id', requirePermission('education.enrollments.view'), asyncHandler(ctrl.getEnrollment));
router.post('/enrollments', requirePermission('education.enrollments.edit'), asyncHandler(ctrl.createEnrollment));
router.put('/enrollments/:id', requirePermission('education.enrollments.edit'), asyncHandler(ctrl.updateEnrollment));
router.patch('/enrollments/:id/withdraw', requirePermission('education.enrollments.edit'), asyncHandler(ctrl.withdrawEnrollment));

module.exports = router;
