'use strict';

// attendance.routes — STU-8 Education Attendance records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 pack router and the STU-2 student, STU-3 teacher, STU-4 center,
// STU-5 program/course, STU-6 class and STU-7 enrollment routers. All declare
// disjoint literal paths, so none shadows another.
//
// An Attendance record is a DAILY FACT about ONE Enrollment. It owns
// `enrollmentId` and nothing else: no student/class/course/program/teacher/
// center reference is stored on the row, and no Enrollment gains an attendance
// array. This router therefore introduces no tenant hierarchy, no new
// authentication boundary and no new RBAC boundary.
//
// LIFECYCLE — deliberately the smallest Education surface. There is no DELETE,
// no `/archive` and no `/withdraw`: attendance records history, and a
// mis-marked register is CORRECTED through `PUT`, which is auditable in a way a
// delete is not. `PUT` may change `status`, `notes` and `attendanceDate`;
// `enrollmentId` is immutable. Scheduling, Grading, Exams, Guardians,
// Certificates, Billing, Payments, Tuition and Payroll are NOT declared.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, class.routes, course.routes and enrollment.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.attendance.view` / `education.attendance.edit` are not yet
//   registered in backend/permissions/registry.js. Unknown permissions fail
//   closed, so only Owner/Admin can reach this surface until Master registers
//   them. This file does NOT register them, does NOT bypass the gate, and does
//   NOT weaken the middleware.

const router = require('express').Router();
const ctrl = require('../controllers/attendance.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/attendance', requirePermission('education.attendance.view'), asyncHandler(ctrl.listAttendance));
router.get('/attendance/:id', requirePermission('education.attendance.view'), asyncHandler(ctrl.getAttendance));
router.post('/attendance', requirePermission('education.attendance.edit'), asyncHandler(ctrl.createAttendance));
router.put('/attendance/:id', requirePermission('education.attendance.edit'), asyncHandler(ctrl.updateAttendance));

module.exports = router;