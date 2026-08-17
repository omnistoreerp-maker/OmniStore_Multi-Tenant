'use strict';

// Request-scoped tenant store, backed by AsyncLocalStorage.
//
// The previous implementation used a module-level mutable variable
// (`let _currentTenant`). That is safe ONLY while request processing is fully
// synchronous: one request completes before the next one mutates the shared
// slot. The moment `await` enters the request path, two interleaved requests
// can corrupt each other's tenant:
//
//   Request A -> tenantStore.set('tenant-A') -> await ...
//   Request B -> tenantStore.set('tenant-B')
//   Request A resumes -> tenantStore.get() -> sees 'tenant-B'   <-- LEAK
//
// AsyncLocalStorage (node:async_hooks) gives every async execution chain its
// own private storage slot. As long as each HTTP request is processed inside
// its own ALS context (see `middleware` below), every await continuation of
// that request reads and writes ITS OWN tenant — no cross-request leakage.
//
// Public API is unchanged (set / get / clear / createAccessor), so the
// existing callers keep working with zero modifications:
//   - tenantCarry            -> tenantStore.clear() / tenantStore.set(...)
//   - companyContext         -> tenantStore.set(...)
//   - repositories/index.js  -> tenantStore.createAccessor()
//
// Usage in server.js (must run BEFORE tenantCarry and companyContext):
//   app.use(tenantStore.middleware);
//   // each request now runs inside a fresh { tenant: null } ALS context
//
// Behaviour outside a request context:
//   - get()  -> null  (never invents a tenant, never leaks global state)
//   - set()  -> no-op (nothing to write into; stays a no-op)
//   - clear()-> no-op

const { AsyncLocalStorage } = require('node:async_hooks');

const als = new AsyncLocalStorage();

const tenantStore = {
  // Express middleware: opens a fresh, empty tenant context for ONE request
  // and runs the rest of the chain (tenantCarry -> companyContext ->
  // controller -> service -> repository, and every async continuation of
  // them) inside that context.
  middleware(req, res, next) {
    als.run({ tenant: null }, () => next());
  },

  // Set the current tenant context for this request.
  set(tenant) {
    const store = als.getStore();
    if (!store) return; // outside a request context — never leak globally
    store.tenant = tenant || null;
  },

  // Get the current tenant context (or null).
  get() {
    const store = als.getStore();
    return store ? store.tenant : null;
  },

  // Clear the current tenant context (call at start/end of request).
  clear() {
    const store = als.getStore();
    if (store) store.tenant = null;
  },

  // Create a tenantAccessor compatible with BaseRepository constructor.
  createAccessor() {
    return {
      getCurrentTenant() {
        return tenantStore.get();
      }
    };
  }
};

module.exports = tenantStore;
