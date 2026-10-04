'use strict';

// guardian.routes — Phase 0 Parent / Guardian records (Education V2).
//
// Mounted at /api/v1/tenant/education (see backend/server.js), alongside the
// teacher router. The literal '/guardians...' prefix is disjoint from every
// other Education router, so nothing is shadowed and no existing router is
// touched.
//
// AUTHORIZATION — same deliberate choice as educationPack.routes,
// student.routes and teacher.routes.
// STRICT `requirePermission`, NOT `requirePermissionIfAuth`: the IfAuth variant
// short-circuits to next() whenever AUTH_REQUIRED is false, which defaults to
// false, so it would make the whole Guardian surface unauthenticated by
// default. `education.guardians.view` / `education.guardians.edit` are
// registered in backend/permissions/registry.js, so the gate is enforceable
// today and an unknown permission still fails closed.
//
// PORTAL IDENTITY (Phase 0 Parent portal):
//   - GET /guardians/me and GET /guardians/me/children resolve the guardian
//     LINKED to the signed-in account. They deliberately use NO permission
//     grant: the link itself is the authorization (an account can only ever
//     read its own linked record and its own children). Registered BEFORE
//     '/guardians/:id' so the literal paths win.
//   - POST/DELETE /guardians/:id/link-user and the /children link routes are
//     gated by requireRole('Owner', 'Admin') — the TENANT role resolved
//     server-side, never a client claim — because binding an account to a
//     guardian, or granting that guardian a child, IS granting portal identity.
//   - OWNERSHIP: a linked parent (req.guardianActor) is refused 403
//     OWNERSHIP_DENIED on every other guardian's row, and may only ever read
//     the students on their own child list.
//
// PHASE 0 SCOPE: parents are READ-ONLY. No route here accepts a parent-authored
// Education write, and the global scopedWriteRoleGuard('Owner','Admin',
// 'Manager') is deliberately left without a guardian exception.

const router = require('express').Router();
const ctrl = require('../controllers/guardian.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission, requireRole } = require('../middleware/authorize');

// Portal identity — MUST stay above '/guardians/:id'.
router.get('/guardians/me', asyncHandler(ctrl.getMe));
router.get('/guardians/me/children', asyncHandler(ctrl.getMyChildren));

router.get('/guardians', requirePermission('education.guardians.view'), asyncHandler(ctrl.listGuardians));
router.get('/guardians/:id', requirePermission('education.guardians.view'), asyncHandler(ctrl.getGuardian));
router.post('/guardians', requirePermission('education.guardians.edit'), asyncHandler(ctrl.createGuardian));
router.put('/guardians/:id', requirePermission('education.guardians.edit'), asyncHandler(ctrl.updateGuardian));
router.patch('/guardians/:id/archive', requirePermission('education.guardians.edit'), asyncHandler(ctrl.archiveGuardian));

// Operator view of one guardian's children, behind the same view grant.
router.get('/guardians/:id/children', requirePermission('education.guardians.view'), asyncHandler(ctrl.getGuardianChildren));

// Account link — Owner/Admin only, server-resolved tenant role.
router.post('/guardians/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.linkUser));
router.delete('/guardians/:id/link-user', requireRole('Owner', 'Admin'), asyncHandler(ctrl.unlinkUser));

// Child relationship — Owner/Admin only, same reasoning as the account link.
router.post('/guardians/:id/children', requireRole('Owner', 'Admin'), asyncHandler(ctrl.linkChild));
router.delete('/guardians/:id/children/:studentId', requireRole('Owner', 'Admin'), asyncHandler(ctrl.unlinkChild));

module.exports = router;