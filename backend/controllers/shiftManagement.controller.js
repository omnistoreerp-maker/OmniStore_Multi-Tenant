'use strict';

const { success, error } = require('../utils/apiResponse');
const shiftManagement = require('../services/shiftManagement.service');
const logger = require('../utils/logger');

function _resolveTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId) return String(req.user.tenantId);
  return null;
}

function _cashierId(req) {
  if (req.user && req.user.id) return String(req.user.id);
  return null;
}

async function openShift(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const cashierId = _cashierId(req) || req.body.cashierId;
    const cashierName = req.user ? (req.user.fullName || req.user.username) : req.body.cashierName;
    const shift = shiftManagement.openShift({ tenantId }, cashierId, cashierName, req.body.openingCash, req.body.notes);
    success(res, shift, 'Shift opened', 201);
  } catch (err) {
    logger.error('shiftManagement.openShift error:', err.message);
    error(res, err.message || 'Failed to open shift', 400);
  }
}

async function closeShift(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const result = shiftManagement.closeShift({ tenantId }, req.params.id, req.body.actualCash, req.body.notes);
    success(res, result, 'Shift closed');
  } catch (err) {
    logger.error('shiftManagement.closeShift error:', err.message);
    error(res, err.message || 'Failed to close shift', 400);
  }
}

async function addToShift(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const result = shiftManagement.addToShift({ tenantId }, req.params.id, req.body.amount);
    success(res, result, 'Shift updated');
  } catch (err) {
    logger.error('shiftManagement.addToShift error:', err.message);
    error(res, err.message || 'Failed to update shift', 400);
  }
}

async function getCurrentShift(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const cashierId = _cashierId(req);
    const shift = shiftManagement.getCurrentShift({ tenantId }, cashierId);
    success(res, shift || null, 'Current shift retrieved');
  } catch (err) {
    logger.error('shiftManagement.getCurrentShift error:', err.message);
    error(res, 'Failed to retrieve current shift', 500);
  }
}

async function listShifts(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const query = {
      status: req.query.status,
      cashierId: req.query.cashierId,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = shiftManagement.listShifts({ tenantId }, query);
    success(res, result, 'Shifts retrieved');
  } catch (err) {
    logger.error('shiftManagement.listShifts error:', err.message);
    error(res, 'Failed to retrieve shifts', 500);
  }
}

async function setUserRole(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const userId = (req.body && req.body.userId) || (req.params && req.params.userId);
    if (!userId) return error(res, 'userId is required', 400);
    const data = req.body || {};
    const record = shiftManagement.setUserRole({ tenantId }, String(userId), data.role, data.permissions);
    success(res, record, 'User role saved');
  } catch (err) {
    logger.error('shiftManagement.setUserRole error:', err.message);
    error(res, err.message || 'Failed to save user role', 400);
  }
}

async function getUserRole(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const { userId } = req.params;
    const record = shiftManagement.getUserRole({ tenantId }, userId);
    success(res, record || null, 'User role retrieved');
  } catch (err) {
    logger.error('shiftManagement.getUserRole error:', err.message);
    error(res, 'Failed to retrieve user role', 500);
  }
}

async function listUserRoles(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const query = {
      role: req.query.role,
      page: req.query.page,
      limit: req.query.limit
    };
    const result = shiftManagement.listUserRoles({ tenantId }, query);
    success(res, result, 'User roles retrieved');
  } catch (err) {
    logger.error('shiftManagement.listUserRoles error:', err.message);
    error(res, 'Failed to retrieve user roles', 500);
  }
}

async function checkPermission(req, res) {
  try {
    const tenantId = _resolveTenantId(req);
    if (!tenantId) return error(res, 'Tenant context required', 400);
    const userId = req.params.userId || _cashierId(req);
    if (!userId) return error(res, 'userId is required', 400);
    const permission = req.params.permission;
    if (!permission) return error(res, 'permission is required', 400);
    const allowed = shiftManagement.hasPermission({ tenantId }, userId, permission);
    success(res, { allowed }, 'Permission checked');
  } catch (err) {
    logger.error('shiftManagement.checkPermission error:', err.message);
    error(res, 'Failed to check permission', 500);
  }
}

module.exports = {
  openShift,
  closeShift,
  addToShift,
  getCurrentShift,
  listShifts,
  setUserRole,
  getUserRole,
  listUserRoles,
  checkPermission
};
