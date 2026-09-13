'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/onlineStore.controller');
const asyncHandler = require('../utils/asyncHandler');

router.get('/store/config', asyncHandler(ctrl.getStoreConfig));
router.put('/store/config', asyncHandler(ctrl.upsertStoreConfig));

router.get('/store/public/configs', asyncHandler(ctrl.listStoreConfigs));
router.get('/store/public/:storeSlug', asyncHandler(ctrl.getStoreBySlug));

router.post('/store/orders', asyncHandler(ctrl.createOrder));
router.get('/store/orders/:id', asyncHandler(ctrl.getOrder));
router.get('/store/orders', asyncHandler(ctrl.listOrders));
router.patch('/store/orders/:id/status', asyncHandler(ctrl.updateOrderStatus));

module.exports = router;
