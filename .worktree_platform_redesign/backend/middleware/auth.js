const { error: errorResponse } = require('../utils/apiResponse');
const { verifyAccessToken } = require('../utils/jwt');
const { isRevoked } = require('../utils/tokenStore');
const usersService = require('../services/users.service');

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach(part => {
    const idx = part.indexOf('=');
    if (idx > -1) {
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      // Tolerate malformed percent-encoding instead of throwing URIError.
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

// Global middleware: populates req.user when a valid token is present.
// Never rejects — route protection is opt-in via requireAuth/requireRole.
function authMiddleware(req, res, next) {
  req.user = null;
  const token = extractToken(req);
  if (token && !isRevoked(token)) {
    const payload = verifyAccessToken(token);
    if (payload) {
      // Phase D — token-version validation against the STORED user record. When
      // the sub resolves to a real user, a token signed before a tokenVersion
      // bump (e.g. a password change/reset) is treated as unauthenticated.
      // Tokens without a `ver` claim are interpreted as version 0, so
      // pre-Phase-D credentials stay valid for users whose version is still 0.
      // A token whose sub has NO stored record is trusted exactly as before
      // (legacy/synthetic identities — Phase C contract): version enforcement
      // applies to real records only.
      const storedUser = usersService.getById(payload.sub);
      if (storedUser) {
        const tokenVersion = payload.ver === undefined ? 0 : Number(payload.ver);
        const storedVersion = Number(storedUser.tokenVersion) || 0;
        if (tokenVersion !== storedVersion) {
          next();
          return;
        }
      }
      // Phase 19 — carry the securely-bound tenant (when present) alongside the
      // authenticated identity. `payload.tenantId` is an optional claim: tokens
      // without it (legacy / pre-Phase-19) simply yield `tenantId: undefined`.
      req.user = {
        id: payload.sub,
        username: payload.username,
        role: payload.role,
        tenantId: payload.tenantId
      };
    }
  }
  next();
}

// Gate: rejects only when no valid token is presented.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return errorResponse(res, 'Authentication required', 401);
}

module.exports = { authMiddleware, requireAuth, extractToken, parseCookies };
