'use strict';

// student.routes — STU-2 Student records (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// STU-1 Education pack router which declares only literal '/pack' and
// '/capabilities' paths, so neither router shadows the other.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole Student surface unauthenticated.
//
// `education.students.view` / `education.students.edit` are registered in
// backend/permissions/registry.js; an unknown permission still fails closed.
// The global scopedWriteRoleGuard('Owner','Admin','Manager') applies to these
// writes as before, with ONE identity-based exception: a caller whose account
// an Owner/Admin has LINKED to a teacher row (req.teacherActor, resolved by
// middleware/teacherActor before that gate) passes it on the education
// subtree — see the guard's own comment in backend/middleware/authorize.js.
// The route permission still decides access either way.
//
// PHASE 2A — LEARNER PORTAL SELF SCOPE. The three READ routes below use
// `requirePermissionOrSelf` (backend/middleware/authorize.js): a LINKED
// student (req.educationStudent, resolved server-side by
// middleware/studentActor from the signed token + trusted tenant + the
// Owner/Admin-created link) passes WITHOUT an operator `education.students.*`
// grant, and the controller force-narrows the result to that student's OWN
// row. Everyone else — anonymous, unlinked accounts, operators — still faces
// the strict permission gate. Every WRITE route keeps strict
// `requirePermission` + the global role gate: a Student is read-only. The
// link grants no permission; identity, role and ownership stay separate.
//
// Teacher, Guardian, Center, Program, Course, Class, Enrollment, Attendance,
// schedule, grade and billing entities are deliberately NOT declared here.

const router = require('express').Router();
const ctrl = require('../controllers/student.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requirePermissionOrSelf, requireRole } = require('../middleware/authorize');

// Portal identity — MUST stay above '/students/:id'.
router.get('/students/me', asyncHandler(ctrl.getMe));

router.get('/students', requirePermissionOrSelf('education.students.view'), asyncHandler(ctrl.listStudents));
router.get('/students/:id', requirePermissionOrSelf('education.students.view'), asyncHandler(ctrl.getStudent));
router.get('/students/:id/progress', requirePermissionOrSelf('education.students.view'), asyncHandler(ctrl.getStudentProgress));
router.post('/students', requirePermission('education.students.edit'), asyncHandler(ctrl.createStudent));
router.put('/students/:id', requirePermission('education.students.edit'), asyncHandler(ctrl.updateStudent));
router.patch('/students/:id/archive', requirePermission('education.students.edit'), asyncHandler(ctrl.archiveStudent));

// Account link — Owner/Admin only, server-resolved tenant role.
router.post('/students/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.linkUser));
router.delete('/students/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.unlinkUser));

module.exports = router;