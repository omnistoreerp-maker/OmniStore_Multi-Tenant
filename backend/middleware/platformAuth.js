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
const platformRegistry = require('../permissions/platformRegistry');

// Resolve the caller's ACTIVE platform membership from server-side state only.
// Returns { username, platformRole, permissions } or null. The username is taken
// from the authenticated token (re-validated against the REAL user record), and
// the platform role/permissions come exclusively from the platform store — never
// from query/body/headers/localStorage.
function _platformActor(req) {
  if (!req.user || !req.user.username) return null;
  const record = usersService.getByUsername(req.user.username);
  if (!record) return null;
  const role = platformAdmin.platformRoleFor(record.username);
  if (!role) return null;
  return {
    username: record.username,
    platformRole: role,
    permissions: platformAdmin.resolvePermissionsFor(record.username)
  };
}

// Legacy gate: full platform-administration reach (MASTER_OWNER / PLATFORM_ADMIN).
// The newer DEVELOPER / DATA_ENTRY roles are deliberately EXCLUDED here so they
// can never inherit the broad operations surface.
function requirePlatformAdmin() {
  return function platformAdminGate(req, res, next) {
    if (!req.user) return error(res, 'Authentication required', 401);
    const actor = _platformActor(req);
    if (!actor) return error(res, 'Platform administrator access required', 403, { code: 'PLATFORM_ADMIN_REQUIRED' });
    if (!platformRegistry.isPlatformAdminRole(actor.platformRole)) {
      return error(res, 'Platform administrator access required', 403, { code: 'PLATFORM_ADMIN_REQUIRED' });
    }
    req.platformAdmin = actor;
    return next();
  };
}

// Gate: the caller's platform role must be one of `roles` (any platform member).
function requirePlatformRole(...roles) {
  const allowed = roles.map(r => platformRegistry.normalizeRole(r));
  return function platformRoleGate(req, res, next) {
    if (!req.user) return error(res, 'Authentication required', 401);
    const actor = _platformActor(req);
    if (!actor) return error(res, 'Platform access required', 403, { code: 'PLATFORM_ACCESS_REQUIRED' });
    if (!allowed.includes(actor.platformRole)) {
      return error(res, 'Insufficient platform role', 403, { code: 'PLATFORM_ROLE_DENIED' });
    }
    req.platformAdmin = actor;
    return next();
  };
}

// Gate: granular platform permission, resolved server-side from the caller's
// ACTIVE platform membership (role defaults + owner-set overrides). A member
// without a platform role, or without the permission, receives 403 — the UI
// never decides authorization on its own.
function requirePlatformPermission(permission) {
  return function platformPermissionGate(req, res, next) {
    if (!req.user) return error(res, 'Authentication required', 401);
    const actor = _platformActor(req);
    if (!actor) return error(res, 'Platform access required', 403, { code: 'PLATFORM_ACCESS_REQUIRED' });
    if (!platformRegistry.hasPlatformPermission(actor.platformRole, permission, actor.permissions)) {
      return error(res, 'Insufficient platform permission', 403, { code: 'PLATFORM_PERMISSION_DENIED', permission });
    }
    req.platformAdmin = actor;
    return next();
  };
}

module.exports = { requirePlatformAdmin, requirePlatformRole, requirePlatformPermission };
