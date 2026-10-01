'use strict';

// Platform Control Center — routes.
//
// Mounted at /api/v1/platform/control-center. EVERY route is server-authorized
// by the granular platform permission middleware (requirePlatformPermission),
// which resolves the caller's ACTIVE platform membership from the platform
// store — never from client input. The team-management surface reuses the
// existing /api/v1/platform/admins resource (see platform.routes.js) instead of
// duplicating it.

const router = require('express').Router();
const ctrl = require('../controllers/platformControlCenter.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformPermission } = require('../middleware/platformAuth');

// Role-aware UI bootstrap — available to every platform member.
router.get('/access', requireAuth, requirePlatformPermission('platform.dashboard.view'), ctrl.access);

// Dashboard — real platform metrics.
router.get('/dashboard', requireAuth, requirePlatformPermission('platform.dashboard.view'), ctrl.dashboard);

// Permission matrix — MASTER_OWNER only (roles.manage).
router.get('/matrix', requireAuth, requirePlatformPermission('platform.roles.manage'), ctrl.permissionMatrix);

// Developer diagnostics.
router.get('/diagnostics', requireAuth, requirePlatformPermission('platform.diagnostics.view'), ctrl.diagnostics);
router.get('/diagnostics/errors', requireAuth, requirePlatformPermission('platform.diagnostics.view'), ctrl.listDiagnosticErrors);

// Data-entry platform content catalog.
router.get('/catalog', requireAuth, requirePlatformPermission('catalog.read'), ctrl.listCatalog);
router.post('/catalog', requireAuth, requirePlatformPermission('catalog.create'), ctrl.createCatalogEntry);
router.patch('/catalog/:id', requireAuth, requirePlatformPermission('catalog.update'), ctrl.updateCatalogEntry);

module.exports = router;