const { randomUUID } = require('crypto');
const auditService = require('../services/audit.service');

// Resource mapping: extract resource name from request path.
// /api/v1/sales → sales, /api/v1/sales/:id → sales, etc.
function _extractResource(path) {
  const parts = path.replace(/^\/+/, '').split('/');
  // Skip 'api' and 'v1' prefixes
  if (parts[0] === 'api' && parts[1] && parts[1].startsWith('v')) {
    return parts[2] || null;
  }
  return parts[0] || null;
}

// HTTP method to action mapping
function _methodToAction(method) {
  const map = { POST: 'create', PUT: 'update', PATCH: 'update', DELETE: 'delete' };
  return map[method] || method.toLowerCase();
}

// Extract resource ID from path (last segment if it looks like an ID)
function _extractResourceId(path) {
  const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);
  const last = parts[parts.length - 1];
  // Skip action segments like 'stats', 'validate', 'enable', 'disable', 'revoke'
  const actions = ['stats', 'validate', 'enable', 'disable', 'revoke', 'backup-codes', 'secret', 'status', 'refresh', 'logout', 'me', 'roles', 'permissions', 'providers'];
  if (actions.includes(last)) return null;
  // If it looks like a UUID or a non-route-segment, return it
  if (last && !last.startsWith(':') && last !== 'api' && !last.startsWith('v')) {
    return last;
  }
  return null;
}

// Middleware: generates request correlation ID and sets X-Request-Id header.
// Applied to ALL requests (GET, POST, PUT, DELETE).
function correlationId(req, res, next) {
  req.requestId = req.headers['x-request-id'] || randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

// Middleware: captures audit data for mutating requests (POST, PUT, PATCH, DELETE).
// Attaches to res.on('finish') to capture the response status code.
// Only captures mutations — GET requests are NOT audited.
function auditCapture(req, res, next) {
  const method = req.method.toUpperCase();

  // Only audit mutating operations
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return next();
  }

  const startTime = process.hrtime.bigint();
  const resource = _extractResource(req.path);
  const action = _methodToAction(method);
  const resourceId = _extractResourceId(req.path);

  // Capture request body for after snapshot (sanitized)
  const bodyBefore = req.body ? JSON.parse(JSON.stringify(req.body)) : null;

  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - startTime) / 1e6;

    try {
      auditService.record({
        requestId: req.requestId,
        method,
        path: req.originalUrl || req.path,
        statusCode: res.statusCode,
        userId: req.user ? req.user.id : null,
        apiKeyId: req.apiKey ? req.apiKey.id : null,
        ip: req.ip || req.connection.remoteAddress || null,
        userAgent: req.headers['user-agent'] || null,
        action,
        resource,
        resourceId,
        duration: Math.round(duration),
        changes: {
          before: null,
          after: bodyBefore
        }
      });
    } catch (_) {
      // Audit failures must never break the request
    }
  });

  next();
}

module.exports = { correlationId, auditCapture };
