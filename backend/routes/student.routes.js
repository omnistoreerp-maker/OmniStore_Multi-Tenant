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
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.students.view` / `education.students.edit` are not yet
//   registered in backend/permissions/registry.js. Unknown permissions fail
//   closed, so only Owner/Admin can reach this surface until Master registers
//   them. Also note the global scopedWriteRoleGuard('Owner','Admin','Manager')
//   intercepts /api/v1/tenant/education/* writes before these route
//   permissions are evaluated; that interaction is documented, not altered.
//
// Teacher, Guardian, Center, Program, Course, Class, Enrollment, Attendance,
// schedule, grade and billing entities are deliberately NOT declared here.

const router = require('express').Router();
const ctrl = require('../controllers/student.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/students', requirePermission('education.students.view'), asyncHandler(ctrl.listStudents));
router.get('/students/:id', requirePermission('education.students.view'), asyncHandler(ctrl.getStudent));
router.post('/students', requirePermission('education.students.edit'), asyncHandler(ctrl.createStudent));
router.put('/students/:id', requirePermission('education.students.edit'), asyncHandler(ctrl.updateStudent));
router.patch('/students/:id/archive', requirePermission('education.students.edit'), asyncHandler(ctrl.archiveStudent));

module.exports = router;