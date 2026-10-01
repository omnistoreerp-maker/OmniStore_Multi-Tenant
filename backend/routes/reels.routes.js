'use strict';

const express = require('express');
const router = express.Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { requireMarketTenant, requireOperator } = require('../middleware/marketAuth');
const ctrl = require('../controllers/reels.controller');
const reelsService = require('../services/reels.service');
const { error } = require('../utils/apiResponse');

const isTest = process.env.NODE_ENV === 'test';

// Upload surface is rate limited per IP (stricter than the read feed).
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown'),
  message: { success: false, message: 'Too many upload attempts, please try again later', data: null }
});

// ---------------------------- public read feed -----------------------------
// Tenant context is resolved server-side by requireMarketTenant (header or
// query); no handler ever reads a tenant id from the request body.
router.get('/', requireMarketTenant, ctrl.getReels);
router.get('/media/:tenantId/:fileName', requireMarketTenant, ctrl.serveMedia);
router.get('/:id', requireMarketTenant, ctrl.getReelById);

// --------------------------- operator writes ------------------------------
// Creating a reel and uploading media both require a real operator token for
// this tenant (requireOperator compares the token tenant with req.marketTenant
// and answers 'Tenant mismatch' with 403 on cross-tenant attempts).
router.post('/', requireMarketTenant, requireOperator, ctrl.createReel);

// Raw-bytes upload only: multipart/form-data is NOT parsed anywhere on this
// surface (rejected 415 by the controller), so no multipart parser dependency
// is introduced. The body is bounded by limits: (express.raw -> entity too
// large -> 413) and further checked against MAX_UPLOAD_BYTES.
router.post(
  '/media',
  requireMarketTenant,
  requireOperator,
  uploadLimiter,
  express.raw({
    type: Object.keys(reelsService.ALLOWED_MIME),
    limits: { fileSize: reelsService.MAX_UPLOAD_BYTES }
  }),
  ctrl.uploadMedia
);

// ------------------------ no other write verbs ----------------------------
// The public feed exposes no PUT/PATCH/DELETE surface at all: anonymous or
// arbitrary writes are refused before any handler runs.
function noWrite(req, res) {
  return error(res, 'Not found', 404);
}
router.put('/', noWrite);
router.patch('/', noWrite);
router.delete('/', noWrite);
router.put('/media', noWrite);
router.patch('/media', noWrite);
router.delete('/media', noWrite);

module.exports = router;
