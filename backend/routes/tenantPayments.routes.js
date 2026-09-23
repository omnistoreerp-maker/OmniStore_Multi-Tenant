'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/tenantPayments.controller');
const { requireAuth } = require('../middleware/auth');
const { verifyPaymentsWebhookSignature } = require('../middleware/verifyPaymentsWebhookSignature');

const auth = [requireAuth];

router.post('/payments/intent', auth, ctrl.createPaymentIntent);
router.get('/payments/:ref', auth, ctrl.getPaymentStatus);
router.get('/payments', auth, ctrl.listPayments);

// Gateway-facing webhook: can flip a transaction to paid and auto-activate
// add-ons, so it is guarded by HMAC signature verification (fail-closed when
// PAYMENTS_WEBHOOK_SECRET is not configured).
router.post('/payments/webhook', verifyPaymentsWebhookSignature, ctrl.handlePaymentWebhook);

module.exports = router;
