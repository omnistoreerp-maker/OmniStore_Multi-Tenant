'use strict';

// ServiceContainer —— a minimal, dependency-injected service locator.
//
// Infrastructure only; NOT wired into the runtime. It manages registered
// providers and can resolve singletons on demand. It is inert at import time
// (no instances, no external state) and supports a Composition-Root-ready
// registration API.

const { ServiceAlreadyRegisteredError, ServiceNotFoundError } = require('./ContainerErrors');
const ProviderRegistry = require('./ProviderRegistry');
const DependencyResolver = require('./DependencyResolver');

class ServiceContainer {
  constructor() {
    this._registry = new ProviderRegistry();
    this._resolver = new DependencyResolver();
    this._instances = new Map();
  }

  register(provider) {
    this._registry.register(provider);
    return this;
  }

  has(id) {
    return this._registry.has(id);
  }

  get(id) {
    if (this._instances.has(id)) {
      return this._instances.get(id);
    }
    const provider = this._registry.get(id);
    const deps = this._resolver.resolve(
      provider,
      (depId) => this.get(depId) // recursive resolution, cycle-safe via resolver
    );
    const instance = provider.build(deps);
    if (provider.singleton) {
      this._instances.set(id, instance);
    }
    return instance;
  }

  registered() {
    return this._registry.list();
  }
}

module.exports = ServiceContainer;