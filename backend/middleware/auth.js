const { error: errorResponse } = require('../utils/apiResponse');
const { verifyAccessToken } = require('../utils/jwt');
const { isAccessTokenRevoked, isFamilyRevoked, isLegacyTokenRevoked } = require('../utils/tokenStore.sqlite');
const usersService = require('../services/users.service');
const tenantMembership = require('../services/tenantMembership.service');
const config = require('../config');

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      try { out[key] = decodeURIComponent(raw); } catch (_) { out[key] = raw; }
    }
  });
  return out;
}

function extractToken(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  const cookies = parseCookies(req);
  return cookies.access_token || null;
}

const CHALLENGE_PURPOSES = ['google_mfa', 'google_tenant_selection'];
const LEGACY_CHALLENGE_MARKERS = ['mfaPending', 'mfaRequired', 'tenantSelectionRequired'];

function authMiddleware(req, res, next) {
  req.user = null;
  const token = extractToken(req);
  if (!token) return next();

  try {
    const payload = verifyAccessToken(token);
    if (!payload) return next();

    // Non-access credentials (e.g. market customer tokens) are verified by
    // their own middleware; this global hook must not reject them.
    if (payload.type && payload.type !== 'access') {
      return next();
    }
    if (payload.purpose && CHALLENGE_PURPOSES.includes(payload.purpose)) {
      return errorResponse(res, 'Authentication required', 401);
    }
    const legacyMarker = Object.keys(payload).find(
      (key) => LEGACY_CHALLENGE_MARKERS.includes(key) && payload[key] === true
    );
    if (legacyMarker) {
      return errorResponse(res, 'Authentication required', 401);
    }

    const { jti, familyId, sub, ver, tenantId } = payload;

    // Pre-F4 revocations were hashes of the exact token. The migration imports
    // them into legacy_revocations; keep honouring them here so a token revoked
    // before the upgrade cannot regain access.
    if (isLegacyTokenRevoked(token)) {
      return next();
    }

    if (isAccessTokenRevoked(jti)) {
      return next();
    }

    if (familyId) {
      if (isFamilyRevoked(familyId, sub)) {
        return next();
      }
    }

    const storedUser = usersService.getById(sub);
    // Legacy/synthetic identities (no stored record) keep the historic trust
    // contract: the signed token alone authenticates.
    if (storedUser) {
      if (storedUser.status === 'disabled') {
        return next();
      }

      const tokenVersion = ver === undefined ? 0 : Number(ver);
      const storedVersion = Number(storedUser.tokenVersion) || 0;
      if (tokenVersion !== storedVersion) {
        return next();
      }

      if (tenantId && config.tenantUserMembershipEnabled) {
        if (tenantMembership.isTenantDenied(storedUser, tenantId)) {
          return next();
        }
      }
    }

    req.user = {
      id: sub,
      username: payload.username,
      role: payload.role,
      tenantId
    };
  } catch (e) {
    return errorResponse(res, 'Auth store unavailable', 503);
  }
  next();
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  return errorResponse(res, 'Authentication required', 401);
}

module.exports = { authMiddleware, requireAuth, extractToken, parseCookies };