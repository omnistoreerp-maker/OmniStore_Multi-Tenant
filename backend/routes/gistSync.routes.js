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
// MCC operations: connectivity test, controlled pull/push, audit trail.
// Master pull NEVER returns dataset contents (summary only); master push
// obeys the exact same conflict + stamping rules as the tenant path.
masterRouter.post('/:tenantId/test', admin, ctrl.test);
masterRouter.post('/:tenantId/pull', admin, ctrl.masterPull);
masterRouter.post('/:tenantId/push', admin, ctrl.masterPush);
masterRouter.get('/:tenantId/audit', admin, ctrl.syncAudit);
// Trusted device inventory (FIX A): platform-owner attestation only. The
// expected-device set is server-authoritative; tenant clients never see or
// write it, so devices cannot invent or shrink their own expected count.
masterRouter.get('/:tenantId/device-inventory', admin, ctrl.getDeviceInventory);
masterRouter.put('/:tenantId/device-inventory', admin, ctrl.setDeviceInventory);

const tenantRouter = express.Router();
tenantRouter.get('/status', requireAuth, ctrl.status);
// Pull is read-only: any authenticated company member may fetch their own
// dataset mirror. Push mutates shared state: Owner/Admin/Manager only.
tenantRouter.post('/pull', requireAuth, ctrl.pull);
tenantRouter.post('/push', requireAuth, requireRole('Owner', 'Admin', 'Manager'), ctrl.push);
// Advisory legacy-PAT presence report (boolean only; never identity).
tenantRouter.post('/legacy-report', requireAuth, ctrl.legacyReport);

module.exports = { masterRouter, tenantRouter };
