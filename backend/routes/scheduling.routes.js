'use strict';

// scheduling.routes — STU-9 Education Scheduling records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center,
// STU-5 program/course, STU-6 class, STU-7 enrollment and STU-8 attendance
// routers. All declare disjoint literal paths, so none shadows another.
//
// A scheduling session is ONE Class, ONE day, ONE time range. It owns
// `classId` and nothing else: the teacher is derived from the Class, and no
// course, program, center, student or enrollment reference is stored on the
// row. This router therefore introduces no tenant hierarchy, no new
// authentication boundary and no new RBAC boundary.
//
// LIFECYCLE — deliberately the smallest Education surface, and the same shape
// as STU-8 attendance. There is no DELETE, no `/archive` and no `/cancel`: a
// wrong plan is CORRECTED through `PUT`, which is auditable in a way a delete is
// not. `PUT` may change `scheduledDate`, `startTime`, `endTime` and `notes`;
// `classId` is immutable. Grading, Exams, Guardians, Certificates, Billing,
// Payments, Tuition, Payroll, rooms/resources, recurrence, LMS and video
// integration are NOT declared.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, class.routes, course.routes, enrollment.routes and
// attendance.routes. STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// PERMISSIONS (P1-registered): `education.scheduling.view` /
// `education.scheduling.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions still
// fail closed; this file does NOT bypass the gate and does NOT weaken the
// middleware. The global scopedWriteRoleGuard (Owner/Admin/Manager writes)
// applies to these routes too — and a LINKED teacher (req.teacherActor) is
// confined to sessions of their own classes by the controller; see
// scheduling.controller.

const router = require('express').Router();
const ctrl = require('../controllers/scheduling.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/scheduling', requirePermission('education.scheduling.view'), asyncHandler(ctrl.listScheduling));
router.get('/scheduling/:id', requirePermission('education.scheduling.view'), asyncHandler(ctrl.getSession));
router.post('/scheduling', requirePermission('education.scheduling.edit'), asyncHandler(ctrl.createSession));
router.put('/scheduling/:id', requirePermission('education.scheduling.edit'), asyncHandler(ctrl.updateSession));

module.exports = router;