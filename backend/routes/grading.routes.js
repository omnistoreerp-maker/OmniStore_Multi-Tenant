'use strict';

// grading.routes.js - STU-10 Education Grading records (Device 2).
//
// A grading record is the recorded outcome for ONE Enrollment. It owns
// `enrollmentId` and nothing else: `studentId` and `classId` are derived through
// the Enrollment, and no course, program, center or teacher reference is stored
// on the row. This router therefore introduces no tenant hierarchy, no new
// authentication boundary and no new RBAC boundary.
//
// GRADING SCALE - there is none, by design.
//   The repository defines no percentage, letter grade, GPA, point total or
//   pass/fail threshold, so this router stores one canonical bounded `grade`
//   value recorded verbatim and performs no comparison, conversion or
//   aggregation. `score`, `mark`, `result`, `grades`, `exam` and `exams` stay
//   refused: they need an assessment identity this repository does not have.
//
// LIFECYCLE - deliberately the smallest Education surface, and the same shape as
// STU-8 attendance and STU-9 scheduling. There is no DELETE, no `/archive` and
// no `/withdraw`: a re-mark is CORRECTED through `PUT`, which is auditable in a
// way a delete is not. `PUT` may change `grade`, `gradingDate` and `notes`;
// `enrollmentId` is immutable. Assessments, exams, coursework, transcripts,
// certificates, GPA, ranking, analytics, notifications, billing, tuition,
// payments and payroll are NOT declared.
//
// AUTHORIZATION - same deliberate choice as educationPack.routes, student.routes
// through attendance.routes and scheduling.routes. STRICT `requirePermission`,
// NOT `requirePermissionIfAuth`.
//
// PERMISSIONS (P1-registered): `education.grading.view` /
// `education.grading.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions still
// fail closed; this file does NOT bypass the gate and does NOT weaken the
// middleware. The global scopedWriteRoleGuard (Owner/Admin/Manager writes)
// applies to these routes too.
//
// PHASE 2A — the two READ routes use `requirePermissionOrSelf`: a LINKED
// student passes WITHOUT the operator view grant and the controller narrows
// the rows to their OWN enrollments' grades (server-resolved
// req.educationStudent). Writes keep strict `requirePermission` — a Student is
// read-only.

const router = require('express').Router();
const ctrl = require('../controllers/grading.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requirePermissionOrSelf } = require('../middleware/authorize');

router.get('/grading', requirePermissionOrSelf('education.grading.view'), asyncHandler(ctrl.listGrading));
router.get('/grading/:id', requirePermissionOrSelf('education.grading.view'), asyncHandler(ctrl.getGrade));
router.post('/grading', requirePermission('education.grading.edit'), asyncHandler(ctrl.createGrade));
router.put('/grading/:id', requirePermission('education.grading.edit'), asyncHandler(ctrl.updateGrade));

module.exports = router;