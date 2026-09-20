const apiKeyService = require('../services/apiKey.service');
const { trustedTenantId, resolveTenantRoleForRequest } = require('../middleware/authorize');
const { isPrivilegedRole } = require('../services/authorization.service');
const { success, error } = require('../utils/apiResponse');

// Trusted actor context for ownership-scoped API key operations. The tenant is
// the server-side reconstructed tenant (signed token claim), never client
// input; privilege is resolved against the effective (per-tenant) role.
function _actorCtx(req) {
  const tenantId = trustedTenantId(req) || null;
  const userId = req.user ? req.user.id : null;
  const effective = resolveTenantRoleForRequest(req);
  const role = effective !== undefined ? effective : (req.user ? req.user.role : undefined);
  const privileged = Boolean(role && isPrivilegedRole(role));
  return { tenantId, userId, privileged };
}

// POST /api/v1/api-keys — Generate a new API key
function generate(req, res) {
  try {
    const { name, scopes, rateLimitMax, expiresAt } = req.body;
    if (!name) return error(res, 'API key name is required', 400);

    const keyData = apiKeyService.generateKey({
      name,
      userId: req.user ? req.user.id : null,
      tenantId: trustedTenantId(req),
      scopes: scopes || ['read'],
      rateLimitMax,
      expiresAt
    });

    // Return the raw key — this is the ONLY time it is visible.
    return success(res, keyData, 'API key generated successfully', 201);
  } catch (err) {
    return error(res, err.message || 'Failed to generate API key', err.message ? 400 : 500);
  }
}

// GET /api/v1/api-keys — List API keys (tenant- and ownership-scoped)
function list(req, res) {
  try {
    const ctx = _actorCtx(req);
    const keys = apiKeyService.listKeys({
      tenantId: ctx.tenantId,
      // Non-privileged callers can only ever list their own keys.
      userId: !ctx.privileged ? ctx.userId : (req.query.userId || undefined),
      enabled: req.query.enabled !== undefined ? req.query.enabled === 'true' : undefined
    });
    return success(res, keys, 'API keys retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve API keys', 500);
  }
}

// GET /api/v1/api-keys/stats — Get API key statistics
function getStats(req, res) {
  try {
    const stats = apiKeyService.getKeyStats(trustedTenantId(req));
    return success(res, stats, 'API key statistics retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve statistics', 500);
  }
}

// GET /api/v1/api-keys/:id — Get a specific API key
function getById(req, res) {
  try {
    const key = apiKeyService.getKey(req.params.id, _actorCtx(req));
    if (!key) return error(res, 'API key not found', 404);
    return success(res, key, 'API key retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve API key', 500);
  }
}

// POST /api/v1/api-keys/:id/revoke — Revoke an API key
function revoke(req, res) {
  try {
    const key = apiKeyService.revokeKey(req.params.id, _actorCtx(req));
    if (!key) return error(res, 'API key not found', 404);
    return success(res, key, 'API key revoked');
  } catch (err) {
    return error(res, 'Failed to revoke API key', 500);
  }
}

// DELETE /api/v1/api-keys/:id — Delete an API key permanently
function remove(req, res) {
  try {
    const key = apiKeyService.deleteKey(req.params.id, _actorCtx(req));
    if (!key) return error(res, 'API key not found', 404);
    return success(res, null, 'API key deleted');
  } catch (err) {
    return error(res, 'Failed to delete API key', 500);
  }
}

// POST /api/v1/api-keys/:id/enable — Enable an API key
function enable(req, res) {
  try {
    const key = apiKeyService.setKeyEnabled(req.params.id, true, _actorCtx(req));
    if (!key) return error(res, 'API key not found', 404);
    return success(res, key, 'API key enabled');
  } catch (err) {
    return error(res, 'Failed to enable API key', 500);
  }
}

// POST /api/v1/api-keys/:id/disable — Disable an API key
function disable(req, res) {
  try {
    const key = apiKeyService.setKeyEnabled(req.params.id, false, _actorCtx(req));
    if (!key) return error(res, 'API key not found', 404);
    return success(res, key, 'API key disabled');
  } catch (err) {
    return error(res, 'Failed to disable API key', 500);
  }
}

// GET /api/v1/api-keys/validate — Validate an API key (diagnostic endpoint)
function validate(req, res) {
  try {
    const key = req.headers['x-api-key'];
    if (!key) return error(res, 'No API key provided', 400);

    const record = apiKeyService.validateKey(key);
    if (!record) return error(res, 'Invalid or revoked API key', 401);

    return success(res, {
      valid: true,
      keyId: record.id,
      name: record.name,
      scopes: record.scopes
    }, 'API key is valid');
  } catch (err) {
    return error(res, 'Failed to validate API key', 500);
  }
}

module.exports = {
  generate,
  list,
  getStats,
  getById,
  revoke,
  remove,
  enable,
  disable,
  validate
};
