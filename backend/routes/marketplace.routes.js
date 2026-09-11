'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/marketplace.controller');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');

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

// Public read-only marketplace discovery endpoints.
// Tenant scope is enforced server-side via companyId.
// Client-supplied tenant headers/query params are ignored.

router.get('/companies', ctrl.listCompanies);
router.get('/company/:companyId/products', ctrl.listCompanyProducts);

const notFound = (req, res) => res.status(404).end();
router.post('/companies', notFound);
router.put('/companies', notFound);
router.patch('/companies', notFound);
router.delete('/companies', notFound);
router.post('/company/:companyId/products', notFound);
router.put('/company/:companyId/products', notFound);
router.patch('/company/:companyId/products', notFound);
router.delete('/company/:companyId/products', notFound);

module.exports = router;
