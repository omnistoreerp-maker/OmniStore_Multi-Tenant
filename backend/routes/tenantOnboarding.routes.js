'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantOnboarding.controller');
const { requireAuth } = require('../middleware/auth');

router.get('/status', requireAuth, ctrl.getStatus);
router.post('/complete', requireAuth, ctrl.complete);
router.post('/seed-demo', requireAuth, ctrl.seedDemo);

module.exports = router;
