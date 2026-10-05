'use strict';

// term.routes — P1 Academic Foundation: Term / Semester records.
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// other education routers. All declare disjoint literal paths, so none
// shadows another.
//
// A Term is an entity INSIDE the existing tenant. These routes introduce NO
// tenant hierarchy, no new authentication boundary and no new RBAC boundary.
// The REQUIRED academicYearId is a relationship validated inside the trusted
// tenant, and a linked center is force-scoped through it by the controller.
//
// AUTHORIZATION — same deliberate choice as every other education router.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole surface unauthenticated by default.
//
// PERMISSIONS (P1-registered): `education.terms.view` / `education.terms.edit`
// ARE registered in backend/permissions/registry.js. Strict `requirePermission`
// enforces them per grant; unknown permissions still fail closed; this file
// does NOT bypass the gate and does NOT weaken the middleware. The global
// scopedWriteRoleGuard interception applies to these writes too.

const router = require('express').Router();
const ctrl = require('../controllers/term.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/terms', requirePermission('education.terms.view'), asyncHandler(ctrl.listTerms));
router.get('/terms/:id', requirePermission('education.terms.view'), asyncHandler(ctrl.getTerm));
router.post('/terms', requirePermission('education.terms.edit'), asyncHandler(ctrl.createTerm));
router.put('/terms/:id', requirePermission('education.terms.edit'), asyncHandler(ctrl.updateTerm));
router.patch('/terms/:id/archive', requirePermission('education.terms.edit'), asyncHandler(ctrl.archiveTerm));

module.exports = router;
