'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/studentServicesPack.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.get('/rates', requirePermission('settings.view'), asyncHandler(ctrl.listRates));
router.post('/rates', requirePermission('settings.edit'), asyncHandler(ctrl.upsertRate));
router.delete('/rates/:id', requirePermission('settings.edit'), asyncHandler(ctrl.deleteRate));

router.post('/calculate', requirePermission('settings.view'), asyncHandler(ctrl.calculate));

router.get('/orders', requirePermission('settings.view'), asyncHandler(ctrl.listOrders));
router.post('/orders', requirePermission('settings.edit'), asyncHandler(ctrl.createOrder));
router.patch('/orders/:id/status', requirePermission('settings.edit'), asyncHandler(ctrl.updateOrderStatus));
router.post('/orders/:id/receipt', requirePermission('settings.edit'), asyncHandler(ctrl.sendReceipt));

router.get('/passes', requirePermission('settings.view'), asyncHandler(ctrl.listPasses));
router.post('/passes', requirePermission('settings.edit'), asyncHandler(ctrl.createPass));

router.get('/settings', requirePermission('settings.view'), asyncHandler(ctrl.getSettings));
router.put('/settings', requirePermission('settings.edit'), asyncHandler(ctrl.updateSettings));

module.exports = router;
