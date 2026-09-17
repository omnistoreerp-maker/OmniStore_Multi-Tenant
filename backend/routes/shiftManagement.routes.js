'use strict';

const router = require('express').Router();
const ctrl = require('../controllers/shiftManagement.controller');
const asyncHandler = require('../utils/asyncHandler');
const { requirePermissionIfAuth } = require('../middleware/authorize');

router.post('/shifts/open', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.openShift));
router.patch('/shifts/:id/close', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.closeShift));
router.patch('/shifts/:id/add', requirePermissionIfAuth('settings.edit'), asyncHandler(ctrl.addToShift));
router.get('/shifts/current', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.getCurrentShift));
router.get('/shifts', requirePermissionIfAuth('settings.view'), asyncHandler(ctrl.listShifts));

router.post('/roles', requirePermissionIfAuth('users.permissions.edit'), asyncHandler(ctrl.setUserRole));
router.get('/roles/:userId', requirePermissionIfAuth('users.view'), asyncHandler(ctrl.getUserRole));
router.get('/roles', requirePermissionIfAuth('users.view'), asyncHandler(ctrl.listUserRoles));
router.get('/permissions/:userId/:permission', requirePermissionIfAuth('users.view'), asyncHandler(ctrl.checkPermission));

module.exports = router;
