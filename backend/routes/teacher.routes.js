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
// `education.teachers.view` / `education.teachers.edit` are registered in
// backend/permissions/registry.js, so the gate is enforceable today and an
// unknown permission still fails closed. The global
// scopedWriteRoleGuard('Owner','Admin','Manager') applies to these writes
// too, with ONE identity-based exception: a LINKED teacher account
// (req.teacherActor, resolved before that gate by middleware/teacherActor)
// passes it on the education subtree — which is what lets a teacher with a
// normal, non-privileged account reach their own portal writes; the route
// permission and the controller's ownership checks still decide everything
// else. See the guard's comment in backend/middleware/authorize.js.
//
// PORTAL IDENTITY (P2 Teacher portal):
//   - GET /teachers/me resolves the teacher LINKED to the signed-in account.
//     It deliberately uses NO permission grant: the link itself is the
//     authorization (an account can only ever read its own linked record).
//     Registered BEFORE /teachers/:id so the literal path wins.
//   - POST/DELETE /teachers/:id/link-user are gated by requireRole('Owner',
//     'Admin') — the TENANT role resolved server-side, never a client claim —
//     because binding an account to a teacher IS granting portal identity.
//   - OWNERSHIP: a linked teacher (req.teacherActor) is refused 403
//     OWNERSHIP_DENIED on every other teacher's row in the controller,
//     independent of the view/edit grants it may also hold.
//
// Teacher is the ONLY record domain declared here; Centers, Programs, Courses,
// Classes, Enrollment, Attendance, Scheduling, Grading, Bookings and Ratings
// live in their own routers.

const router = require('express').Router();
const ctrl = require('../controllers/teacher.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requireRole } = require('../middleware/authorize');

// Portal identity — MUST stay above '/teachers/:id'.
router.get('/teachers/me', asyncHandler(ctrl.getMe));

router.get('/teachers', requirePermission('education.teachers.view'), asyncHandler(ctrl.listTeachers));
router.get('/teachers/:id', requirePermission('education.teachers.view'), asyncHandler(ctrl.getTeacher));
router.post('/teachers', requirePermission('education.teachers.edit'), asyncHandler(ctrl.createTeacher));
router.put('/teachers/:id', requirePermission('education.teachers.edit'), asyncHandler(ctrl.updateTeacher));
router.patch('/teachers/:id/archive', requirePermission('education.teachers.edit'), asyncHandler(ctrl.archiveTeacher));

// Account link — Owner/Admin only, server-resolved tenant role.
router.post('/teachers/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.linkUser));
router.delete('/teachers/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.unlinkUser));

module.exports = router;