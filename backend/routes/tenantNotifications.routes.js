'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantNotifications.controller');
const { requireAuth } = require('../middleware/auth');

const auth = [requireAuth];

router.get('/settings', auth, ctrl.getSettings);
router.put('/settings', auth, ctrl.updateSettings);
router.post('/telegram/test', auth, ctrl.testTelegram);

module.exports = router;
