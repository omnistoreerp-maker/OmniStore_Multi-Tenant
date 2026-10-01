'use strict';

// Platform Control Center — HTTP controller.
//
// Every handler assumes the platform authorization middleware already ran
// (requirePlatformPermission / requirePlatformRole). The resolved platform actor
// is attached to req.platformAdmin by the middleware — never derived from
// client input here.

const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const controlCenter = require('../services/platformControlCenter.service');

function _actor(req) {
  // req.platformAdmin is the server-resolved platform identity.
  const pa = req.platformAdmin || {};
  return {
    id: req.user ? req.user.id : null,
    username: pa.username || (req.user ? req.user.username : null)
  };
}

// GET /platform/control-center/access — role + effective permissions for the
// authenticated platform member (used to render role-aware navigation).
function access(req, res) {
  try {
    return success(res, controlCenter.access(req.platformAdmin), 'Platform access retrieved');
  } catch (err) {
    logger.error('platformCC.access error:', err.message);
    return error(res, 'Failed to retrieve platform access', 500);
  }
}

// GET /platform/control-center/dashboard
function dashboard(req, res) {
  try {
    return success(res, controlCenter.dashboard(), 'Platform dashboard retrieved');
  } catch (err) {
    logger.error('platformCC.dashboard error:', err.message);
    return error(res, 'Failed to retrieve platform dashboard', 500);
  }
}

// ---- team ----
function listTeam(req, res) {
  try {
    const team = controlCenter.listTeam();
    // `admins` is retained for backward compatibility with the existing
    // Master Control Center client; `team` is the richer Control Center view.
    return success(res, { admins: team, team }, 'Platform team retrieved');
  } catch (err) {
    logger.error('platformCC.listTeam error:', err.message);
    return error(res, 'Failed to retrieve platform team', 500);
  }
}

function addTeamMember(req, res) {
  try {
    const result = controlCenter.addTeamMember(_actor(req), req.body || {});
    if (result.error) return error(res, result.error, result.status || 400);
    // Legacy contract: POST /platform/admins answered 200 — kept as 200 so the
    // existing Master Control Center client and regression suite stay valid.
    return success(res, { admin: result.member, member: result.member }, 'Team member added');
  } catch (err) {
    logger.error('platformCC.addTeamMember error:', err.message);
    return error(res, 'Failed to add team member', 500);
  }
}

function updateTeamMember(req, res) {
  try {
    const result = controlCenter.updateTeamMember(_actor(req), req.params.username, req.body || {});
    if (result.error) return error(res, result.error, result.status || 400);
    return success(res, result, 'Team member updated');
  } catch (err) {
    logger.error('platformCC.updateTeamMember error:', err.message);
    return error(res, 'Failed to update team member', 500);
  }
}

function removeTeamMember(req, res) {
  try {
    const result = controlCenter.removeTeamMember(_actor(req), req.params.username);
    if (result.error) return error(res, result.error, result.status || 400);
    return success(res, result, 'Team member removed');
  } catch (err) {
    logger.error('platformCC.removeTeamMember error:', err.message);
    return error(res, 'Failed to remove team member', 500);
  }
}

function permissionMatrix(req, res) {
  try {
    return success(res, controlCenter.permissionMatrix(), 'Permission matrix retrieved');
  } catch (err) {
    logger.error('platformCC.permissionMatrix error:', err.message);
    return error(res, 'Failed to retrieve permission matrix', 500);
  }
}

// ---- diagnostics (developer) ----
function diagnostics(req, res) {
  try {
    return success(res, controlCenter.diagnostics(req.query.limit), 'Diagnostics retrieved');
  } catch (err) {
    logger.error('platformCC.diagnostics error:', err.message);
    return error(res, 'Failed to retrieve diagnostics', 500);
  }
}

function listDiagnosticErrors(req, res) {
  try {
    return success(res, { errors: controlCenter.listDiagnosticsErrors(req.query.limit) }, 'Diagnostic errors retrieved');
  } catch (err) {
    logger.error('platformCC.listDiagnosticErrors error:', err.message);
    return error(res, 'Failed to retrieve diagnostic errors', 500);
  }
}

// ---- content catalog (data entry) ----
function listCatalog(req, res) {
  try {
    return success(res, { entries: controlCenter.listCatalog(req.query || {}) }, 'Catalog retrieved');
  } catch (err) {
    logger.error('platformCC.listCatalog error:', err.message);
    return error(res, 'Failed to retrieve catalog', 500);
  }
}

function createCatalogEntry(req, res) {
  try {
    const result = controlCenter.createCatalogEntry(_actor(req), req.body || {});
    if (result.error) return error(res, result.error, result.status || 400);
    return success(res, result, 'Catalog entry created', 201);
  } catch (err) {
    logger.error('platformCC.createCatalogEntry error:', err.message);
    return error(res, 'Failed to create catalog entry', 500);
  }
}

function updateCatalogEntry(req, res) {
  try {
    const result = controlCenter.updateCatalogEntry(_actor(req), req.params.id, req.body || {});
    if (result.error) return error(res, result.error, result.status || 400);
    return success(res, result, 'Catalog entry updated');
  } catch (err) {
    logger.error('platformCC.updateCatalogEntry error:', err.message);
    return error(res, 'Failed to update catalog entry', 500);
  }
}

module.exports = {
  access,
  dashboard,
  listTeam, addTeamMember, updateTeamMember, removeTeamMember, permissionMatrix,
  diagnostics, listDiagnosticErrors,
  listCatalog, createCatalogEntry, updateCatalogEntry
};