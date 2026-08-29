const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const ctrl = require('../controllers/market.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireMarketTenant, requireCustomer, optionalCustomer } = require('../middleware/marketAuth');

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
    const email = (req.body && req.body.email) ? String(req.body.email).toLowerCase() : '';
    return String(ip) + ':' + email;
  },
  message: { success: false, message: 'Too many attempts, please try again later', data: null }
});

const checkoutLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    const ip = ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
    const tid = (req.body && req.body.tenantId) ? String(req.body.tenantId) : '';
    return String(ip) + ':' + tid;
  },
  message: { success: false, message: 'Too many orders, please try again later', data: null }
});

const trackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator(req) {
    return ipKeyGenerator(req.ip || req.connection.remoteAddress || 'unknown');
  },
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

const publicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later', data: null }
});

router.get('/config', requireMarketTenant, asyncHandler(ctrl.config));
router.get('/products', requireMarketTenant, publicLimiter, asyncHandler(ctrl.listProducts));
router.get('/products/:id', requireMarketTenant, publicLimiter, asyncHandler(ctrl.getProduct));
router.get('/categories', requireMarketTenant, publicLimiter, asyncHandler(ctrl.categories));
router.get('/search', requireMarketTenant, publicLimiter, asyncHandler(ctrl.search));
router.get('/availability', requireMarketTenant, publicLimiter, asyncHandler(ctrl.availability));

router.post('/auth/register', requireMarketTenant, authLimiter, asyncHandler(ctrl.register));
router.post('/auth/login', requireMarketTenant, authLimiter, asyncHandler(ctrl.login));
router.post('/auth/logout', requireMarketTenant, requireCustomer, asyncHandler(ctrl.logout));
router.get('/auth/me', requireMarketTenant, requireCustomer, asyncHandler(ctrl.me));
router.put('/customers/me', requireMarketTenant, requireCustomer, asyncHandler(ctrl.updateProfile));
router.post('/customers/me/password', requireMarketTenant, requireCustomer, asyncHandler(ctrl.changePassword));

router.post('/checkout', requireMarketTenant, optionalCustomer, checkoutLimiter, asyncHandler(ctrl.checkout));

router.get('/track/:token', trackLimiter, asyncHandler(ctrl.track));

router.get('/orders', requireMarketTenant, requireCustomer, asyncHandler(ctrl.myOrders));
router.get('/orders/:id', requireMarketTenant, requireCustomer, asyncHandler(ctrl.myOrder));

module.exports = router;
