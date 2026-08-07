const apiKeyService = require('../services/apiKey.service');

// Middleware: extracts and validates API key from X-API-Key header.
// Populates req.apiKey when valid. Never rejects — acts like authMiddleware.
// If no API key header is present, continues to JWT path.
function apiKeyMiddleware(req, res, next) {
  req.apiKey = null;
  const key = req.headers['x-api-key'];
  if (!key) return next();

  const record = apiKeyService.validateKey(key);
  if (!record) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or revoked API key',
      data: null
    });
  }

  req.apiKey = {
    id: record.id,
    name: record.name,
    userId: record.userId,
    scopes: record.scopes || [],
    rateLimitMax: record.rateLimitMax
  };

  // Update lastUsedAt (fire-and-forget, do not block request)
  apiKeyService.touchKey(record.id);

  next();
}

// Gate: rejects if no valid API key is present.
function requireApiKey(req, res, next) {
  if (req.apiKey) return next();
  return res.status(401).json({
    success: false,
    message: 'API key required',
    data: null
  });
}

// Scope-check gate: rejects if the API key lacks the required scope.
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({
        success: false,
        message: 'API key required',
        data: null
      });
    }
    if (!req.apiKey.scopes.includes(scope) && !req.apiKey.scopes.includes('*')) {
      return res.status(403).json({
        success: false,
        message: `Insufficient scope: ${scope} required`,
        data: null
      });
    }
    next();
  };
}

module.exports = { apiKeyMiddleware, requireApiKey, requireScope };
