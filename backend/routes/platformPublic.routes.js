'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/platformPublic.controller');
const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = require('express-rate-limit');
const { error: errorResponse } = require('../utils/apiResponse');
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

router.get('/catalog', ctrl.getCatalog);
router.get('/features', ctrl.getFeatures);
router.get('/stats', ctrl.getStats);
router.get('/highlights', ctrl.getHighlights);

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

module.exports = router;
