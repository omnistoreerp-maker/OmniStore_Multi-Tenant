'use strict';

// Company catalog routes.
//   GET  (public)          — login-time company selection catalog (read-only).
//   POST /provision (auth) — create a brand-new independent company/tenant
//                            (Settings → Company Management → تهيئة شركة جديدة).
//                            Requires the `company.create` permission (Owner /
//                            Admin bypass via requirePermission).

const router = require('express').Router();
const ctrl = require('../controllers/company.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requireAuth } = require('../middleware/auth');
const { requirePermission } = require('../middleware/authorize');

router.get('/', ctrl.listCompanies);
router.get('/active', ctrl.getActive);
router.get('/:id', ctrl.getById);

router.post('/provision', requireAuth, requirePermission('company.create'), asyncHandler(ctrl.provision));

module.exports = router;