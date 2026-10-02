'use strict';

// educationPack.routes — STU-1 Education foundation (Device 2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), isolated from
// the ERP, Marketplace, Game Hosting, TikTok/Reels, Platform Home and the
// existing Student Services Pack namespaces.
//
// AUTHORIZATION — DELIBERATE CHOICE.
//
// These routes use the STRICT `requirePermission` gate, NOT
// `requirePermissionIfAuth`. `requirePermissionIfAuth` short-circuits to
// `next()` whenever AUTH_REQUIRED is false, and AUTH_REQUIRED defaults to
// false — so the IfAuth variant would make the entire Education surface
// unauthenticated by default. `requirePermission` is unconditional and always
// returns 401 for a missing identity.
//
// Verified invocation signature (backend/middleware/authorize.js):
//     requirePermission(permission) -> (req, res, next)
// It 401s when `req.user` is absent and 403s with code PERMISSION_DENIED when
// the authorization engine refuses the permission for the trusted tenant.
//
// KNOWN BLOCKER (Master-owned, NOT worked around here):
//   `education.pack.view` / `education.pack.edit` are not yet registered in
//   backend/permissions/registry.js. Unknown permissions fail closed, so until
//   Master adds them only Owner/Admin can reach this surface (they bypass the
//   registry). That is the safe direction to fail.

const router = require('express').Router();
const ctrl = require('../controllers/educationPack.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/pack', requirePermission('education.pack.view'), asyncHandler(ctrl.getPack));
router.put('/pack', requirePermission('education.pack.edit'), asyncHandler(ctrl.updatePack));
router.delete('/pack', requirePermission('education.pack.edit'), asyncHandler(ctrl.resetPack));
router.get('/capabilities', requirePermission('education.pack.view'), asyncHandler(ctrl.listCapabilities));

module.exports = router;
