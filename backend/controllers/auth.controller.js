const usersService = require('../services/users.service');
const mfaService = require('../services/mfa.service');
const config = require('../config');
const tenantMembership = require('../services/tenantMembership.service');
const tenantRole = require('../services/tenantRole.service');
const authorization = require('../services/authorization.service');
const auditService = require('../services/audit.service');
const CompanyService = require('../services/company.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { revokeToken, isRevoked } = require('../utils/tokenStore');
const { extractToken, parseCookies } = require('../middleware/auth');
const { verifyPassword } = require('../utils/password');
const { validatePassword } = require('../utils/passwordPolicy');

const KNOWN_ROLES = ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician', 'WarehouseSales'];
const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

// Phase 22B: only the account owner, or Owner/Admin users, may view a
// specific user's record through the username-lookup endpoints. This closes
// the unauthenticated enumeration path that returned 200-vs-404 by username.
function _canViewUser(requester, username) {
  if (!requester) return false;
  if (String(username) === String(requester.username)) return true;
  return requester.role === 'Owner' || requester.role === 'Admin';
}

function _setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function _clearAuthCookies(res) {
  res.clearCookie('access_token', { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
}

function login(req, res) {
  try {
    const { username, password, mfaToken } = req.body || {};
    if (!username || password === undefined || password === null) return error(res, 'username and password are required', 400);
    const user = usersService.authenticate(username, password);
    if (!user) return error(res, 'Invalid username or password', 401);

    // Phase E — a disabled account cannot authenticate at all (fresh logins
    // are blocked in addition to the tokenVersion invalidation of outstanding
    // tokens performed by the disable endpoint). Status is only honored for
    // the exact literal 'disabled' so legacy records stay unaffected.
    if (user.status === 'disabled') {
      return error(res, 'User is disabled', 403, { code: 'ACCOUNT_DISABLED' });
    }

    // Phase 16 — tenant membership enforcement at the company-selection
    // boundary. Runs BEFORE any token is generated and only when the feature
    // is enabled. `req.tenantContext` is present here only when companyContext
    // successfully resolved a valid, ACTIVE selected company; for any other
    // selection (missing / unknown / inactive company) it is absent and the
    // GoLive-1 legacy fallback is preserved unchanged. Users with no membership
    // (or an empty membership) are never denied.
    if (config.tenantUserMembershipEnabled && req.tenantContext && req.tenantContext.tenantId != null) {
      if (tenantMembership.isTenantDenied(user, req.tenantContext.tenantId)) {
        return error(res, 'User is not a member of the selected company', 403);
      }
    }

    if (user.mfaEnabled) {
      if (!mfaToken) {
        const tempToken = signAccessToken({ ...user, mfaPending: true });
        return success(res, {
          mfaRequired: true,
          tempToken,
          userId: user.id,
          message: 'MFA verification required'
        }, 'MFA required');
      }

      const mfaResult = mfaService.verifyLogin(user.id, mfaToken);
      if (mfaResult.error || !mfaResult.verified) {
        return error(res, 'Invalid MFA code', 401);
      }
    }

    // PHASE 19 — secure tenant carry. Only bind a tenant into the signed
    // tokens when (a) the feature is enabled, (b) a VALID, ACTIVE company was
    // resolved into req.tenantContext, and (c) membership enforcement already
    // passed. tenantId is taken EXCLUSIVELY from the server-resolved
    // TenantContext — never from client-supplied fields. Legacy login (no /
    // unknown / inactive company) signs an ordinary token with NO tenant claim,
    // exactly as before.
    const carryTenantId =
      (config.tenantCarryEnabled &&
       req.tenantContext &&
       req.tenantContext.tenantId != null)
        ? String(req.tenantContext.tenantId)
        : undefined;

    const tokenIdentity = carryTenantId ? { ...user, tenantId: carryTenantId } : user;

    const accessToken = signAccessToken(tokenIdentity);
    const refreshToken = signRefreshToken(tokenIdentity);
    _setAuthCookies(res, accessToken, refreshToken);

    // Phase 17 — tenant-scoped role resolution. When enabled and a valid ACTIVE
    // company was resolved into req.tenantContext, compute the effective role
    // the user acts as in that tenant (per-tenant role when present, else the
    // global role). Additive only: the field is absent whenever the feature is
    // off or no tenant context exists, so existing responses are unchanged.
    let effectiveRole;
    if (config.tenantRolesEnabled && req.tenantContext && req.tenantContext.tenantId != null) {
      effectiveRole = tenantRole.resolveEffectiveRole(user, req.tenantContext.tenantId);
    }

    const result = { user: usersService.sanitizeUser(user), accessToken, refreshToken };
    if (effectiveRole !== undefined) result.effectiveRole = effectiveRole;
    success(res, result, 'Login successful');
  } catch (err) {
    logger.error('auth.login error:', err.message);
    error(res, 'Failed to login', 500);
  }
}

function refresh(req, res) {
  try {
    const token = (req.body && req.body.refreshToken) || parseCookies(req).refresh_token;
    if (!token) return error(res, 'refreshToken is required', 400);
    if (isRevoked(token)) return error(res, 'Refresh token has been revoked', 401);
    const payload = verifyRefreshToken(token);
    if (!payload) return error(res, 'Invalid or expired refresh token', 401);
    const user = usersService.getById(payload.sub);
    if (!user) return error(res, 'User not found', 401);

    // Phase D — refresh tokens are invalidated by a tokenVersion bump too.
    if (payload.ver !== undefined && Number(payload.ver) !== (Number(user.tokenVersion) || 0)) {
      return error(res, 'Invalid or expired refresh token', 401);
    }

    // P0-004 — a disabled account cannot obtain a fresh access token. Mirrors
    // the Phase E login gate so refresh can never become a bypass for disabled
    // users.
    if (user.status === 'disabled') {
      return error(res, 'User is disabled', 403, { code: 'ACCOUNT_DISABLED' });
    }

    // Phase 19 — preserve the securely-carried tenant across a refresh. The
    // refresh token embeds tenantId via the same _claims; forward it into the
    // freshly minted access token ONLY when the feature is enabled and the
    // refresh payload actually carries a tenant. Otherwise the token is signed
    // exactly as before (no tenant claim).
    const carriedTenantId =
      (config.tenantCarryEnabled && payload.tenantId !== undefined && payload.tenantId !== null)
        ? String(payload.tenantId)
        : undefined;

    // P0-004 — a carried tenant is a context HINT, never an authorization
    // grant. Before minting a new access token, re-validate against CURRENT
    // server-side state:
    //   1. the company must still exist and be active;
    //   2. the user's membership must still include that tenant (when the
    //      membership feature is on and the user holds a membership).
    // Any lapse rejects the refresh — no new token, no stale context.
    if (carriedTenantId) {
      const company = CompanyService.getCompany(carriedTenantId);
      if (!company || company.active === false) {
        return error(res, 'Invalid or expired refresh token', 401);
      }
      if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, carriedTenantId)) {
        return error(res, 'User is not a member of the selected company', 403);
      }
    }

    const tokenIdentity = carriedTenantId ? { ...user, tenantId: carriedTenantId } : user;
    const accessToken = signAccessToken(tokenIdentity);

    // P0-004 — resolve the effective role from the CURRENT user record so a
    // role change (e.g. Admin -> Cashier) is reflected immediately. Additive
    // field mirroring the login response; absent when the feature is off or no
    // tenant is carried, exactly like login.
    const result = { accessToken };
    if (config.tenantRolesEnabled && carriedTenantId) {
      result.effectiveRole = tenantRole.resolveEffectiveRole(user, carriedTenantId);
    }
    res.cookie('access_token', accessToken, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 15 * 60 * 1000 });
    success(res, result, 'Token refreshed');
  } catch (err) {
    logger.error('auth.refresh error:', err.message);
    error(res, 'Failed to refresh token', 500);
  }
}

function logout(req, res) {
  try {
    const accessToken = extractToken(req);
    const refreshToken = (req.body && req.body.refreshToken) || parseCookies(req).refresh_token;
    if (accessToken) revokeToken(accessToken);
    if (refreshToken) revokeToken(refreshToken);
    _clearAuthCookies(res);
    success(res, null, 'Logout successful');
  } catch (err) {
    logger.error('auth.logout error:', err.message);
    error(res, 'Failed to logout', 500);
  }
}

// Phase D — self-service password change. Requires the CURRENT password,
// enforces the centralized policy on the new one, persists the new hash,
// bumps tokenVersion (invalidating every outstanding token), and records an
// audit event. The new password is redacted from the audit trail.
function changePassword(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);
    const { currentPassword, newPassword } = req.body || {};
    if (currentPassword === undefined || currentPassword === null || newPassword === undefined || newPassword === null) {
      return error(res, 'currentPassword and newPassword are required', 400);
    }
    const user = usersService.getById(req.user.id);
    if (!user) return error(res, 'User not found', 404);

    const verify = verifyPassword(currentPassword, user.password);
    if (!verify.match) return error(res, 'Incorrect current password', 401);

    const policy = validatePassword(newPassword);
    if (!policy.valid) {
      return error(res, 'Password does not meet policy requirements: ' + policy.errors.join('; '), 400, { code: 'PASSWORD_POLICY_VIOLATION' });
    }

    const updated = usersService.update(req.user.id, { password: newPassword });
    if (updated.error === 'User not found') return error(res, updated.error, 404);
    if (updated.error) return error(res, updated.error, 400);

    const bump = usersService.bumpTokenVersion(req.user.id);
    if (bump.error) return error(res, bump.error, 400);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/auth/change-password',
        statusCode: 200,
        userId: req.user.id,
        action: 'USER_PASSWORD_CHANGED',
        resource: 'user',
        resourceId: req.user.id,
        changes: { before: {}, after: { password: newPassword, tokenVersion: bump.tokenVersion } }
      });
    } catch (err) {
      logger.error('auth.changePassword audit error:', err.message);
    }

    return success(res, null, 'Password changed successfully');
  } catch (err) {
    logger.error('auth.changePassword error:', err.message);
    error(res, 'Failed to change password', 500);
  }
}

function me(req, res) {
  try {
    if (req.user) {
      const username = req.query.username;
      const queryingOther = Boolean(username);
      if (queryingOther && String(username) !== String(req.user.username) && req.user.role !== 'Owner' && req.user.role !== 'Admin') {
        return error(res, 'Insufficient permission', 403);
      }
      const user = username ? usersService.getByUsername(username) : usersService.getById(req.user.id);
      if (!user) return error(res, 'User not found', 404);
      const result = { user: usersService.sanitizeUser(user) };
      // Phase C — additive authorization enrichment for the requester's own
      // record only. Exposes the effective role and effective permissions in
      // the CURRENT trusted tenant (never another tenant's view). Fields stay
      // absent whenever no trusted tenant resolves, leaving legacy responses
      // byte-for-byte unchanged.
      if (!queryingOther) {
        const tenantId = (config.tenantRolesEnabled && req.tenantContext && req.tenantContext.tenantId != null)
          ? String(req.tenantContext.tenantId)
          : undefined;
        if (tenantId !== undefined) {
          result.effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId);
          result.effectivePermissions = authorization.getEffectivePermissions(user, tenantId);
        }
      }
      return success(res, result, 'Current user retrieved');
    }
    const username = req.query.username;
    if (!username) return error(res, 'username is required', 400);
    // Phase 22B: username lookup requires authentication (closes enumeration).
    return error(res, 'Authentication required', 401);
  } catch (err) {
    logger.error('auth.me error:', err.message);
    error(res, 'Failed to retrieve current user', 500);
  }
}

function roles(req, res) {
  try {
    const st = usersService.stats();
    const fromStore = Object.keys(st.roles).map(r => r.charAt(0).toUpperCase() + r.slice(1));
    const all = [...new Set([...KNOWN_ROLES, ...fromStore])];
    success(res, { roles: all }, 'Roles retrieved');
  } catch (err) {
    logger.error('auth.roles error:', err.message);
    error(res, 'Failed to retrieve roles', 500);
  }
}

function permissions(req, res) {
  try {
    const username = req.query.username;
    if (!username) return error(res, 'username is required', 400);
    if (!req.user) return error(res, 'Authentication required', 401);
    if (!_canViewUser(req.user, username)) {
      return error(res, 'Insufficient permission', 403);
    }
    const user = usersService.getByUsername(username);
    if (!user) return error(res, 'User not found', 404);
    success(res, { username: user.username, role: user.role || '', permissions: Array.isArray(user.permissions) ? user.permissions : [] }, 'Permissions retrieved');
  } catch (err) {
    logger.error('auth.permissions error:', err.message);
    error(res, 'Failed to retrieve permissions', 500);
  }
}

module.exports = { login, refresh, logout, changePassword, me, roles, permissions };
