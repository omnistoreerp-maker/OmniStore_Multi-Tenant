'use strict';

const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const platform = require('../services/platform.service');
const presence = require('../services/presence.service');
const config = require('../config');
const platformAdminService = require('../services/platformAdmin.service');

function _actor(req) {
  return req.user ? { id: req.user.id, username: req.user.username } : null;
}

// POST /platform/presence/heartbeat — ANY authenticated user (not just
// platform admins) keeps their presence alive.
function heartbeat(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const { sessionId, branchId } = req.body || {};
    const result = presence.heartbeat({
      userId: req.user.id,
      username: req.user.username,
      tenantId: req.tenantContext ? req.tenantContext.tenantId : (req.user.tenantId || null),
      sessionId,
      branchId
    });
    if (result.error) return error(res, result.error, 400);
    success(res, { online: true, lastSeenAt: new Date().toISOString() }, 'Heartbeat received');
  } catch (err) {
    logger.error('platform.heartbeat error:', err.message);
    error(res, 'Failed to record heartbeat', 500);
  }
}

// GET /platform/me — platform identity for the authenticated user (only set
// when they are a platform admin; 404 otherwise so normal users get nothing).
function me(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const role = platformAdminService.platformRoleFor(req.user.username);
    if (!role) return error(res, 'Not a platform administrator', 404);
    success(res, { username: req.user.username, platformRole: role }, 'Platform identity retrieved');
  } catch (err) {
    logger.error('platform.me error:', err.message);
    error(res, 'Failed to retrieve platform identity', 500);
  }
}

function summary(req, res) {
  try {
    success(res, platform.summary(), 'Platform summary retrieved');
  } catch (err) {
    logger.error('platform.summary error:', err.message);
    error(res, 'Failed to retrieve platform summary', 500);
  }
}

function listCompanies(req, res) {
  try {
    success(res, { companies: platform.listCompanies() }, 'Companies retrieved');
  } catch (err) {
    logger.error('platform.listCompanies error:', err.message);
    error(res, 'Failed to retrieve companies', 500);
  }
}

function getCompanyDetails(req, res) {
  try {
    const details = platform.getCompanyDetails(req.params.id);
    if (!details) return error(res, 'Company not found', 404);
    success(res, details, 'Company details retrieved');
  } catch (err) {
    logger.error('platform.getCompanyDetails error:', err.message);
    error(res, 'Failed to retrieve company details', 500);
  }
}

function suspendCompany(req, res) {
  try {
    const result = platform.suspendCompany(_actor(req), req.params.id);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Company suspended');
  } catch (err) {
    logger.error('platform.suspendCompany error:', err.message);
    error(res, 'Failed to suspend company', 500);
  }
}

function activateCompany(req, res) {
  try {
    const result = platform.activateCompany(_actor(req), req.params.id);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Company activated');
  } catch (err) {
    logger.error('platform.activateCompany error:', err.message);
    error(res, 'Failed to activate company', 500);
  }
}

function listUsers(req, res) {
  try {
    success(res, { users: platform.listUsers() }, 'Users retrieved');
  } catch (err) {
    logger.error('platform.listUsers error:', err.message);
    error(res, 'Failed to retrieve users', 500);
  }
}

function disableUser(req, res) {
  try {
    const result = platform.disableUser(_actor(req), req.params.id);
    if (result.error) return error(res, result.error, result.status || 500, result.code ? { code: result.code } : null);
    success(res, result, 'User disabled');
  } catch (err) {
    logger.error('platform.disableUser error:', err.message);
    error(res, 'Failed to disable user', 500);
  }
}

function enableUser(req, res) {
  try {
    const result = platform.enableUser(_actor(req), req.params.id);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'User enabled');
  } catch (err) {
    logger.error('platform.enableUser error:', err.message);
    error(res, 'Failed to enable user', 500);
  }
}

function forceLogout(req, res) {
  try {
    const result = platform.forceLogout(_actor(req), req.params.id);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'User signed out');
  } catch (err) {
    logger.error('platform.forceLogout error:', err.message);
    error(res, 'Failed to force logout', 500);
  }
}

function resetPassword(req, res) {
  try {
    const { newPassword } = req.body || {};
    const result = platform.resetUserPassword(_actor(req), req.params.id, newPassword);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Password reset successfully');
  } catch (err) {
    logger.error('platform.resetPassword error:', err.message);
    error(res, 'Failed to reset password', 500);
  }
}

function listPresence(req, res) {
  try {
    success(res, { presence: presence.listPresence(config.platformOnlineTimeoutMs) }, 'Presence retrieved');
  } catch (err) {
    logger.error('platform.listPresence error:', err.message);
    error(res, 'Failed to retrieve presence', 500);
  }
}

function listLicenses(req, res) {
  try {
    success(res, { licenses: platform.listLicenses() }, 'Licenses retrieved');
  } catch (err) {
    logger.error('platform.listLicenses error:', err.message);
    error(res, 'Failed to retrieve licenses', 500);
  }
}

function setLicense(req, res) {
  try {
    const result = platform.setLicense(_actor(req), req.body || {});
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'License saved');
  } catch (err) {
    logger.error('platform.setLicense error:', err.message);
    error(res, 'Failed to save license', 500);
  }
}

function listIntegrations(req, res) {
  try {
    success(res, { integrations: platform.listIntegrations() }, 'Integrations retrieved');
  } catch (err) {
    logger.error('platform.listIntegrations error:', err.message);
    error(res, 'Failed to retrieve integrations', 500);
  }
}

function setIntegration(req, res) {
  try {
    const result = platform.setIntegration(_actor(req), req.body || {});
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Integration saved');
  } catch (err) {
    logger.error('platform.setIntegration error:', err.message);
    error(res, 'Failed to save integration', 500);
  }
}

function listAudit(req, res) {
  try {
    success(res, { entries: platform.listPlatformAudit(req.query.limit) }, 'Platform audit retrieved');
  } catch (err) {
    logger.error('platform.listAudit error:', err.message);
    error(res, 'Failed to retrieve platform audit', 500);
  }
}

function listAdmins(req, res) {
  try {
    success(res, { admins: platform.listPlatformAdmins() }, 'Platform admins retrieved');
  } catch (err) {
    logger.error('platform.listAdmins error:', err.message);
    error(res, 'Failed to retrieve platform admins', 500);
  }
}

function grantAdmin(req, res) {
  try {
    const result = platform.grantPlatformAdmin(_actor(req), req.body && req.body.username, req.body && req.body.platformRole);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Platform admin granted');
  } catch (err) {
    logger.error('platform.grantAdmin error:', err.message);
    error(res, 'Failed to grant platform admin', 500);
  }
}

function revokeAdmin(req, res) {
  try {
    const result = platform.revokePlatformAdmin(_actor(req), req.params.username);
    if (result.error) return error(res, result.error, result.status || 500);
    success(res, result, 'Platform admin revoked');
  } catch (err) {
    logger.error('platform.revokeAdmin error:', err.message);
    error(res, 'Failed to revoke platform admin', 500);
  }
}

module.exports = {
  heartbeat, me, summary,
  listCompanies, getCompanyDetails, suspendCompany, activateCompany,
  listUsers, disableUser, enableUser, forceLogout, resetPassword,
  listPresence, listLicenses, setLicense,
  listIntegrations, setIntegration,
  listAudit, listAdmins, grantAdmin, revokeAdmin
};
