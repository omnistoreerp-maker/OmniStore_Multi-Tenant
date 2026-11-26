'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/shiftManagement.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermission } = require('../middleware/authorize');

router.post('/shifts/open', requirePermission('settings.edit'), asyncHandler(ctrl.openShift));
router.patch('/shifts/:id/close', requirePermission('settings.edit'), asyncHandler(ctrl.closeShift));
router.patch('/shifts/:id/add', requirePermission('settings.edit'), asyncHandler(ctrl.addToShift));
router.get('/shifts/current', requirePermission('settings.view'), asyncHandler(ctrl.getCurrentShift));
router.get('/shifts', requirePermission('settings.view'), asyncHandler(ctrl.listShifts));

router.post('/roles', requirePermission('users.permissions.edit'), asyncHandler(ctrl.setUserRole));
router.get('/roles/:userId', requirePermission('users.view'), asyncHandler(ctrl.getUserRole));
router.get('/roles', requirePermission('users.view'), asyncHandler(ctrl.listUserRoles));
router.get('/permissions/:userId/:permission', requirePermission('users.view'), asyncHandler(ctrl.checkPermission));

module.exports = router;
