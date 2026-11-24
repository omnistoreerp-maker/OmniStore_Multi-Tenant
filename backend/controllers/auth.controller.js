const crypto = require('crypto');
const usersService = require('../services/users.service');
const oauthService = require('../services/oauth.service');
const googleIdentity = require('../utils/googleIdentity');
const mfaService = require('../services/mfa.service');
const config = require('../config');
const oauthConfig = require('../config/oauth');
const tenantMembership = require('../services/tenantMembership.service');
const tenantRole = require('../services/tenantRole.service');
const authorization = require('../services/authorization.service');
const auditService = require('../services/audit.service');
const CompanyService = require('../services/company.service');
const loginTenant = require('../services/loginTenant.service');
const platformAdmin = require('../services/platformAdmin.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  signChallengeToken,
  verifyChallengeToken,
  CHALLENGE_PURPOSES
} = require('../utils/jwt');
const challengeStore = require('../utils/challengeStore.sqlite');
const tokenStore = require('../utils/tokenStore.sqlite');
const { revokeToken } = require('../utils/tokenStore');
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

// P6 F4/F5 — bounded, throttled housekeeping for the durable token store.
// At most one small batch of already-expired rows is removed per interval, so
// no login or refresh pays for a full-table purge. Cleanup is advisory only:
// it fails closed on nothing, it can never grant access, and a storage error is
// swallowed so authentication behaves exactly as it would without cleanup.
function _runTokenStoreHousekeeping() {
  try {
    tokenStore.purgeExpiredIfDue();
  } catch (_) {
    // Never let housekeeping affect the auth outcome.
  }
}

// ── Durable login challenges ────────────────────────────────────────────────
// Google Login issues short-lived intermediate challenges (MFA verification,
// tenant selection). Each one is:
//   * purpose-bound and subject-bound (signed claims + stored row),
//   * persisted only as a SHA-256 hash in SQLite, and
//   * consumable exactly once, atomically, before any session is issued.
// Any failure to persist or consume is fatal for the login attempt: no access
// token, refresh token or auth cookie is issued.
let _challengeDb = null;

function _getChallengeDb() {
  if (_challengeDb && _challengeDb.open) return _challengeDb;
  _challengeDb = challengeStore.initialise(challengeStore.resolveDefaultPath()).db;
  return _challengeDb;
}

// Test seam: lets a suite point the controller at an isolated database.
function _setChallengeDbForTests(db) {
  _challengeDb = db;
}

function _issueChallenge(user, purpose, extra) {
  const token = signChallengeToken(user, purpose, extra);
  const db = _getChallengeDb();
  // P6.67 — bounded, throttled housekeeping: at most one small batch of
  // expired rows is removed per interval, never on every request. Active
  // challenges are never eligible (expiresAt <= now only).
  challengeStore.purgeExpiredIfDue(db);
  // The row TTL defaults to the SAME configured value the JWT uses, so the
  // signed token and the durable row always expire together.
  challengeStore.persistChallenge(db, { token, sub: String(user.id), purpose });
  return token;
}

function _burnChallenge(token, purpose, userId) {
  return challengeStore.consumeChallenge(_getChallengeDb(), {
    token,
    purpose,
    sub: String(userId)
  });
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

    // Phase 33 — a SUSPENDED company cannot be logged into at all. This is an
    // explicit rejection (unlike unknown/inactive companies, which silently
    // fall back to legacy login) so suspended tenants can never re-enter
    // through the company selector.
    if (req.body && req.body.company) {
      const selected = CompanyService.getCompany(req.body.company);
      if (selected && String(selected.status || '').toUpperCase() === 'SUSPENDED') {
        return error(res, 'Company is suspended', 403, { code: 'COMPANY_SUSPENDED' });
      }
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

    // PHASE 19 / P1 — secure tenant carry. Only bind a tenant into the signed
    // tokens when (a) the feature is enabled and (b) the SERVER resolved an
    // unambiguous tenant for this login. The resolution lives in
    // services/loginTenant.service.js: an already validated ACTIVE company
    // selection (membership-checked above), otherwise the user's stored
    // membership / the single ACTIVE company — never an unhonored selection,
    // never a platform/Master identity, and never for multi-company accounts
    // (they must select explicitly). tenantId is taken EXCLUSIVELY from
    // server-owned state (company catalog + stored user record) — never from
    // client-supplied fields — and is signed here, so the claim is the
    // server's, not the browser's. Legacy login (no resolvable tenant) signs
    // an ordinary token with NO tenant claim, exactly as before.
    const resolution = loginTenant.resolveLoginTenantId({
      user,
      requestedCompany: req.body && req.body.company,
      selectedTenantId: req.tenantContext && req.tenantContext.tenantId
    });
    const carryTenantId = (config.tenantCarryEnabled && resolution.tenantId)
      ? resolution.tenantId
      : undefined;

    const tokenIdentity = carryTenantId ? { ...user, tenantId: carryTenantId } : user;

    // Throttled housekeeping (at most one bounded batch per interval).
    _runTokenStoreHousekeeping();

    // F4: Create session family and issue first refresh token
    const issuedAt = Date.now();
    const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);
    const jti = crypto.randomUUID();

    // Create session family first (required for FK constraint)
    const { familyId } = tokenStore.createSessionFamily(user.id, carryTenantId);

    tokenStore.issueRefreshToken(jti, {
      jti,
      familyId,
      sub: user.id,
      ver: user.tokenVersion || 0,
      tenantId: carryTenantId,
      issuedAt,
      expiresAt
    });

    const accessToken = signAccessToken({ ...tokenIdentity, familyId });
    const refreshToken = signRefreshToken({ ...tokenIdentity, familyId, jti });
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

    let payload;
    try {
      payload = verifyRefreshToken(token);
    } catch {
      return error(res, 'Invalid refresh token', 401);
    }
    if (!payload) return error(res, 'Invalid or expired refresh token', 401);

    const { jti, familyId, sub, ver, tenantId } = payload;

    const user = usersService.getById(sub);
    if (!user) return error(res, 'User not found', 401);

    if (user.status === 'disabled') {
      return error(res, 'User is disabled', 403, { code: 'ACCOUNT_DISABLED' });
    }

    const carriedTenantId =
      (config.tenantCarryEnabled && tenantId !== undefined && tenantId !== null)
        ? String(tenantId)
        : undefined;

    if (carriedTenantId) {
      const company = CompanyService.getCompany(carriedTenantId);
      if (!company || company.active === false) {
        return error(res, 'Invalid or expired refresh token', 401);
      }
      if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, carriedTenantId)) {
        return error(res, 'User is not a member of the selected company', 403);
      }
    }

    try {
      // Throttled housekeeping (at most one bounded batch per interval).
      _runTokenStoreHousekeeping();

      const newJti = crypto.randomUUID();
      const issuedAt = Date.now();
      const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);

      const rotationResult = tokenStore.rotateRefreshToken(jti, {
        jti: newJti,
        familyId,
        sub,
        ver: Number(user.tokenVersion) || 0,
        tenantId: carriedTenantId,
        issuedAt,
        expiresAt
      }, user);

      const tokenIdentity = carriedTenantId ? { ...user, tenantId: carriedTenantId, familyId } : { ...user, familyId };
      const accessToken = signAccessToken(tokenIdentity);
      const refreshToken = signRefreshToken({ ...tokenIdentity, jti: newJti });

      const result = { accessToken, refreshToken };
      if (config.tenantRolesEnabled && carriedTenantId) {
        result.effectiveRole = tenantRole.resolveEffectiveRole(user, carriedTenantId);
      }
      res.cookie('access_token', accessToken, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 15 * 60 * 1000 });
      res.cookie('refresh_token', refreshToken, { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: 7 * 24 * 60 * 60 * 1000 });
      success(res, result, 'Token refreshed');
    } catch (e) {
      const map = {
        TOKEN_UNKNOWN: 401,
        REPLAY_DETECTED: 401,
        TOKEN_EXPIRED: 401,
        TOKEN_REVOKED: 401,
        SESSION_REVOKED: 401,
        TOKEN_SUB_MISMATCH: 401,
        FAMILY_ID_MISMATCH: 401,
        TOKEN_VERSION_MISMATCH: 401,
        TENANT_MISMATCH: 403,
        ACCOUNT_DISABLED: 403,
        STORAGE_UNAVAILABLE: 503,
        CONCURRENT_CONSUME: 401,
        FAMILY_REVOKE_FAILED: 503
      };
      return error(res, e.message, map[e.code] || 500, { code: e.code });
    }
  } catch (err) {
    logger.error('auth.refresh error:', err.message);
    error(res, 'Failed to refresh token', 500);
  }
}

function logout(req, res) {
  try {
    const accessToken = extractToken(req);
    const refreshToken = (req.body && req.body.refreshToken) || parseCookies(req).refresh_token;

    if (accessToken) {
      try {
        const payload = require('../utils/jwt').verifyAccessToken(accessToken);
        if (payload && payload.familyId && payload.sub) {
          tokenStore.revokeFamily(payload.familyId, payload.sub);
        } else if (payload && payload.jti) {
          tokenStore.revokeAccessToken(payload.jti, payload.sub, payload.exp || Date.now() / 1000);
        }
      } catch {
        revokeToken(accessToken);
      }
    }

    if (refreshToken) {
      try {
        const payload = require('../utils/jwt').verifyRefreshToken(refreshToken);
        if (payload && payload.familyId && payload.sub) {
          tokenStore.revokeFamily(payload.familyId, payload.sub);
        } else if (payload && payload.jti) {
          tokenStore.revokeRefreshToken(payload.jti, payload.sub, payload.exp || Date.now() / 1000);
        }
      } catch {
        revokeToken(refreshToken);
      }
    }

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
        changes: { before: {}, after: { tokenVersion: bump.tokenVersion, passwordRedacted: true } }
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

// Link the authenticated user's own Google identity.
//
// The Google subject comes ONLY from a verified ID token; the request body is
// never trusted for identity or for the target user. `req.user.id` is the
// single source of the account being modified, so a caller cannot link an
// identity onto someone else's account by adding userId/id/role fields.
// The atomic store update (usersService.linkOAuthProvider) touches only the
// oauth mapping, leaving role, tenant membership and permissions intact.
// Audit helper for the linking surface. Records only non-sensitive metadata:
// never the ID token, access token, client secret or credentials.
function _recordLinkAudit(req, action, statusCode, changes) {
  try {
    auditService.record({
      method: 'POST',
      path: '/api/v1/auth/link/google',
      statusCode,
      userId: req.user ? req.user.id : null,
      ip: req.ip,
      userAgent: req.get ? req.get('user-agent') : null,
      action,
      resource: 'user',
      resourceId: req.user ? req.user.id : null,
      changes
    });
  } catch (err) {
    logger.error('auth.linkGoogle audit error:', err.message);
  }
}

async function linkGoogle(req, res) {
  try {
    if (!req.user) return error(res, 'Authentication required', 401);

    const { idToken } = req.body || {};
    const identity = await googleIdentity.verifyIdToken(idToken);
    if (identity.error) {
      _recordLinkAudit(req, 'USER_OAUTH_LINK_FAILED', identity.statusCode || 401, {
        provider: 'google',
        result: 'failure',
        reason: identity.statusCode === 503 ? 'google_not_configured' : 'google_verification_failed'
      });
      return error(res, identity.error, identity.statusCode || 401);
    }

    const result = await oauthService.linkProvider(req.user.id, 'google', {
      id: identity.sub,
      emails: identity.email ? [{ value: identity.email }] : [],
      _json: { sub: identity.sub, email: identity.email }
    });

    if (result.error) {
      let reason = 'persistence_failed';
      if (result.conflict) reason = 'identity_already_linked';
      else if (result.statusCode === 404) reason = 'user_not_found';
      else if (result.statusCode === 503) reason = 'lock_unavailable';
      _recordLinkAudit(req, 'USER_OAUTH_LINK_FAILED', result.statusCode || 400, {
        provider: 'google',
        result: 'failure',
        reason
      });
      return error(res, result.error, result.statusCode || 400);
    }

    _recordLinkAudit(req, 'USER_OAUTH_LINKED', 200, {
      provider: 'google',
      result: 'success',
      alreadyLinked: !!result.alreadyLinked
    });

    return success(res, {
      linked: true,
      alreadyLinked: !!result.alreadyLinked,
      user: usersService.sanitizeUser(result.user)
    }, result.alreadyLinked ? 'Google account already linked' : 'Google account linked');
  } catch (err) {
    logger.error('auth.linkGoogle error:', err.message);
    _recordLinkAudit(req, 'USER_OAUTH_LINK_FAILED', 500, {
      provider: 'google',
      result: 'failure',
      reason: 'internal_error'
    });
    return error(res, 'Failed to link Google account', 500);
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

// ---------------------------------------------------------------------------
// Google Login — ordinary-user sign-in with a verified Google ID token.
// The Google subject comes ONLY from a verified ID token. No email-only
// matching, no auto-creation, no auto-linking, no Master accounts.
// ---------------------------------------------------------------------------

// Public, non-secret configuration for the browser Google button.
// Exposes ONLY the OAuth client ID — a public identifier that Google Identity
// Services embeds in every request anyway. The client SECRET is never read
// here, never serialized and never leaves the server. "enabled: false" means
// ID-token sign-in is not configured, so the UI must not offer it.
function googleLoginConfig(req, res) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const enabled = oauthConfig.tenantLoginEnabled === true && Boolean(clientId);
    return success(res, { enabled, clientId }, 'Google login configuration');
  } catch (err) {
    logger.error('auth.googleLoginConfig error:', err.message);
    return error(res, 'Failed to read Google login configuration', 500);
  }
}

async function googleLogin(req, res) {
  try {
    const { idToken } = req.body || {};
    if (!idToken || typeof idToken !== 'string') {
      return error(res, 'Google ID token is required', 400);
    }

    const identity = await googleIdentity.verifyIdToken(idToken);
    if (identity.error) {
      const statusCode = identity.statusCode === 503 ? 503 : 401;
      try {
        auditService.record({
          method: 'POST',
          path: '/api/v1/auth/google-login',
          statusCode,
          ip: req.ip,
          userAgent: req.get ? req.get('user-agent') : null,
          action: 'USER_GOOGLE_LOGIN_FAILED',
          resource: 'auth',
          changes: { reason: identity.statusCode === 503 ? 'google_not_configured_or_unavailable' : 'google_verification_failed' }
        });
      } catch (_) {}
      return error(res, statusCode === 503 ? 'Google authentication temporarily unavailable' : 'Invalid Google token', statusCode);
    }

    const lookup = usersService.findByOAuthProvider('google', identity.sub);
    if (lookup.ambiguous) {
      try {
        auditService.record({
          method: 'POST',
          path: '/api/v1/auth/google-login',
          statusCode: 401,
          ip: req.ip,
          userAgent: req.get ? req.get('user-agent') : null,
          action: 'USER_GOOGLE_LOGIN_FAILED',
          resource: 'auth',
          changes: { reason: 'ambiguous_google_identity' }
        });
      } catch (_) {}
      return error(res, 'Invalid Google token', 401);
    }
    const user = lookup.user;
    if (!user) {
      try {
        auditService.record({
          method: 'POST',
          path: '/api/v1/auth/google-login',
          statusCode: 401,
          ip: req.ip,
          userAgent: req.get ? req.get('user-agent') : null,
          action: 'USER_GOOGLE_LOGIN_FAILED',
          resource: 'auth',
          changes: { reason: 'unlinked_google_identity' }
        });
      } catch (_) {}
      return error(res, 'Invalid Google token', 401);
    }

    if (user.status === 'disabled') {
      return error(res, 'User is disabled', 403, { code: 'ACCOUNT_DISABLED' });
    }

    if (platformAdmin.platformRoleFor(user.username)) {
      try {
        auditService.record({
          method: 'POST',
          path: '/api/v1/auth/google-login',
          statusCode: 403,
          userId: user.id,
          ip: req.ip,
          userAgent: req.get ? req.get('user-agent') : null,
          action: 'USER_GOOGLE_LOGIN_REJECTED_MASTER',
          resource: 'auth',
          resourceId: user.id,
          changes: { reason: 'master_account_isolation' }
        });
      } catch (_) {}
      return error(res, 'Master accounts must use the Master sign-in flow', 403);
    }

    const resolution = loginTenant.resolveLoginTenantId({
      user,
      requestedCompany: undefined,
      selectedTenantId: undefined
    });

    if (resolution.source === loginTenant.SOURCE.AMBIGUOUS) {
      const activeCompanies = CompanyService.getActiveCompanies();
      const membership = tenantMembership.idsFor(user);
      // P6.68 — Google tenant selection fails closed. A user without an
      // explicit, non-empty server-side membership is NOT offered the company
      // catalog as a fallback: the login flow never invents, widens or guesses
      // membership. (Password login policy is unchanged; this branch is
      // reachable only through Google Login.)
      if (membership.length === 0) {
        try {
          auditService.record({
            method: 'POST',
            path: '/api/v1/auth/google-login',
            statusCode: 403,
            userId: user.id,
            ip: req.ip,
            userAgent: req.get ? req.get('user-agent') : null,
            action: 'USER_GOOGLE_LOGIN_REJECTED_NO_TENANT_MEMBERSHIP',
            resource: 'auth',
            resourceId: user.id,
            changes: { reason: 'tenant_membership_required' }
          });
        } catch (_) {}
        return error(res, 'No tenant membership is configured for this account. Contact an administrator.', 403, { code: 'TENANT_MEMBERSHIP_REQUIRED' });
      }
      const availableTenants = activeCompanies.filter(c => membership.includes(String(c.id)));
      // Intermediate credential only: purpose-bound and unusable as a session.
      const tempToken = _issueChallenge(user, CHALLENGE_PURPOSES.GOOGLE_TENANT_SELECTION);
      return success(res, {
        tenantSelectionRequired: true,
        tempToken,
        userId: user.id,
        availableTenants: availableTenants.map(c => ({ id: c.id, name: c.name }))
      }, 'Tenant selection required');
    }

    const tenantId = resolution.tenantId;

    if (tenantId) {
      // P6.68-FINAL — a Google session may only be bound to a tenant the user
      // provably belongs to. The single-active-company DERIVED path is NOT an
      // exception: `resolveLoginTenantId` uses the whole active catalog when the
      // membership list is empty, so one active company must not be mistaken for
      // membership (also reachable when tenantUserMembershipEnabled is off, which
      // is why this check is unconditional in the Google flow).
      const membership = tenantMembership.idsFor(user);
      if (membership.length === 0) {
        try {
          auditService.record({
            method: 'POST',
            path: '/api/v1/auth/google-login',
            statusCode: 403,
            userId: user.id,
            ip: req.ip,
            userAgent: req.get ? req.get('user-agent') : null,
            action: 'USER_GOOGLE_LOGIN_REJECTED_NO_TENANT_MEMBERSHIP',
            resource: 'auth',
            resourceId: user.id,
            changes: { reason: 'tenant_membership_required', source: resolution.source }
          });
        } catch (_) {}
        return error(res, 'No tenant membership is configured for this account. Contact an administrator.', 403, { code: 'TENANT_MEMBERSHIP_REQUIRED' });
      }
      if (!membership.includes(String(tenantId))) {
        return error(res, 'User is not a member of the selected company', 403);
      }
      const company = CompanyService.getCompany(tenantId);
      if (!company || company.active === false || String(company.status || '').toUpperCase() === 'SUSPENDED') {
        return error(res, 'Company is suspended', 403, { code: 'COMPANY_SUSPENDED' });
      }
      if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, tenantId)) {
        return error(res, 'User is not a member of the selected company', 403);
      }
    }

    if (user.mfaEnabled) {
      // Persisted single-use challenge; nothing is usable twice.
      const tempToken = _issueChallenge(
        user,
        CHALLENGE_PURPOSES.GOOGLE_MFA,
        tenantId ? { tenantId } : undefined
      );
      return success(res, {
        mfaRequired: true,
        tempToken,
        userId: user.id,
        message: 'MFA verification required'
      }, 'MFA required');
    }

    const tokenIdentity = tenantId ? { ...user, tenantId } : user;

    const { familyId } = tokenStore.createSessionFamily(user.id, tenantId);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);
    const jti = crypto.randomUUID();

    tokenStore.issueRefreshToken(jti, {
      jti,
      familyId,
      sub: user.id,
      ver: user.tokenVersion || 0,
      tenantId,
      issuedAt,
      expiresAt
    });

    const accessToken = signAccessToken({ ...tokenIdentity, familyId });
    const refreshToken = signRefreshToken({ ...tokenIdentity, familyId, jti });
    _setAuthCookies(res, accessToken, refreshToken);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/auth/google-login',
        statusCode: 200,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get ? req.get('user-agent') : null,
        action: 'USER_GOOGLE_LOGIN',
        resource: 'auth',
        resourceId: user.id,
        tenantId: tenantId || null,
        changes: { provider: 'google' }
      });
    } catch (_) {}

    const result = { user: usersService.sanitizeUser(user), accessToken, refreshToken };
    if (config.tenantRolesEnabled && tenantId) {
      result.effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId);
    }
    return success(res, result, 'Login successful');
  } catch (err) {
    logger.error('auth.googleLogin error:', err.message);
    error(res, 'Failed to login', 500);
  }
}

// Complete MFA after Google Login primary authentication.
// The temp token carries mfaPending: true and binds the user identity;
// the client cannot supply a userId. MFA completion issues full tokens.
async function googleLoginMfaVerify(req, res) {
  try {
    const { tempToken, mfaToken } = req.body || {};
    if (!tempToken || typeof tempToken !== 'string') {
      return error(res, 'Temporary challenge token is required', 400);
    }
    if (!mfaToken) {
      return error(res, 'MFA code is required', 400);
    }

    const payload = verifyChallengeToken(tempToken, CHALLENGE_PURPOSES.GOOGLE_MFA);
    if (!payload) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const user = usersService.getById(payload.sub);
    if (!user) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    // Consume the challenge atomically BEFORE issuing anything. If the
    // challenge is already spent, expired, or belongs to another subject, the
    // attempt fails here and no session is created. Burning before the MFA
    // check also means a stolen challenge cannot be retried for a second guess.
    let burned;
    try {
      burned = _burnChallenge(tempToken, CHALLENGE_PURPOSES.GOOGLE_MFA, user.id);
    } catch (err) {
      logger.error('auth.googleLoginMfaVerify challenge store error:', err.message);
      return error(res, 'Invalid or expired challenge', 401);
    }
    if (!burned || burned.consumed !== true) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const mfaResult = mfaService.verifyLogin(user.id, mfaToken);
    if (mfaResult.error || !mfaResult.verified) {
      return error(res, 'Invalid MFA code', 401);
    }

    const tenantId = payload.tenantId || undefined;

    if (tenantId) {
      // P6.68-FINAL — re-authorise the tenant bound into the MFA challenge
      // against the CURRENT server-side membership (covers challenges minted
      // before this rule, and membership revoked between the two steps).
      const membership = tenantMembership.idsFor(user);
      if (membership.length === 0) {
        return error(res, 'No tenant membership is configured for this account. Contact an administrator.', 403, { code: 'TENANT_MEMBERSHIP_REQUIRED' });
      }
      if (!membership.includes(String(tenantId))) {
        return error(res, 'User is not a member of the selected company', 403);
      }
      const company = CompanyService.getCompany(tenantId);
      if (!company || company.active === false || String(company.status || '').toUpperCase() === 'SUSPENDED') {
        return error(res, 'Company is suspended', 403, { code: 'COMPANY_SUSPENDED' });
      }
      if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, tenantId)) {
        return error(res, 'User is not a member of the selected company', 403);
      }
    }

    const tokenIdentity = tenantId ? { ...user, tenantId } : user;

    const { familyId } = tokenStore.createSessionFamily(user.id, tenantId);
    const issuedAt = Date.now();
    const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);
    const jti = crypto.randomUUID();

    tokenStore.issueRefreshToken(jti, {
      jti,
      familyId,
      sub: user.id,
      ver: user.tokenVersion || 0,
      tenantId,
      issuedAt,
      expiresAt
    });

    const accessToken = signAccessToken({ ...tokenIdentity, familyId });
    const refreshToken = signRefreshToken({ ...tokenIdentity, familyId, jti });
    _setAuthCookies(res, accessToken, refreshToken);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/auth/google-login/mfa-verify',
        statusCode: 200,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get ? req.get('user-agent') : null,
        action: 'USER_GOOGLE_LOGIN_MFA_COMPLETED',
        resource: 'auth',
        resourceId: user.id,
        tenantId: tenantId || null,
        changes: { provider: 'google', usedBackupCode: !!mfaResult.usedBackupCode }
      });
    } catch (_) {}

    const result = { user: usersService.sanitizeUser(user), accessToken, refreshToken };
    if (config.tenantRolesEnabled && tenantId) {
      result.effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId);
    }
    return success(res, result, 'Login successful');
  } catch (err) {
    logger.error('auth.googleLoginMfaVerify error:', err.message);
    error(res, 'Failed to complete MFA', 500);
  }
}

// Select a tenant after Google Login primary authentication when the user
// has multiple active memberships. The temp token carries
// tenantSelectionRequired: true and binds the user identity.
async function googleLoginSelectTenant(req, res) {
  try {
    const { tempToken, tenantId } = req.body || {};
    if (!tempToken || typeof tempToken !== 'string') {
      return error(res, 'Temporary challenge token is required', 400);
    }
    if (!tenantId || typeof tenantId !== 'string') {
      return error(res, 'Tenant ID is required', 400);
    }

    const payload = verifyChallengeToken(tempToken, CHALLENGE_PURPOSES.GOOGLE_TENANT_SELECTION);
    if (!payload) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const user = usersService.getById(payload.sub);
    if (!user) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const activeCompanies = CompanyService.getActiveCompanies();
    const membership = tenantMembership.idsFor(user);
    // P6.68 — fail closed: without an explicit membership the user has no
    // authority to select ANY tenant, so the catalog is never offered.
    if (membership.length === 0) {
      return error(res, 'No tenant membership is configured for this account. Contact an administrator.', 403, { code: 'TENANT_MEMBERSHIP_REQUIRED' });
    }
    // The server-side membership is the authority; a tenantId supplied by the
    // client is only ever a lookup key into that membership.
    if (!membership.includes(String(tenantId))) {
      return error(res, 'Unauthorized tenant selection', 403);
    }
    const availableTenants = activeCompanies.filter(c => membership.includes(String(c.id)));
    const selected = availableTenants.find(c => String(c.id) === String(tenantId));
    if (!selected) {
      return error(res, 'Unauthorized tenant selection', 403);
    }

    if (selected.active === false || String(selected.status || '').toUpperCase() === 'SUSPENDED') {
      return error(res, 'Company is suspended', 403, { code: 'COMPANY_SUSPENDED' });
    }

    // Consume the tenant-selection challenge BEFORE issuing anything, so a
    // replayed or cross-subject selection can never reach session issuance.
    let burned;
    try {
      burned = _burnChallenge(tempToken, CHALLENGE_PURPOSES.GOOGLE_TENANT_SELECTION, user.id);
    } catch (err) {
      logger.error('auth.googleLoginSelectTenant challenge store error:', err.message);
      return error(res, 'Invalid or expired challenge', 401);
    }
    if (!burned || burned.consumed !== true) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    if (user.mfaEnabled) {
      // The tenant choice is carried into the MFA challenge so the completed
      // session stays bound to the tenant this user actually selected.
      const mfaTempToken = _issueChallenge(user, CHALLENGE_PURPOSES.GOOGLE_MFA, {
        tenantId: String(selected.id)
      });
      return success(res, {
        mfaRequired: true,
        tempToken: mfaTempToken,
        userId: user.id,
        message: 'MFA verification required'
      }, 'MFA required');
    }

    // Session is bound to the tenant the user selected, never a default.
    const tenantIdentity = { ...user, tenantId: String(selected.id) };

    const { familyId } = tokenStore.createSessionFamily(user.id, String(selected.id));
    const issuedAt = Date.now();
    const expiresAt = issuedAt + config.jwtRefreshTtlMs || (issuedAt + 7 * 24 * 60 * 60 * 1000);
    const jti = crypto.randomUUID();

    tokenStore.issueRefreshToken(jti, {
      jti,
      familyId,
      sub: user.id,
      ver: user.tokenVersion || 0,
      tenantId: String(selected.id),
      issuedAt,
      expiresAt
    });

    const accessToken = signAccessToken({ ...tenantIdentity, familyId });
    const refreshToken = signRefreshToken({ ...tenantIdentity, familyId, jti });
    _setAuthCookies(res, accessToken, refreshToken);

    try {
      auditService.record({
        method: 'POST',
        path: '/api/v1/auth/google-login/select-tenant',
        statusCode: 200,
        userId: user.id,
        ip: req.ip,
        userAgent: req.get ? req.get('user-agent') : null,
        action: 'USER_GOOGLE_LOGIN_TENANT_SELECTED',
        resource: 'auth',
        resourceId: user.id,
        tenantId: String(selected.id),
        changes: { provider: 'google', tenantId: String(selected.id) }
      });
    } catch (_) {}

    const result = {
      user: usersService.sanitizeUser(user),
      accessToken,
      refreshToken
    };
    if (config.tenantRolesEnabled) {
      result.effectiveRole = tenantRole.resolveEffectiveRole(user, String(selected.id));
    }
    return success(res, result, 'Login successful');
  } catch (err) {
    logger.error('auth.googleLoginSelectTenant error:', err.message);
    error(res, 'Failed to select tenant', 500);
  }
}

module.exports = {
  login, refresh, logout, changePassword, linkGoogle, googleLoginConfig, googleLogin,
  googleLoginMfaVerify, googleLoginSelectTenant, me, roles, permissions,
  // Test seam for challenge-store failure injection
  _setChallengeDbForTests
};
