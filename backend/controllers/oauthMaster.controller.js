const { success, error } = require('../utils/apiResponse');
const logger = require('../utils/logger');
const oauthConfig = require('../config/oauth');
const oauthState = require('../utils/oauthState');
const googleOidc = require('../services/googleOidc.service');
const usersService = require('../services/users.service');
const platformAdminService = require('../services/platformAdmin.service');
const auditService = require('../services/audit.service');
const mfaService = require('../services/mfa.service');
const { signAccessToken, signRefreshToken, verifyRefreshToken } = require('../utils/jwt');
const { isRevoked } = require('../utils/tokenStore');
const { parseCookies } = require('../middleware/auth');
const { verifyPassword } = require('../utils/password');

const IS_PROD = (process.env.NODE_ENV || 'development') === 'production';

function _setAuthCookies(res, accessToken, refreshToken) {
  const base = { httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/' };
  res.cookie('access_token', accessToken, { ...base, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refreshToken, { ...base, maxAge: 7 * 24 * 60 * 1000 });
}

// Internal-path-only redirect target. Rejects protocol-relative paths,
// embedded schemes, backslashes, control characters and oversized input —
// the open-redirect surface the legacy `state=returnTo` passthrough had.
function _safeReturnTo(raw, fallback = '/') {
  let v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!v) return fallback;
  if (v.length > 512) return fallback;
  if (!v.startsWith('/')) v = '/' + v;
  if (!/^\/(?!\/)/.test(v)) return fallback;
  if (/[\\\u0000-\u001f]/.test(v)) return fallback;
  if (/^\/[^/?#]*:/.test(v)) return fallback;
  if (v.startsWith('/auth/google/master')) return fallback;
  return v;
}

function _appendParam(url, key, value) {
  const base = String(url || '/');
  const hashIdx = base.indexOf('#');
  const path = hashIdx === -1 ? base : base.slice(0, hashIdx);
  const hash = hashIdx === -1 ? '' : base.slice(hashIdx);
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + key + '=' + encodeURIComponent(String(value)) + hash;
}

function _failRedirect(res, returnTo, code) {
  res.redirect(302, _appendParam(_safeReturnTo(returnTo, '/'), 'gerr', code));
}

function _audit(entry) {
  try {
    auditService.record({
      method: entry.method || 'GET',
      path: entry.path || '/auth/google/master',
      statusCode: entry.statusCode || null,
      userId: entry.userId || null,
      action: entry.action,
      resource: 'oauth',
      resourceId: entry.resourceId || null,
      ip: entry.ip || null,
      changes: entry.changes || null
    });
  } catch (err) {
    logger.error('oauthMaster audit error:', err.message);
  }
}

// Session identity from SERVER-verified credentials only: the access
// token already validated by authMiddleware, else a non-revoked refresh
// cookie (same trust level, used when the 15-minute access lapsed while
// the user sat on Google's consent screen). Never from query/body.
function _sessionSubject(req) {
  if (req.user && req.user.id) return { id: req.user.id, username: req.user.username };
  const refreshToken = parseCookies(req).refresh_token;
  if (!refreshToken || isRevoked(refreshToken)) return null;
  const payload = verifyRefreshToken(refreshToken);
  if (!payload) return null;
  const user = usersService.getById(payload.sub);
  if (!user || user.status === 'disabled') return null;
  const tokenVersion = payload.ver === undefined ? 0 : Number(payload.ver);
  if (tokenVersion !== (Number(user.tokenVersion) || 0)) return null;
  return { id: user.id, username: user.username };
}

// Lightweight CSRF posture for the state-changing endpoints, on top of
// SameSite=lax cookies: a browser always announces cross-site POSTs via
// Origin / Sec-Fetch-Site, and those must match this host. Non-browser
// clients (no such headers) are unaffected.
function _sameOrigin(req) {
  const origin = req.headers.origin;
  if (origin) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch (_) {
      return false;
    }
  }
  const site = req.headers['sec-fetch-site'];
  if (site) return site !== 'cross-site';
  const referer = req.headers.referer;
  if (referer) {
    try {
      return new URL(referer).host === req.headers.host;
    } catch (_) {
      return false;
    }
  }
  return true;
}

// GET /auth/google/master — start a login attempt (mode=login).
function initiateMaster(req, res) {
  if (!googleOidc.isConfigured()) return error(res, 'Google sign-in is not configured', 501);
  const returnTo = _safeReturnTo(req.query.returnTo, '/');
  try {
    const { url } = googleOidc.createLoginStart({ mode: 'login', returnTo });
    res.redirect(302, url);
  } catch (err) {
    logger.error('oauthMaster.initiate error:', err.message);
    return error(res, 'Failed to start Google sign-in', 500);
  }
}

// GET /auth/google/master/link?ticket=... — start a LINK attempt for an
// already authenticated session. The ticket is a single-use signed token
// issued by POST link-session after password re-auth; both the ticket and
// the live session must name the same username.
function initiateMasterLink(req, res) {
  const subject = _sessionSubject(req);
  if (!subject) return error(res, 'Authentication required', 401);
  const ticket = oauthState.consume(req.query.ticket);
  if (!ticket || ticket.mode !== 'ticket' || String(ticket.u || '') !== String(subject.username)) {
    return error(res, 'Invalid or expired link ticket', 403);
  }
  if (!googleOidc.isConfigured()) return error(res, 'Google sign-in is not configured', 501);
  const returnTo = _safeReturnTo(req.query.returnTo, '/');
  try {
    const { url } = googleOidc.createLoginStart({ mode: 'link', returnTo, username: subject.username });
    res.redirect(302, url);
  } catch (err) {
    logger.error('oauthMaster.initiateLink error:', err.message);
    return error(res, 'Failed to start Google sign-in', 500);
  }
}

async function _completeLogin(req, res, claims, returnTo) {
  // Login resolves EXCLUSIVELY by the verified Google sub. No user is
  // created, no email is ever matched, no membership is granted here —
  // platform authorization keeps coming from platformAdmins.json through
  // requirePlatformAdmin on every protected surface.
  const user = googleOidc.findUserByGoogleSub(claims.sub);
  if (!user) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, action: 'GOOGLE_MASTER_LOGIN_DENIED',
      ip: req.ip, changes: { provider: 'google', reason: 'not_linked' }
    });
    return _failRedirect(res, returnTo, 'not_linked');
  }
  if (user.status === 'disabled') {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, userId: user.id,
      action: 'GOOGLE_MASTER_LOGIN_DENIED', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', reason: 'account_disabled' }
    });
    return _failRedirect(res, returnTo, 'account_disabled');
  }
  // Second factor: a user with MFA enabled does NOT receive a session here.
  // The Google round-trip only proves factor one; the account's own TOTP
  // (the project's existing mfaService, same as password login) must still
  // succeed through completeMfa before any access/refresh token exists.
  // The challenge carries no credential: it is an HMAC-signed, single-use,
  // 10-minute ticket in its own httpOnly cookie — never an access token,
  // never readable by authMiddleware, never granting any privilege.
  if (user.mfaEnabled) {
    const challenge = oauthState.issue({ mode: 'gchallenge', u: user.username, sid: user.id });
    res.cookie('g_mfa_ticket', challenge, {
      httpOnly: true, sameSite: 'lax', secure: IS_PROD, path: '/', maxAge: oauthState.STATE_TTL_MS
    });
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, userId: user.id,
      action: 'GOOGLE_MASTER_MFA_CHALLENGE', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', mode: 'login', mfa: true }
    });
    return res.redirect(302, _appendParam(_safeReturnTo(returnTo, '/'), 'gmfa', '1'));
  }
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  _setAuthCookies(res, accessToken, refreshToken);
  _audit({
    path: '/auth/google/master/callback', statusCode: 302, userId: user.id,
    action: 'GOOGLE_MASTER_LOGIN_SUCCESS', resourceId: user.id,
    ip: req.ip, changes: { provider: 'google', mode: 'login' }
  });
  res.redirect(302, _appendParam(_safeReturnTo(returnTo, '/'), 'gsignin', '1'));
}

async function _completeLink(req, res, state, claims, returnTo) {
  // Linking is a separate, explicitly authorized operation: authenticated
  // session bound in the state + verified Google identity + the approved
  // linking policy (configured master email, verified by Google).
  const subject = _sessionSubject(req);
  if (!subject || !state.u || String(subject.username) !== String(state.u)) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, action: 'GOOGLE_MASTER_LINK_DENIED',
      ip: req.ip, changes: { provider: 'google', reason: 'session_mismatch' }
    });
    return _failRedirect(res, returnTo, 'session_mismatch');
  }
  const policyEmail = String((oauthConfig.master && oauthConfig.master.email) || '').trim().toLowerCase();
  if (!policyEmail) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, userId: subject.id,
      action: 'GOOGLE_MASTER_LINK_DENIED', resourceId: subject.id,
      ip: req.ip, changes: { provider: 'google', reason: 'link_policy_unconfigured' }
    });
    return _failRedirect(res, returnTo, 'link_policy_unconfigured');
  }
  if (!claims.emailVerified || !claims.email || claims.email.toLowerCase() !== policyEmail) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, userId: subject.id,
      action: 'GOOGLE_MASTER_LINK_DENIED', resourceId: subject.id,
      ip: req.ip, changes: { provider: 'google', reason: 'email_mismatch' }
    });
    return _failRedirect(res, returnTo, 'email_mismatch');
  }
  const takenBy = googleOidc.findUserByGoogleSub(claims.sub);
  if (takenBy && takenBy.id !== subject.id) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, userId: subject.id,
      action: 'GOOGLE_MASTER_LINK_DENIED', resourceId: subject.id,
      ip: req.ip, changes: { provider: 'google', reason: 'sub_taken' }
    });
    return _failRedirect(res, returnTo, 'sub_taken');
  }
  const user = usersService.getById(subject.id);
  if (!user || user.status === 'disabled') {
    return _failRedirect(res, returnTo, 'session_invalid');
  }
  const oauthMap = Object.assign({}, user.oauth || {}, { google: claims.sub });
  const updated = usersService.update(user.id, { oauth: oauthMap });
  if (updated.error) {
    logger.error('oauthMaster.link update error:', updated.error);
    return _failRedirect(res, returnTo, 'link_failed');
  }
  _audit({
    path: '/auth/google/master/callback', statusCode: 302, userId: user.id,
    action: 'GOOGLE_MASTER_LINK_SUCCESS', resourceId: user.id,
    ip: req.ip, changes: { provider: 'google', mode: 'link' }
  });
  res.redirect(302, _appendParam(_safeReturnTo(returnTo, '/'), 'glink', '1'));
}

// GET /auth/google/master/callback — the ONLY place identity enters the
// system: state verified (signature + TTL + single use), code exchanged
// server-side, ID token verified (signature/iss/aud/exp/nonce), then the
// mode decides between login-by-sub and session-bound linking.
async function callbackMaster(req, res) {
  const state = oauthState.consume(req.query.state);
  if (!state) {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, action: 'GOOGLE_MASTER_LOGIN_DENIED',
      ip: req.ip, changes: { provider: 'google', reason: 'state_invalid' }
    });
    return _failRedirect(res, '/', 'state_invalid');
  }
  const returnTo = _safeReturnTo(state.returnTo, '/');
  if (!googleOidc.isConfigured()) return _failRedirect(res, returnTo, 'not_configured');
  const code = req.query.code;
  if (!code || typeof code !== 'string') {
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, action: 'GOOGLE_MASTER_LOGIN_DENIED',
      ip: req.ip, changes: { provider: 'google', reason: 'provider_error' }
    });
    return _failRedirect(res, returnTo, 'provider_error');
  }
  try {
    const idToken = await googleOidc.exchangeCode(code, state.cv);
    const claims = await googleOidc.verifyGoogleIdToken(idToken, state.nonce);
    if (state.mode === 'link') {
      return await _completeLink(req, res, state, claims, returnTo);
    }
    return await _completeLogin(req, res, claims, returnTo);
  } catch (err) {
    const codeMap = {
      exchange_failed: 'provider_error',
      provider_error: 'provider_error',
      invalid_idtoken: 'idtoken_invalid',
      nonce_mismatch: 'nonce_invalid',
      not_configured: 'not_configured'
    };
    const gerr = codeMap[err.code] || 'provider_error';
    _audit({
      path: '/auth/google/master/callback', statusCode: 302, action: 'GOOGLE_MASTER_LOGIN_DENIED',
      ip: req.ip, changes: { provider: 'google', reason: err.code || 'error' }
    });
    logger.warn('oauthMaster.callback failed:', err.code || err.message);
    return _failRedirect(res, returnTo, gerr);
  }
}

// POST /auth/google/master/link-session — step-up gate for linking:
// password re-authentication (the project's existing step-up mechanism,
// same contract as changePassword) issues a single-use ticket bound to
// the authenticated user. Scope guard: this whole path exists for the
// Platform Master surface only, so linking is limited to accounts that
// already hold an ACTIVE platform role — membership is read, never
// granted, written or altered.
function linkSession(req, res) {
  if (!_sameOrigin(req)) return error(res, 'Cross-origin request rejected', 403);
  if (!req.user) return error(res, 'Authentication required', 401);
  const { currentPassword } = req.body || {};
  if (currentPassword === undefined || currentPassword === null || currentPassword === '') {
    return error(res, 'currentPassword is required', 400);
  }
  const user = usersService.getById(req.user.id);
  if (!user) return error(res, 'User not found', 404);
  if (user.status === 'disabled') return error(res, 'User is disabled', 403);
  const verify = verifyPassword(currentPassword, user.password);
  if (!verify || !verify.match) {
    _audit({
      method: 'POST', path: '/auth/google/master/link-session', statusCode: 401, userId: user.id,
      action: 'GOOGLE_MASTER_LINK_DENIED', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', reason: 'bad_reauth' }
    });
    return error(res, 'Incorrect current password', 401);
  }
  if (!platformAdminService.platformRoleFor(user.username)) {
    _audit({
      method: 'POST', path: '/auth/google/master/link-session', statusCode: 403, userId: user.id,
      action: 'GOOGLE_MASTER_LINK_DENIED', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', reason: 'not_platform_member' }
    });
    return error(res, 'Only platform administrators can link a Google account', 403);
  }
  if (!googleOidc.isConfigured()) return error(res, 'Google sign-in is not configured', 501);
  const ticket = oauthState.issue({ mode: 'ticket', u: user.username });
  success(res, { ticket }, 'Link ticket issued');
}

// POST /auth/google/master/unlink — remove the Google sub from the
// CURRENT account only, behind the same password step-up. The password
// login path is untouched, so recovery always remains possible.
function unlink(req, res) {
  if (!_sameOrigin(req)) return error(res, 'Cross-origin request rejected', 403);
  if (!req.user) return error(res, 'Authentication required', 401);
  const { currentPassword } = req.body || {};
  if (currentPassword === undefined || currentPassword === null || currentPassword === '') {
    return error(res, 'currentPassword is required', 400);
  }
  const user = usersService.getById(req.user.id);
  if (!user) return error(res, 'User not found', 404);
  const verify = verifyPassword(currentPassword, user.password);
  if (!verify || !verify.match) return error(res, 'Incorrect current password', 401);
  // Membership gate, same policy as linkSession: unlinking is a Master
  // surface operation, so an ACTIVE platform membership with a valid
  // official role is required — resolved server-side from the platform
  // store, never from anything the client sends. platformRoleFor fails
  // closed: disabled, removed and unknown-role members are all rejected.
  if (!platformAdminService.platformRoleFor(user.username)) {
    _audit({
      method: 'POST', path: '/auth/google/master/unlink', statusCode: 403, userId: user.id,
      action: 'GOOGLE_MASTER_UNLINK_DENIED', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', reason: 'not_platform_member' }
    });
    return error(res, 'Only platform administrators can unlink a Google account', 403);
  }
  if (!user.oauth || !user.oauth.google) return error(res, 'No Google account linked', 404);
  const oauthMap = Object.assign({}, user.oauth);
  delete oauthMap.google;
  const updated = usersService.update(user.id, { oauth: oauthMap });
  if (updated.error) return error(res, updated.error, 400);
  _audit({
    method: 'POST', path: '/auth/google/master/unlink', statusCode: 200, userId: user.id,
    action: 'GOOGLE_MASTER_UNLINK_SUCCESS', resourceId: user.id,
    ip: req.ip, changes: { provider: 'google', mode: 'unlink' }
  });
  success(res, null, 'Google account unlinked');
}

// POST /auth/google/master/mfa — completes a Google login that stopped at
// the MFA challenge. The signed challenge cookie is read server-side (the
// body carries ONLY the TOTP/backup code), the existing mfaService does the
// verification, and the single-use consume happens atomically at success —
// so a wrong code keeps the challenge retryable (rate-limited), an expired
// or replayed one is rejected, and only then is a full session issued.
async function completeMfa(req, res) {
  if (!_sameOrigin(req)) return error(res, 'Cross-origin request rejected', 403);
  const ticket = parseCookies(req).g_mfa_ticket;
  const payload = ticket ? oauthState.verifyOnly(ticket) : null;
  if (!payload || payload.mode !== 'gchallenge') {
    return error(res, 'MFA challenge invalid or expired', 401);
  }
  const user = usersService.getById(payload.sid);
  if (!user || user.status === 'disabled' || !user.mfaEnabled) {
    return error(res, 'MFA challenge invalid or expired', 401);
  }
  const { token } = req.body || {};
  if (token === undefined || token === null || token === '') {
    return error(res, 'token is required', 400);
  }
  const result = mfaService.verifyLogin(user.id, String(token));
  if (result.error || !result.verified) {
    _audit({
      method: 'POST', path: '/auth/google/master/mfa', statusCode: 401, userId: user.id,
      action: 'GOOGLE_MASTER_MFA_DENIED', resourceId: user.id,
      ip: req.ip, changes: { provider: 'google', mfa: true, reason: 'bad_code' }
    });
    return error(res, 'Invalid MFA code', 401);
  }
  // Single-use: consume only after the second factor verified (verifyOnly
  // above never marked it used), so a replay after success is rejected.
  if (!oauthState.consume(ticket)) {
    return error(res, 'MFA challenge invalid or expired', 401);
  }
  res.clearCookie('g_mfa_ticket', { path: '/' });
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);
  _setAuthCookies(res, accessToken, refreshToken);
  _audit({
    method: 'POST', path: '/auth/google/master/mfa', statusCode: 200, userId: user.id,
    action: 'GOOGLE_MASTER_LOGIN_SUCCESS', resourceId: user.id,
    ip: req.ip, changes: { provider: 'google', mode: 'login', mfa: true }
  });
  success(res, { completed: true }, 'MFA verification successful');
}

module.exports = {
  initiateMaster,
  callbackMaster,
  initiateMasterLink,
  linkSession,
  completeMfa,
  unlink
};
