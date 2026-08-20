'use strict';

const updateService = require('../services/update.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');

// Public: current version + update availability. Never leaks secrets.
function getManifest(req, res) {
  try {
    success(res, updateService.getManifest(), 'Update manifest retrieved');
  } catch (err) {
    logger.error('update.manifest error:', err.message);
    error(res, 'Failed to retrieve update manifest', 500);
  }
}

// Admin-gated: launches the detached updater process. The requester must be an
// authenticated Owner/Admin/Manager (role from the trusted token — the
// per-tenant effective role takes precedence over the raw global role). The
// route-level requireRole gate already resolves the effective role; this
// inline check is defense-in-depth.
function apply(req, res) {
  const user = req.user;
  if (!user) return error(res, 'Authentication required', 401);
  const resolved = user.effectiveRole !== undefined && user.effectiveRole !== null ? user.effectiveRole : user.role;
  const role = String(resolved || '').toLowerCase();
  if (!['owner', 'admin', 'manager'].includes(role)) {
    return error(res, 'Insufficient permissions to apply an update', 403);
  }
  try {
    const result = updateService.launchUpdater();
    if (!result.started) return error(res, result.error || 'Update could not be started', 500);
    success(res, { started: true, logFile: result.logFile || '' }, 'Update started', 202);
  } catch (err) {
    logger.error('update.apply error:', err.message);
    error(res, 'Failed to start update', 500);
  }
}

module.exports = { getManifest, apply };
