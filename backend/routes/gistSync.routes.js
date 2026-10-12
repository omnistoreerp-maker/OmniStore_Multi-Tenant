'use strict';

// gistSync.routes.js — two independently gated surfaces:
//
//   masterRouter  -> mounted at /api/v1/platform/sync   (requirePlatformAdmin)
//   tenantRouter  -> mounted at /api/v1/sync            (requireAuth + roles)
//
// The tenant router NEVER takes a tenant id from the URL, query or body: the
// controller resolves it exclusively from trustedTenantId(req). Provider
// configuration is physically unreachable for ordinary tenant users because
// it lives only behind the platform-admin gate on the master surface.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const { requireRole } = require('../middleware/authorize');
const ctrl = require('../controllers/gistSync.controller');

const admin = [requireAuth, requirePlatformAdmin()];

const masterRouter = express.Router();
masterRouter.get('/', admin, ctrl.listConfigs);
masterRouter.put('/:tenantId', admin, ctrl.configure);
masterRouter.delete('/:tenantId', admin, ctrl.disconnect);

const tenantRouter = express.Router();
tenantRouter.get('/status', requireAuth, ctrl.status);
// Pull is read-only: any authenticated company member may fetch their own
// dataset mirror. Push mutates shared state: Owner/Admin/Manager only.
tenantRouter.post('/pull', requireAuth, ctrl.pull);
tenantRouter.post('/push', requireAuth, requireRole('Owner', 'Admin', 'Manager'), ctrl.push);

module.exports = { masterRouter, tenantRouter };
