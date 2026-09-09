'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/customerRequest.controller');
const { requireAuth } = require('../middleware/auth');

router.use(requireAuth);

router.get('/build', ctrl.getBuildIdentity);
router.get('/requests', ctrl.listRequests);
router.get('/requests/:id', ctrl.getRequest);
router.post('/requests', ctrl.createRequest);
router.post('/requests/:id/transition', ctrl.transitionStatus);
router.post('/requests/:id/verify', ctrl.verifyRequest);
router.post('/requests/:id/reopen', ctrl.reopenRequest);

module.exports = router;
