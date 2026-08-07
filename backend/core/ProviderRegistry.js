'use strict';

// ProviderRegistry —— index of service providers keyed by id.
//
// Infrastructure only; NOT wired into the runtime. Provides inert
// registration/lookup helpers so future composition can resolve providers.
// No global mutable state is created at import time — instances only.

const { ProviderAlreadyRegisteredError, ServiceNotFoundError } = require('./ContainerErrors');

class ProviderRegistry {
  constructor() {
    this._providers = new Map();
  }

  register(provider) {
    if (!provider || !provider.id) {
      throw new Error('ProviderRegistry requires a provider with an id');
    }
    if (this._providers.has(provider.id)) {
      throw new ProviderAlreadyRegisteredError({ serviceId: provider.id });
    }
    this._providers.set(provider.id, provider);
    return provider;
  }

  has(id) {
    return this._providers.has(id);
  }

  get(id) {
    if (!this._providers.has(id)) {
      throw new ServiceNotFoundError({ serviceId: id });
    }
    return this._providers.get(id);
  }

  list() {
    return Array.from(this._providers.keys());
  }

  size() {
    return this._providers.size;
  }
}

module.exports = ProviderRegistry;