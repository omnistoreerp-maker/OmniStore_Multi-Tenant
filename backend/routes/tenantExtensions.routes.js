'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantExtensions.controller');
const { requireAuth } = require('../middleware/auth');

const auth = [requireAuth];

// ---------------- add-ons ----------------

router.get('/addons', auth, ctrl.listMyAddons);
router.post('/addons', auth, ctrl.upsertMyAddon);
router.delete('/addons/:addonKey', auth, ctrl.deleteMyAddon);

// ---------------- custom domains ----------------

router.get('/custom-domains', auth, ctrl.listMyCustomDomains);
router.post('/custom-domains', auth, ctrl.registerMyCustomDomain);

module.exports = router;
