'use strict';

// BaseTenantAccessor —— abstract contract for accessing the current tenant.
//
// A stable abstraction that repositories may depend on in FUTURE phases.
// It is intentionally NOT injected into any repository today. Only the
// RequestTenantAccessor implements it at this stage.

class BaseTenantAccessor {
  // Return the current TenantContext, or null when none is present.
  // eslint-disable-next-line no-unused-vars
  getCurrentTenant(context) {
    throw new Error('BaseTenantAccessor.getCurrentTenant() not implemented');
  }

  // Whether a tenant is present in the given context.
  // eslint-disable-next-line no-unused-vars
  hasTenant(context) {
    throw new Error('BaseTenantAccessor.hasTenant() not implemented');
  }

  // For future per-request lifecycle cleanup. No-op placeholder contract.
  // eslint-disable-next-line no-unused-vars
  clear(context) {
    throw new Error('BaseTenantAccessor.clear() not implemented');
  }
}

module.exports = BaseTenantAccessor;