'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/studentServicesPack.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

router.get('/rates', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.listRates));
router.post('/rates', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.upsertRate));
router.delete('/rates/:id', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.deleteRate));

router.post('/calculate', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.calculate));

router.get('/orders', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.listOrders));
router.post('/orders', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.createOrder));
router.patch('/orders/:id/status', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.updateOrderStatus));
router.post('/orders/:id/receipt', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.sendReceipt));

router.get('/passes', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.listPasses));
router.post('/passes', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.createPass));

router.get('/settings', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.getSettings));
router.put('/settings', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.updateSettings));

module.exports = router;
