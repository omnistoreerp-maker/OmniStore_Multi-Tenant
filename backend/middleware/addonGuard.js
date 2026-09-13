'use strict';

// Feature-flag/add-on guard middleware.
//
// Usage:
//   const { requireAddon } = require('./addonGuard');
//   const tenantAddons = require('../services/tenantAddons.service');
//
//   router.get('/advanced-reports',
//     requireAddon('advanced_reports', async (tenantId, addonKey) => {
//       const result = await tenantAddons.hasAddon({ tenantContext: { tenantId } }, addonKey);
//       return result;
//     }),
//     handler);
//
// The guard never mutates production state. It only reads tenant/addon data
// and either calls next() or returns 403.

function resolveTenantId(req) {
  if (req && req.tenantContext && req.tenantContext.tenantId != null) {
    return String(req.tenantContext.tenantId);
  }
  if (req && req.user && req.user.tenantId != null) {
    return String(req.user.tenantId);
  }
  if (req && req.headers && req.headers['x-tenant-id'] != null) {
    return String(req.headers['x-tenant-id']);
  }
  return null;
}

function requireAddon(addonKey, checkTenantAddonFn) {
  if (!addonKey || typeof checkTenantAddonFn !== 'function') {
    throw new Error('requireAddon(addonKey, checkFn) requires a non-empty addonKey and an async check function');
  }

  return async (req, res, next) => {
    try {
      const tenantId = resolveTenantId(req);
      if (!tenantId) {
        return res.status(400).json({ error: 'MISSING_TENANT_ID', message: 'Tenant identifier is required.' });
      }

      const hasAddon = await checkTenantAddonFn(tenantId, String(addonKey));
      if (!hasAddon) {
        return res.status(403).json({
          error: 'ADDON_LOCKED',
          message: 'The feature ' + String(addonKey) + ' is not active for this tenant.'
        });
      }

      next();
    } catch (err) {
      if (res.headersSent) return;
      res.status(500).json({ error: 'INTERNAL_CHECK_ERROR' });
    }
  };
}

module.exports = { requireAddon };
