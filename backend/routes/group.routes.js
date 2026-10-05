'use strict';

// group.routes — P1 Academic Foundation: Class Group records.
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// other education routers. All declare disjoint literal paths, so none
// shadows another.
//
// A Group is an entity INSIDE the existing tenant. These routes introduce NO
// tenant hierarchy, no new authentication boundary and no new RBAC boundary.
// The REQUIRED classId is a relationship validated inside the trusted tenant
// (and immutable after create), and a linked center is force-scoped through
// it by the controller — never ownership by query.
//
// AUTHORIZATION — same deliberate choice as every other education router.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole surface unauthenticated by default.
//
// PERMISSIONS (P1-registered): `education.groups.view` / `education.groups.edit`
// ARE registered in backend/permissions/registry.js. Strict `requirePermission`
// enforces them per grant; unknown permissions still fail closed; this file
// does NOT bypass the gate and does NOT weaken the middleware. The global
// scopedWriteRoleGuard interception applies to these writes too.

const router = require('express').Router();
const ctrl = require('../controllers/group.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/groups', requirePermission('education.groups.view'), asyncHandler(ctrl.listGroups));
router.get('/groups/:id', requirePermission('education.groups.view'), asyncHandler(ctrl.getGroup));
router.post('/groups', requirePermission('education.groups.edit'), asyncHandler(ctrl.createGroup));
router.put('/groups/:id', requirePermission('education.groups.edit'), asyncHandler(ctrl.updateGroup));
router.patch('/groups/:id/archive', requirePermission('education.groups.edit'), asyncHandler(ctrl.archiveGroup));

module.exports = router;
