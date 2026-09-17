'use strict';

// TenantAccessorRegistry —— registry of tenant accessors.
//
// Responsible ONLY for: register, get, list, and prevent duplicate names.
// It holds no access logic and no other behaviour.

class TenantAccessorRegistry {
  constructor() {
    this._accessors = new Map();
  }

  register(accessor) {
    if (!accessor || typeof accessor.getCurrentTenant !== 'function') {
      throw new Error('TenantAccessorRegistry.register requires an accessor with getCurrentTenant()');
    }
    const name = accessor.constructor.name;
    if (this._accessors.has(name)) {
      throw new Error(`Accessor already registered: ${name}`);
    }
    this._accessors.set(name, accessor);
    return this;
  }

  get(name) {
    return this._accessors.get(name) || null;
  }

  list() {
    return Array.from(this._accessors.keys());
  }

  get size() {
    return this._accessors.size;
  }
}

module.exports = TenantAccessorRegistry;