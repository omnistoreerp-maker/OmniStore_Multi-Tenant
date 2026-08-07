'use strict';

// Read-only company catalog routes (public).
// Exposes only GET endpoints for the login-time company selection. No create /
// update / delete routes exist — the catalog is a static JSON file.

const router = require('express').Router();
const ctrl = require('../controllers/company.controller');

router.get('/', ctrl.listCompanies);
router.get('/active', ctrl.getActive);
router.get('/:id', ctrl.getById);

module.exports = router;