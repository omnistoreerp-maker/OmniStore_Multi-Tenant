'use strict';

// RequestTenantAccessor —— the ONLY accessor implementation.
//
// It simply reads the TenantContext from a RequestContext. No business logic,
// no filtering, no caching, no repository access. When no request context or
// no tenant is present, it returns null / false — it is a passive reader.

const BaseTenantAccessor = require('./BaseTenantAccessor');

class RequestTenantAccessor extends BaseTenantAccessor {
  getCurrentTenant(context) {
    if (!context) return null;
    // context is expected to be a RequestContext carrying a .tenant tenant.
    const tenant = context.tenant;
    return tenant != null ? tenant : null;
  }

  hasTenant(context) {
    return this.getCurrentTenant(context) != null;
  }

  clear(_context) {
    // No-op placeholder for a future per-request lifecycle; keeps the
    // contract satisfied without introducing any state today.
    return undefined;
  }
}

module.exports = RequestTenantAccessor;