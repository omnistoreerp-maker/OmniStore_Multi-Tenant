'use strict';

// gameHosting.routes — Phase B HTTP routes for Game Hosting.
//
// Mounted at /api/v1/game-hosting (added in server.js).
//
// All routes require:
//   - requireMarketTenant: validates the tenant from the X-Tenant-Id
//     header / query / body and sets req.marketTenant
//   - requireCustomer: validates the customer JWT and sets req.customer
//     (BLOCKED for some admin endpoints, but Phase B serves customers)
//
// Ownership model (per protocol §11):
//   Every server operation verifies the authenticated customer owns
//   the server. Cross-customer and cross-tenant access returns 404
//   (not 403) to prevent existence leaks.

const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const ctrl = require('../controllers/gameHosting.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireMarketTenant, requireCustomer } = require('../middleware/marketAuth');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: ipKeyGenerator,
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

// Provider status (public to authenticated customers)
router.get('/provider/status', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.providerStatus));

// Plans
router.get('/plans', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listPlans));
router.get('/plans/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.getPlan));
router.post('/plans', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createPlan));
router.put('/plans/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.updatePlan));
router.delete('/plans/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.deletePlan));

// Servers
router.get('/servers', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listServers));
router.get('/servers/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.getServer));
router.post('/servers', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createServer));
router.put('/servers/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.updateServer));
router.delete('/servers/:id', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.deleteServer));

// Server lifecycle actions
router.post('/servers/:id/start', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.startServer));
router.post('/servers/:id/stop', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.stopServer));
router.post('/servers/:id/terminate', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.terminateServer));

// Provisioning requests
router.get('/provisioning-requests', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.listProvisioningRequests));
router.post('/provisioning-requests', requireMarketTenant, requireCustomer, limiter, asyncHandler(ctrl.createProvisioningRequest));

module.exports = router;
