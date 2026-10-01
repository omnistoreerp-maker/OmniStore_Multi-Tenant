'use strict';

// ---------------------------------------------------------------------------
// TikTok Display API public surface — own router, own namespace.
//
// This router exists so the TikTok integration owns zero lines inside
// platformPublic.routes.js (main's boundary contract: that file must carry
// no reels/tiktok-reels surface at all) and can never shadow the tenant-scoped
// OmniStore Reels feed mounted at /api/v1/platform-public/reels
// (reels.routes.js — main feature, untouched by this integration).
//
// Mounted at /api/v1/platform-public, so every route below is served under
// /api/v1/platform-public/tiktok/*.
// ---------------------------------------------------------------------------

const router = require('express').Router();
const tiktokReelsCtrl = require('../controllers/tiktokReels.controller');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');

const isTest = process.env.NODE_ENV === 'test';

// Same public-feed limiter profile platformPublic.routes.js applies to its
// public GETs: 600 req / 15 min per IP in production, relaxed under tests.
const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTest ? 10000 : 600,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown'),
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

router.use(publicLimiter);

// Public TikTok Reels feed — display metadata only, no credentials. Global
// platform content: no companyId, no tenant scope, no tenant credentials.
router.get('/tiktok/reels', tiktokReelsCtrl.getReels);

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

router.get('/tiktok/connect', tiktokAdmin, tiktokReelsCtrl.startOAuth);
router.get('/tiktok/callback', tiktokAdmin, tiktokReelsCtrl.handleCallback);
router.get('/tiktok/status', tiktokAdmin, tiktokReelsCtrl.getConnectionStatus);
router.get('/tiktok/reels/status', tiktokAdmin, tiktokReelsCtrl.getReelsStatus);
router.post('/tiktok/sync', tiktokAdmin, tiktokReelsCtrl.triggerSync);
router.post('/tiktok/disconnect', tiktokAdmin, tiktokReelsCtrl.disconnect);

module.exports = router;
