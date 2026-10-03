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
// BATCH — `POST /attendance/bulk` records a whole class register in one
// request. It is the SAME record, the SAME rules and the SAME trusted tenant as
// `POST /attendance`, once per entry, and it never corrects: an
// already-recorded day is a typed 409 and is still fixed through `PUT`. It adds
// no tenant hierarchy, no authentication boundary, no RBAC boundary and no new
// permission string.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes, class.routes, course.routes and enrollment.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`.
//
// PERMISSIONS (P1-registered): `education.attendance.view` /
// `education.attendance.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions still
// fail closed; this file does NOT bypass the gate and does NOT weaken the
// middleware. The global scopedWriteRoleGuard (Owner/Admin/Manager writes)
// applies to these routes too.

const router = require('express').Router();
const ctrl = require('../controllers/attendance.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/attendance', requirePermission('education.attendance.view'), asyncHandler(ctrl.listAttendance));
router.get('/attendance/:id', requirePermission('education.attendance.view'), asyncHandler(ctrl.getAttendance));
router.post('/attendance', requirePermission('education.attendance.edit'), asyncHandler(ctrl.createAttendance));
// One register, one request. Declared AFTER the literal `/attendance` path and
// before any `/:id` path it could ever shadow; it is a POST while `/:id` is only
// ever a GET, so the two can never collide.
router.post('/attendance/bulk', requirePermission('education.attendance.edit'), asyncHandler(ctrl.bulkCreateAttendance));
router.put('/attendance/:id', requirePermission('education.attendance.edit'), asyncHandler(ctrl.updateAttendance));

module.exports = router;