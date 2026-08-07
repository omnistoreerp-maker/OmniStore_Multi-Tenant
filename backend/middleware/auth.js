const { error: errorResponse } = require('../utils/apiResponse');
const { verifyAccessToken } = require('../utils/jwt');
const { isRevoked } = require('../utils/tokenStore');

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
    if (payload) req.user = { id: payload.sub, username: payload.username, role: payload.role };
  }
  next();
}

// Gate: rejects only when no valid token is presented.
function requireAuth(req, res, next) {
  if (req.user) return next();
  return errorResponse(res, 'Authentication required', 401);
}

module.exports = { authMiddleware, requireAuth, extractToken, parseCookies };
