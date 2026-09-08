'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/platformIntegration.controller');
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

// ERP ↔ Platform Integration Contract endpoints.
// All endpoints are read-only and public (no auth required) for now.
// Tenant scope is enforced server-side via the companyId path parameter.
// Client-supplied tenant headers/query params are ignored.

router.get('/companies', ctrl.listActiveCompanies);
router.get('/company/:companyId', ctrl.getCompany);
router.get('/company/:companyId/products', ctrl.listProducts);
router.get('/company/:companyId/products/:productId', ctrl.getProduct);
router.get('/company/:companyId/services', ctrl.listServices);
router.get('/company/:companyId/offers', ctrl.listOffers);
router.get('/company/:companyId/products/:productId/availability', ctrl.getAvailability);

const notFound = (req, res) => res.status(404).end();
router.post('/companies', notFound);
router.put('/companies', notFound);
router.patch('/companies', notFound);
router.delete('/companies', notFound);
router.post('/company/:companyId', notFound);
router.put('/company/:companyId', notFound);
router.patch('/company/:companyId', notFound);
router.delete('/company/:companyId', notFound);
router.post('/company/:companyId/products', notFound);
router.put('/company/:companyId/products', notFound);
router.patch('/company/:companyId/products', notFound);
router.delete('/company/:companyId/products', notFound);
router.post('/company/:companyId/products/:productId', notFound);
router.put('/company/:companyId/products/:productId', notFound);
router.patch('/company/:companyId/products/:productId', notFound);
router.delete('/company/:companyId/products/:productId', notFound);
router.post('/company/:companyId/services', notFound);
router.put('/company/:companyId/services', notFound);
router.patch('/company/:companyId/services', notFound);
router.delete('/company/:companyId/services', notFound);
router.post('/company/:companyId/offers', notFound);
router.put('/company/:companyId/offers', notFound);
router.patch('/company/:companyId/offers', notFound);
router.delete('/company/:companyId/offers', notFound);
router.post('/company/:companyId/products/:productId/availability', notFound);
router.put('/company/:companyId/products/:productId/availability', notFound);
router.patch('/company/:companyId/products/:productId/availability', notFound);
router.delete('/company/:companyId/products/:productId/availability', notFound);

module.exports = router;
