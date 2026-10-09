'use strict';

// assignment.routes — EDU-ASG Assignment records.
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// other Education routers. All declare disjoint literal paths, so none shadows
// another.
//
// An Assignment is a strictly class-owned row (title/description/dueDate).
// There is deliberately no assignment-specific permission: assignments inherit
// their class's authorization (`education.classes.view` /
// `education.classes.edit`, both P1-registered), because every read and write
// is additionally narrowed to the caller's own classes — a grant alone never
// opens a foreign class's assignments. Unknown permissions still fail closed,
// and this file does NOT bypass any gate.
//
// AUTHORIZATION — same deliberate choice as the other Education routers.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole surface unauthenticated.
//
// The two READ routes use `requirePermissionOrSelf`: a LINKED student passes
// WITHOUT the operator view grant and the controller narrows the rows to the
// classes of their own enrollments. Writes keep strict `requirePermission` —
// a Student is read-only. The global scopedWriteRoleGuard (Owner/Admin/Manager
// writes, plus the linked-teacher bypass on teacher-owned education surfaces)
// applies to these routes too; `assignments` is registered in that bypass set
// so a linked teacher with a normal account can manage their own classes'
// assignments, while the route permission and the controller's ownership
// checks still decide everything else.

const router = require('express').Router();
const ctrl = require('../controllers/assignment.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requirePermissionOrSelf } = require('../middleware/authorize');

router.get('/assignments', requirePermissionOrSelf('education.classes.view'), asyncHandler(ctrl.listAssignments));
router.get('/assignments/:id', requirePermissionOrSelf('education.classes.view'), asyncHandler(ctrl.getAssignment));
router.post('/assignments', requirePermission('education.classes.edit'), asyncHandler(ctrl.createAssignment));
router.put('/assignments/:id', requirePermission('education.classes.edit'), asyncHandler(ctrl.updateAssignment));
router.patch('/assignments/:id/archive', requirePermission('education.classes.edit'), asyncHandler(ctrl.archiveAssignment));

module.exports = router;
