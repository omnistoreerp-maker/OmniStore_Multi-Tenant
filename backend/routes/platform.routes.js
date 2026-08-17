'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/platform.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');

// Any authenticated client may keep its own presence alive.
router.post('/presence/heartbeat', requireAuth, ctrl.heartbeat);

// Every other platform surface is Master-Admin-only (server-side).
const admin = [requireAuth, requirePlatformAdmin()];

router.get('/me', requireAuth, ctrl.me);

router.get('/summary', admin, ctrl.summary);

router.get('/companies', admin, ctrl.listCompanies);
router.get('/companies/:id', admin, ctrl.getCompanyDetails);
router.post('/companies/:id/suspend', admin, ctrl.suspendCompany);
router.post('/companies/:id/activate', admin, ctrl.activateCompany);

router.get('/users', admin, ctrl.listUsers);
router.post('/users/:id/disable', admin, ctrl.disableUser);
router.post('/users/:id/enable', admin, ctrl.enableUser);
router.post('/users/:id/force-logout', admin, ctrl.forceLogout);
router.post('/users/:id/reset-password', admin, ctrl.resetPassword);

router.get('/presence', admin, ctrl.listPresence);

router.get('/licenses', admin, ctrl.listLicenses);
router.put('/licenses', admin, ctrl.setLicense);

router.get('/integrations', admin, ctrl.listIntegrations);
router.put('/integrations', admin, ctrl.setIntegration);

router.get('/audit', admin, ctrl.listAudit);

router.get('/admins', admin, ctrl.listAdmins);
router.post('/admins', admin, ctrl.grantAdmin);
router.delete('/admins/:username', admin, ctrl.revokeAdmin);

module.exports = router;
