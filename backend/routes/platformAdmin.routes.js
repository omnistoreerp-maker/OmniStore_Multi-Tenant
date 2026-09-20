'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/platformAdmin.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');

const admin = [requireAuth, requirePlatformAdmin()];

// ---------------- add-ons ----------------

router.get('/tenants/:tenantId/addons', admin, ctrl.listAddons);
router.post('/tenants/:tenantId/addons', admin, ctrl.upsertAddon);
router.delete('/tenants/:tenantId/addons/:addonKey', admin, ctrl.deleteAddon);

// ---------------- transaction fees ----------------

router.get('/fees', admin, ctrl.listFees);
router.patch('/fees/mark-billed', admin, ctrl.markFeesBilled);

// ---------------- custom domains ----------------

router.get('/custom-domains', admin, ctrl.listDomains);
router.patch('/custom-domains/:domainId/status', admin, ctrl.updateDomainStatus);

module.exports = router;
