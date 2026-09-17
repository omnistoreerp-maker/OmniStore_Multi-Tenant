'use strict';

// Platform-scope authorization gate (Phase 33 — Master Control Center).
//
// requirePlatformAdmin() runs AFTER requireAuth and checks the REAL user
// record's username against the server-side platform admin store. It is
// completely independent from tenant roles: an Owner/Admin of a tenant is NOT
// a platform admin unless their username is in the platform store.
//
// It NEVER reads the tenant from query/body/header and NEVER consults
// ACTIVE_TENANT_ID — platform scope is explicit, server-side and separate.

const { error } = require('../utils/apiResponse');
const usersService = require('../services/users.service');
const platformAdmin = require('../services/platformAdmin.service');

function requirePlatformAdmin() {
  return function platformAdminGate(req, res, next) {
    if (!req.user) return error(res, 'Authentication required', 401);
    const record = usersService.getByUsername(req.user.username);
    if (!record) return error(res, 'Authentication required', 401);
    const role = platformAdmin.platformRoleFor(record.username);
    if (!role) return error(res, 'Platform administrator access required', 403, { code: 'PLATFORM_ADMIN_REQUIRED' });
    req.platformAdmin = { username: record.username, platformRole: role };
    return next();
  };
}

module.exports = { requirePlatformAdmin };
