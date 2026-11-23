const crypto = require('crypto');
const googleAuthCode = require('../services/googleAuthCode.service');
const usersService = require('../services/users.service');
const mfaService = require('../services/mfa.service');
const config = require('../config');
const tenantMembership = require('../services/tenantMembership.service');
const tenantRole = require('../services/tenantRole.service');
const CompanyService = require('../services/company.service');
const loginTenant = require('../services/loginTenant.service');
const auditService = require('../services/audit.service');
const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const {
  signAccessToken,
  signRefreshToken,
  signChallengeToken,
  CHALLENGE_PURPOSES
} = require('../utils/jwt');
const challengeStore = require('../utils/challengeStore.sqlite');
const tokenStore = require('../utils/tokenStore.sqlite');
const { parseCookies } = require('../middleware/auth');

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

function _setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

let _challengeDb = null;

function _getChallengeDb() {
  if (_challengeDb && _challengeDb.open) return _challengeDb;
  _challengeDb = challengeStore.initialise(challengeStore.resolveDefaultPath()).db;
  return _challengeDb;
}

function _issueChallenge(user, purpose, extra) {
  const token = signChallengeToken(user, purpose, extra);
  const db = _getChallengeDb();
  challengeStore.purgeExpiredIfDue(db);
  challengeStore.persistChallenge(db, { token, sub: String(user.id), purpose });
  return token;
}

function _audit(entry) {
  try {
    auditService.record({
      method: entry.method || 'POST',
      path: entry.path || '/api/v1/auth/google-login-code',
      statusCode: entry.statusCode || null,
      userId: entry.userId || null,
      ip: entry.ip || null,
      userAgent: entry.userAgent || null,
      action: entry.action,
      resource: 'auth',
      resourceId: entry.resourceId || null,
      tenantId: entry.tenantId || null,
      changes: entry.changes || null
    });
  } catch (err) {
    logger.error('googleAuthCode audit error:', err.message);
  }
}

// GET /api/v1/auth/google-login-code — start Authorization Code flow for regular users
async function initiate(req, res) {
  try {
    if (!googleAuthCode.isConfigured()) {
      return error(res, 'Google login is not configured', 501);
    }
    const returnTo = req.query.returnTo || '/';
    const { url } = googleAuthCode.createLoginStart({ returnTo });
    _audit({
      method: 'GET',
      path: '/api/v1/auth/google-login-code',
      statusCode: 302,
      ip: req.ip,
      action: 'GOOGLE_LOGIN_CODE_INITIATED',
      changes: { provider: 'google', returnTo }
    });
    return res.redirect(302, url);
  } catch (err) {
    logger.error('googleAuthCode.initiate error:', err.message);
    return error(res, 'Failed to start Google login', 500);
  }
}

// GET /api/v1/auth/google-login-code/callback — handle Authorization Code callback
async function callback(req, res) {
  try {
    if (!googleAuthCode.isConfigured()) {
      return error(res, 'Google login is not configured', 501);
    }

    const state = req.query.state;
    const code = req.query.code;

    if (!state || typeof state !== 'string') {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: 'state_missing' }
      });
      return res.redirect(302, '/?gerr=state_missing');
    }

    // Verify and consume state (single-use)
    const statePayload = oauthState.consume(state);
    if (!statePayload) {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: 'state_invalid_or_replayed' }
      });
      return res.redirect(302, '/?gerr=state_invalid');
    }

    if (statePayload.mode !== 'login') {
      return res.redirect(302, '/?gerr=state_invalid');
    }

    const returnTo = statePayload.returnTo || '/';
    const nonce = statePayload.nonce;
    const codeVerifier = statePayload.cv;

    if (!code || typeof code !== 'string') {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: 'code_missing' }
      });
      return res.redirect(302, '/?gerr=code_missing');
    }

    // Exchange code for ID token
    let idToken;
    try {
      idToken = await googleAuthCode.exchangeCode(code, codeVerifier);
    } catch (err) {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: err.code || 'exchange_failed' }
      });
      return res.redirect(302, '/?gerr=exchange_failed');
    }

    // Verify ID token
    let claims;
    try {
      claims = await googleAuthCode.verifyGoogleIdToken(idToken, nonce);
    } catch (err) {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: err.code || 'idtoken_invalid' }
      });
      return res.redirect(302, '/?gerr=' + (err.code || 'idtoken_invalid'));
    }

    // Resolve user by Google sub only
    const user = googleAuthCode.findUserByGoogleSub(claims.sub);
    if (!user) {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        action: 'GOOGLE_LOGIN_CODE_FAILED',
        ip: req.ip,
        changes: { provider: 'google', reason: 'unlinked_identity' }
      });
      return res.redirect(302, '/?gerr=unlinked_identity');
    }

    // Account status check
    if (user.status === 'disabled') {
      return res.redirect(302, '/?gerr=account_disabled');
    }

    // Master account isolation
    const platformAdmin = require('../services/platformAdmin.service');
    if (platformAdmin.platformRoleFor(user.username)) {
      _audit({
        path: '/api/v1/auth/google-login-code/callback',
        statusCode: 302,
        userId: user.id,
        action: 'GOOGLE_LOGIN_CODE_REJECTED_MASTER',
        ip: req.ip,
        changes: { provider: 'google', reason: 'master_account_isolation' }
      });
      return res.redirect(302, '/?gerr=master_account_isolation');
    }

    // Tenant resolution
    const resolution = loginTenant.resolveLoginTenantId({
      user,
      requestedCompany: undefined,
      selectedTenantId: undefined
    });

    if (resolution.source === loginTenant.SOURCE.AMBIGUOUS) {
      const activeCompanies = CompanyService.getActiveCompanies();
      const membership = tenantMembership.idsFor(user);
      if (membership.length === 0) {
        _audit({
          path: '/api/v1/auth/google-login-code/callback',
          statusCode: 302,
          userId: user.id,
          action: 'GOOGLE_LOGIN_CODE_REJECTED_NO_TENANT_MEMBERSHIP',
          ip: req.ip,
          changes: { provider: 'google', reason: 'tenant_membership_required' }
        });
        return res.redirect(302, '/?gerr=tenant_membership_required');
      }
      const availableTenants = activeCompanies.filter(c => membership.includes(String(c.id)));
      const tempToken = _issueChallenge(user, CHALLENGE_PURPOSES.GOOGLE_TENANT_SELECTION);
      return res.redirect(302, '/?tenant_selection_required=1&tempToken=' + encodeURIComponent(tempToken) + '&userId=' + encodeURIComponent(user.id) + '&availableTenants=' + encodeURIComponent(JSON.stringify(availableTenants.map(c => ({ id: c.id, name: c.name })))));
    }

    const tenantId = resolution.tenantId;

    if (tenantId) {
      const membership = tenantMembership.idsFor(user);
      if (membership.length === 0) {
        _audit({
          path: '/api/v1/auth/google-login-code/callback',
          statusCode: 302,
          userId: user.id,
          action: 'GOOGLE_LOGIN_CODE_REJECTED_NO_TENANT_MEMBERSHIP',
          ip: req.ip,
          changes: { provider: 'google', reason: 'tenant_membership_required', source: resolution.source }
        });
        return res.redirect(302, '/?gerr=tenant_membership_required');
      }
      if (!membership.includes(String(tenantId))) {
        return res.redirect(302, '/?gerr=unauthorized_tenant');
      }
      const company = CompanyService.getCompany(tenantId);
      if (!company || company.active === false || String(company.status || '').toUpperCase() === 'SUSPENDED') {
        return res.redirect(302, '/?gerr=company_suspended');
      }
      if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, tenantId)) {
        return res.redirect(302, '/?gerr=unauthorized_tenant');
      }
    }

    // MFA check
    if (user.mfaEnabled) {
      const tempToken = _issueChallenge(
        user,
        CHALLENGE_PURPOSES.GOOGLE_MFA,
        tenantId ? { tenantId } : undefined
      );
      return res.redirect(302, '/?mfa_required=1&tempToken=' + encodeURIComponent(tempToken) + '&userId=' + encodeURIComponent(user.id));
    }

    // Issue tokens
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

    _audit({
      path: '/api/v1/auth/google-login-code/callback',
      statusCode: 302,
      userId: user.id,
      action: 'GOOGLE_LOGIN_CODE_SUCCESS',
      ip: req.ip,
      tenantId: tenantId || null,
      changes: { provider: 'google' }
    });

    return res.redirect(302, returnTo + '?gsignin=1');
  } catch (err) {
    logger.error('googleAuthCode.callback error:', err.message);
    return res.redirect(302, '/?gerr=server_error');
  }
}

// POST /api/v1/auth/google-login-code/mfa-verify — complete MFA after Google login
async function mfaVerify(req, res) {
  try {
    const { tempToken, mfaToken } = req.body || {};
    if (!tempToken || typeof tempToken !== 'string') {
      return error(res, 'Temporary challenge token is required', 400);
    }
    if (!mfaToken) {
      return error(res, 'MFA code is required', 400);
    }

    const db = _getChallengeDb();
    const challenge = challengeStore.consumeChallenge(db, tempToken);
    if (!challenge || challenge.purpose !== CHALLENGE_PURPOSES.GOOGLE_MFA) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const user = usersService.getById(challenge.sub);
    if (!user || user.status === 'disabled' || !user.mfaEnabled) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const result = mfaService.verifyLogin(user.id, String(mfaToken));
    if (result.error || !result.verified) {
      _audit({
        method: 'POST',
        path: '/api/v1/auth/google-login-code/mfa-verify',
        statusCode: 401,
        userId: user.id,
        action: 'GOOGLE_LOGIN_CODE_MFA_DENIED',
        ip: req.ip,
        changes: { provider: 'google', mfa: true, reason: 'bad_code' }
      });
      return error(res, 'Invalid MFA code', 401);
    }

    const tenantId = challenge.extra?.tenantId;
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

    _audit({
      method: 'POST',
      path: '/api/v1/auth/google-login-code/mfa-verify',
      statusCode: 200,
      userId: user.id,
      action: 'GOOGLE_LOGIN_CODE_SUCCESS',
      ip: req.ip,
      tenantId: tenantId || null,
      changes: { provider: 'google', mfa: true }
    });

    const resultData = { user: usersService.sanitizeUser(user), accessToken, refreshToken };
    if (config.tenantRolesEnabled && tenantId) {
      resultData.effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId);
    }
    return success(res, resultData, 'MFA verification successful');
  } catch (err) {
    logger.error('googleAuthCode.mfaVerify error:', err.message);
    return error(res, 'Failed to verify MFA', 500);
  }
}

// POST /api/v1/auth/google-login-code/select-tenant — select tenant after Google login
async function selectTenant(req, res) {
  try {
    const { tempToken, tenantId } = req.body || {};
    if (!tempToken || typeof tempToken !== 'string') {
      return error(res, 'Temporary challenge token is required', 400);
    }
    if (!tenantId) {
      return error(res, 'tenantId is required', 400);
    }

    const db = _getChallengeDb();
    const challenge = challengeStore.consumeChallenge(db, tempToken);
    if (!challenge || challenge.purpose !== CHALLENGE_PURPOSES.GOOGLE_TENANT_SELECTION) {
      return error(res, 'Invalid or expired challenge', 401);
    }

    const user = usersService.getById(challenge.sub);
    if (!user || user.status === 'disabled') {
      return error(res, 'Invalid or expired challenge', 401);
    }

    // Validate tenant membership
    const membership = tenantMembership.idsFor(user);
    if (membership.length === 0 || !membership.includes(String(tenantId))) {
      return error(res, 'User is not a member of the selected company', 403);
    }

    const company = CompanyService.getCompany(tenantId);
    if (!company || company.active === false || String(company.status || '').toUpperCase() === 'SUSPENDED') {
      return error(res, 'Company is suspended', 403);
    }
    if (config.tenantUserMembershipEnabled && tenantMembership.isTenantDenied(user, tenantId)) {
      return error(res, 'User is not a member of the selected company', 403);
    }

    const tokenIdentity = { ...user, tenantId };
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

    _audit({
      method: 'POST',
      path: '/api/v1/auth/google-login-code/select-tenant',
      statusCode: 200,
      userId: user.id,
      action: 'GOOGLE_LOGIN_CODE_SUCCESS',
      ip: req.ip,
      tenantId,
      changes: { provider: 'google', tenant_selection: true }
    });

    const resultData = { user: usersService.sanitizeUser(user), accessToken, refreshToken };
    if (config.tenantRolesEnabled && tenantId) {
      resultData.effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId);
    }
    return success(res, resultData, 'Tenant selected successfully');
  } catch (err) {
    logger.error('googleAuthCode.selectTenant error:', err.message);
    return error(res, 'Failed to select tenant', 500);
  }
}

module.exports = {
  initiate,
  callback,
  mfaVerify,
  selectTenant
};