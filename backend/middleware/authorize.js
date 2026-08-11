const { error: errorResponse } = require('../utils/apiResponse');
const config = require('../config');
const usersService = require('../services/users.service');
const tenantRole = require('../services/tenantRole.service');
const authorization = require('../services/authorization.service');

// Phase 20 — Tenant-scoped authorization resolution.
//
// When ENABLE_TENANT_ROLES is enabled AND a valid tenant context is present on
// the request, the *effective role* the user acts as in that tenant is resolved
// from the REAL user record (per-tenant role, or global `role` fallback — never
// invented) and exposed as `req.user.effectiveRole`. The gates below then gate
// on the effective role instead of the raw global role.
//
// Deliberately narrow — the pre-Phase-20 behavior is untouched whenever any of
// these holds:
//   - Feature OFF            -> total no-op (GoLive-1: gate on req.user.role).
//   - No valid tenant context (legacy token, no tenant, unknown/inactive tenancy)
//                              -> gate on req.user.role.
//   - Token tenant claim and reconstructed context disagree -> gate on
//                              req.user.role (never escalates).
//   - Username absent / user record missing -> gate on req.user.role.
//
// The tenant is consumed exclusively from server-side state: the signed token
// claim (req.user.tenantId, set by auth middleware) and the reconstructed
// req.tenantContext (tenantCarry). It is NEVER taken from query/body/header.
function resolveTenantRoleForRequest(req) {
  if (!config.tenantRolesEnabled) return undefined;
  if (req.__tenantAuthResolved) return req.user ? req.user.effectiveRole : undefined;
  req.__tenantAuthResolved = true;
  const user = req.user;
  if (!user) return undefined;
  const contextTenantId = req.tenantContext ? String(req.tenantContext.tenantId) : undefined;
  if (!contextTenantId) return undefined;
  if (user.tenantId !== undefined && user.tenantId !== null && String(user.tenantId) !== contextTenantId) {
    return undefined;
  }
  if (!user.username) return undefined;
  const record = usersService.getByUsername(user.username);
  if (!record) return undefined;
  const effective = tenantRole.resolveEffectiveRole(record, contextTenantId);
  if (effective !== undefined && effective !== null) user.effectiveRole = effective;
  return effective;
}

// Role gate: 401 when unauthenticated, 403 when the role is not allowed.
function requireRole(...roles) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    const effective = resolveTenantRoleForRequest(req);
    const role = effective !== undefined ? effective : req.user.role;
    if (!roles.includes(role)) {
      return errorResponse(res, 'Insufficient role', 403);
    }
    next();
  };
}

// Identity without a resolvable user-record username: gate on the permissions
// carried on the request (legacy behavior; used by header-driven test stubs).
function resolveActor(req) {
  if (req.__resolvedActor !== undefined) return req.__resolvedActor;
  req.__resolvedActor = null;
  if (!req.user || !req.user.username) return req.__resolvedActor;
  const record = usersService.getByUsername(req.user.username);
  if (record) req.__resolvedActor = record;
  return req.__resolvedActor;
}

// The trusted tenant for the request: the reconstructed tenant context when
// present, else the tenant claim signed into the token. Never from query/body.
function trustedTenantId(req) {
  if (req.tenantContext && req.tenantContext.tenantId != null) return String(req.tenantContext.tenantId);
  if (req.user && req.user.tenantId != null) return String(req.user.tenantId);
  return undefined;
}

// Permission gate: Owner/Admin (by effective role) bypass. For a resolvable
// real user, access is decided by the authorization engine against the REAL
// user record, scoped to the trusted tenant. Synthetic identities (no
// username) keep the legacy permissions-array check.
function requirePermission(permission) {
  return function (req, res, next) {
    if (!req.user) return errorResponse(res, 'Authentication required', 401);
    const effective = resolveTenantRoleForRequest(req);
    const role = effective !== undefined ? effective : req.user.role;
    if (role === 'Owner' || role === 'Admin') return next();

    const actor = resolveActor(req);
    if (!actor) {
      const perms = Array.isArray(req.user.permissions) ? req.user.permissions : [];
      if (perms.includes('all') || perms.includes(permission)) return next();
      return errorResponse(res, 'Insufficient permission', 403, { code: 'PERMISSION_DENIED' });
    }

    const tenantId = effective !== undefined ? trustedTenantId(req) : undefined;
    if (authorization.hasPermission(actor, permission, tenantId)) return next();
    return errorResponse(res, 'Insufficient permission', 403, { code: 'PERMISSION_DENIED' });
  };
}

// Write gate: non-GET requests restricted to the given roles.
function writeRoleGuard(...roles) {
  return function (req, res, next) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    return requireRole(...roles)(req, res, next);
  };
}

module.exports = { requireRole, requirePermission, writeRoleGuard, resolveTenantRoleForRequest, trustedTenantId };
