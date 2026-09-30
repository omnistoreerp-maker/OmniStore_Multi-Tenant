'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/internalChangeCenter.controller');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAuth');

// All internal change center routes require platform admin access
const admin = [requireAuth, requirePlatformAdmin()];

router.get('/dashboard', admin, ctrl.getDashboard);
router.get('/changes', admin, ctrl.listChanges);
router.get('/changes/:id', admin, ctrl.getChange);
router.post('/changes/:id/transition', admin, ctrl.transitionChange);
router.post('/changes/:id/notes', admin, ctrl.addChangeNote);
router.get('/releases', admin, ctrl.listReleases);
router.get('/releases/:id', admin, ctrl.getRelease);
router.post('/releases', admin, ctrl.registerRelease);

module.exports = router;
