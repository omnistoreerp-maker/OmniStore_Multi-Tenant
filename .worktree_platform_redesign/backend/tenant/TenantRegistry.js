'use strict';

// TenantRegistry —— interface for future tenant registration/lookup.
//
// THIS IS INFRASTRUCTURE ONLY. It contains NO real CRUD, NO data, and NO
// database. The methods are stubs that document the future contract only.

class TenantRegistry {
  getById(_tenantId) {
    return null; // Stub — no registry storage exists yet.
  }

  list() {
    return []; // Stub — no registry storage exists yet.
  }

  create(_data) {
    throw new Error('Not implemented — tenant registry is not active');
  }

  update(_tenantId, _data) {
    throw new Error('Not implemented — tenant registry is not active');
  }

  remove(_tenantId) {
    throw new Error('Not implemented — tenant registry is not active');
  }
}

module.exports = TenantRegistry;