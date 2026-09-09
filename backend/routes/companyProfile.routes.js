'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/companyProfile.controller');
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

router.get('/:companyId/profile', ctrl.getProfile);
router.get('/:companyId/profile/:section', ctrl.getProfileSection);

router.post('/:companyId/profile', ctrl.notFound);
router.put('/:companyId/profile', ctrl.notFound);
router.patch('/:companyId/profile', ctrl.notFound);
router.delete('/:companyId/profile', ctrl.notFound);

router.post('/:companyId/profile/:section', ctrl.notFound);
router.put('/:companyId/profile/:section', ctrl.notFound);
router.patch('/:companyId/profile/:section', ctrl.notFound);
router.delete('/:companyId/profile/:section', ctrl.notFound);

module.exports = router;
