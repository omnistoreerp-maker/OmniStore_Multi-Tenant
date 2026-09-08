'use strict';

// playstation.routes — PlayStation HTTP routes (Batch 1).
//
// Mounted at: /api/v1/playstation (registered in server.js).
//
// All routes require:
//   - requireMarketTenant: validates tenant from X-Tenant-Id and sets req.marketTenant
//   - requireCustomer: validates customer JWT and sets req.customer

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const asyncHandler = require('../utils/asyncHandler');
const ctrl = require('../controllers/playstation.controller');
const { requireMarketTenant, requireCustomer } = require('../middleware/marketAuth');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

// === Devices ===

router.get('/devices', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listDevices));
router.get('/devices/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.getDevice));
router.post('/devices', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createDevice));
router.put('/devices/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.updateDevice));
router.post('/devices/:id/transition', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.transitionDevice));
router.delete('/devices/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.deleteDevice));

// === Pricing ===

router.get('/pricing', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listPricing));
router.get('/pricing/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.getPricing));
router.post('/pricing', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createPricing));
router.put('/pricing/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.updatePricing));
router.delete('/pricing/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.deletePricing));

// === Sessions ===

router.get('/sessions', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listSessions));
router.get('/sessions/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.getSession));
router.post('/sessions', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createSession));
router.post('/sessions/:id/start', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.startSession));
router.post('/sessions/:id/stop', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.stopSession));
router.post('/sessions/:id/cancel', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.cancelSession));

module.exports = router;
