'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantPayments.controller');
const { requireAuth } = require('../middleware/auth');

const auth = [requireAuth];

router.post('/payments/intent', auth, ctrl.createPaymentIntent);
router.get('/payments/:ref', auth, ctrl.getPaymentStatus);
router.get('/payments', auth, ctrl.listPayments);

router.post('/payments/webhook', ctrl.handlePaymentWebhook);

module.exports = router;
