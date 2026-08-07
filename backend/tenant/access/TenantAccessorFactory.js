'use strict';

// TenantAccessorFactory —— creates the active tenant accessor.
//
// Responsible ONLY for producing the active accessor. Current implementation:
// RequestTenantAccessor only.

const RequestTenantAccessor = require('./RequestTenantAccessor');
const TenantAccessorRegistry = require('./TenantAccessorRegistry');

const DEFAULT_ACCESSOR = 'RequestTenantAccessor';

const TenantAccessorFactory = {
  // Build a registry containing the RequestTenantAccessor (the only one).
  buildRegistry() {
    const registry = new TenantAccessorRegistry();
    registry.register(new RequestTenantAccessor());
    return registry;
  },

  // Create the active accessor from config (default: request).
  create(accessorName) {
    const registry = this.buildRegistry();
    const active = accessorName || DEFAULT_ACCESSOR;
    const accessor = registry.get(active);
    if (accessor) {
      return accessor;
    }
    // Unknown accessor -> fall back to the only registered one.
    return registry.get(DEFAULT_ACCESSOR);
  }
};

module.exports = TenantAccessorFactory;
module.exports.DEFAULT_ACCESSOR = DEFAULT_ACCESSOR;