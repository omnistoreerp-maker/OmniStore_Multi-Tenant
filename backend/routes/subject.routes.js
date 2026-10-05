'use strict';

// subject.routes — P1 Academic Foundation: Subject records.
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// other education routers. All declare disjoint literal paths, so none
// shadows another.
//
// A Subject is an entity INSIDE the existing tenant. These routes introduce
// NO tenant hierarchy, no new authentication boundary and no new RBAC
// boundary. The REQUIRED centerId is a relationship validated inside the
// trusted tenant, and a linked center is force-scoped to it by the
// controller — never ownership by query.
//
// AUTHORIZATION — same deliberate choice as every other education router.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole surface unauthenticated by default.
//
// PERMISSIONS (P1-registered): `education.subjects.view` /
// `education.subjects.edit` ARE registered in backend/permissions/registry.js.
// Strict `requirePermission` enforces them per grant; unknown permissions
// still fail closed; this file does NOT bypass the gate and does NOT weaken
// the middleware. The global scopedWriteRoleGuard interception applies to
// these writes too.

const router = require('express').Router();
const ctrl = require('../controllers/subject.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/subjects', requirePermission('education.subjects.view'), asyncHandler(ctrl.listSubjects));
router.get('/subjects/:id', requirePermission('education.subjects.view'), asyncHandler(ctrl.getSubject));
router.post('/subjects', requirePermission('education.subjects.edit'), asyncHandler(ctrl.createSubject));
router.put('/subjects/:id', requirePermission('education.subjects.edit'), asyncHandler(ctrl.updateSubject));
router.patch('/subjects/:id/archive', requirePermission('education.subjects.edit'), asyncHandler(ctrl.archiveSubject));

module.exports = router;
