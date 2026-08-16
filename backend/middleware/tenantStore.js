'use strict';

// Request-scoped tenant store.
//
// Provides a global, per-request tenant accessor that repositories can use
// to obtain the current tenant context WITHOUT requiring the request object.
//
// Node.js is single-threaded, so a simple module-level variable is safe
// as long as:
//   - It is set at the start of each request (by tenantCarry or companyContext)
//   - It is cleared at the end of each request (by a cleanup middleware)
//
// Usage:
//   const tenantStore = require('../middleware/tenantStore');
//   tenantStore.set({ tenantId: 'company-a' });  // on request start
//   const tenant = tenantStore.get();              // in repository
//   tenantStore.clear();                           // on request end

let _currentTenant = null;

const tenantStore = {
  // Set the current tenant context for this request.
  set(tenant) {
    _currentTenant = tenant || null;
  },

  // Get the current tenant context (or null).
  get() {
    return _currentTenant;
  },

  // Clear the current tenant context (call at end of request).
  clear() {
    _currentTenant = null;
  },

  // Create a tenantAccessor compatible with BaseRepository constructor.
  createAccessor() {
    return {
      getCurrentTenant() {
        return _currentTenant;
      }
    };
  }
};

module.exports = tenantStore;
