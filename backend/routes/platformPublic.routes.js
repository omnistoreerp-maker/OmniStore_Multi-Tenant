'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/platformPublic.controller');
const tiktokCtrl = require('../controllers/tiktokFeed.controller');
const reelsCtrl = require('../controllers/reels.controller');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { error: errorResponse } = require('../utils/apiResponse');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');
const config = require('../config');

const isTest = process.env.NODE_ENV === 'test';
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown'),
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

router.use(publicLimiter);

// Stricter limit for public company provisioning to reduce abuse surface.
const provisionLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
  },
  message: { success: false, message: 'Too many provisioning attempts, please try again later', data: null }
});

// Heartbeat limiter: 1 req/sec per IP, enough for the 60s browser cadence.
const heartbeatLimiter = rateLimit({
  windowMs: 1 * 1000,
  max: isTest ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown'),
  message: { success: false, message: 'Too many heartbeats, please try again later', data: null }
});

router.get('/catalog', ctrl.getCatalog);
router.get('/features', ctrl.getFeatures);
router.get('/stats', ctrl.getStats);
router.get('/highlights', ctrl.getHighlights);
router.get('/sections', ctrl.getSections);
router.get('/pricing', ctrl.getPricing);
router.get('/social-feed/tiktok', tiktokCtrl.getTikTokFeed);

// Public Reels feed — display metadata only, no credentials. Global platform
// content: no companyId, no tenant scope, no tenant credentials.
router.get('/reels', reelsCtrl.getReels);

// ---------------------------------------------------------------------------
// TikTok Display API connection — PLATFORM-ADMIN GATED.
//
// This integration owns ONE global account for the whole platform. Everything
// that can create, replace, refresh, inspect or destroy that connection is
// restricted to platform administrators (server-side store, independent of
// tenant roles). Left public, any anonymous visitor could complete the OAuth
// dance and repoint OmniStore's public Reels feed at their own TikTok
// account, or simply disconnect it.
//
// /tiktok/callback is gated too: the auth cookie is SameSite=Lax, so TikTok's
// top-level GET redirect carries it. The controller additionally enforces the
// single-use state bound to the admin who started the flow.
// ---------------------------------------------------------------------------
const tiktokAdmin = [requireAuth, requirePlatformAdmin()];

router.get('/tiktok/connect', tiktokAdmin, reelsCtrl.startOAuth);
router.get('/tiktok/callback', tiktokAdmin, reelsCtrl.handleCallback);
router.get('/tiktok/status', tiktokAdmin, reelsCtrl.getConnectionStatus);
router.get('/reels/status', tiktokAdmin, reelsCtrl.getReelsStatus);
router.post('/tiktok/sync', tiktokAdmin, reelsCtrl.triggerSync);
router.post('/tiktok/disconnect', tiktokAdmin, reelsCtrl.disconnect);

router.post('/', ctrl.notFound);
router.put('/', ctrl.notFound);
router.patch('/', ctrl.notFound);
router.delete('/', ctrl.notFound);

router.post('/catalog', ctrl.notFound);
router.put('/catalog', ctrl.notFound);
router.patch('/catalog', ctrl.notFound);
router.delete('/catalog', ctrl.notFound);

router.post('/features', ctrl.notFound);
router.put('/features', ctrl.notFound);
router.patch('/features', ctrl.notFound);
router.delete('/features', ctrl.notFound);

router.post('/stats', ctrl.notFound);
router.put('/stats', ctrl.notFound);
router.patch('/stats', ctrl.notFound);
router.delete('/stats', ctrl.notFound);

router.post('/highlights', ctrl.notFound);
router.put('/highlights', ctrl.notFound);
router.patch('/highlights', ctrl.notFound);
router.delete('/highlights', ctrl.notFound);

router.post('/sections', ctrl.notFound);
router.put('/sections', ctrl.notFound);
router.patch('/sections', ctrl.notFound);
router.delete('/sections', ctrl.notFound);

// Public payment intents for unauthenticated checkout / pricing page.
const paymentLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown'),
  message: { success: false, message: 'Too many payment attempts, please try again later', data: null }
});
router.post('/payments/intent', paymentLimiter, ctrl.createPublicPaymentIntent);
router.put('/payments/intent', ctrl.notFound);
router.patch('/payments/intent', ctrl.notFound);
router.delete('/payments/intent', ctrl.notFound);

router.post('/activity/heartbeat', heartbeatLimiter, ctrl.activityHeartbeat);

router.post('/onboarding/provision', provisionLimiter, ctrl.provisionCompany);

module.exports = router;
