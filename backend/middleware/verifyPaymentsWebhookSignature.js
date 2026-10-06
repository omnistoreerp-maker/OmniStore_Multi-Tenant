'use strict';

// verifyPaymentsWebhookSignature — HMAC-SHA256 guard for the tenant payments
// webhook (O2). The webhook can flip a transaction to paid and auto-activate
// a tenant add-on, so it MUST NOT be publicly callable.
//
// Contract:
//   - Signature arrives as a hex HMAC-SHA256 of the RAW request body in the
//     x-payments-signature header.
//   - The raw body is captured by the express.json verify hook registered in
//     server.js (req.rawBody) BEFORE any body parsing, so JSON re-serialization
//     can never change the bytes that were signed.
//   - PAYMENTS_WEBHOOK_SECRET is required. Without it the webhook is disabled
//     entirely (403) — an unsigned payment webhook must never be able to
//     activate add-ons.
//
// Comparison is timing-safe via crypto.timingSafeEqual.

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

const SIGNATURE_HEADER = 'x-payments-signature';

function verifyPaymentsWebhookSignature(req, res, next) {
  const secret = config.paymentsWebhookSecret;
  if (!secret) {
    // No secret configured: the webhook surface is closed. Fail closed —
    // never let an unsigned request drive payment state.
    return res.status(403).json({
      success: false,
      message: 'Payment webhook is not configured',
      data: null
    });
  }

  const provided = req.headers[SIGNATURE_HEADER];
  if (!provided || typeof provided !== 'string') {
    return res.status(401).json({
      success: false,
      message: 'Missing payment webhook signature',
      data: null
    });
  }

  const rawBody = req.rawBody && Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.alloc(0);

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const a = Buffer.from(provided.trim().toLowerCase(), 'utf8');
  const b = Buffer.from(expected, 'utf8');
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    logger.warn('verifyPaymentsWebhookSignature: invalid webhook signature');
    return res.status(401).json({
      success: false,
      message: 'Invalid payment webhook signature',
      data: null
    });
  }

  next();
}

module.exports = { verifyPaymentsWebhookSignature, SIGNATURE_HEADER };
