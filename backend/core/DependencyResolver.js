'use strict';

// DependencyResolver —— resolution strategy for building services.
//
// Infrastructure only; NOT wired into the runtime. It resolves a provider's
// declared dependencies into a deps map ready for construction. The base is a
// working, dependency-free resolver; it can operate stand-alone (no container)
// so it poses zero runtime risk.

const { CircularDependencyError, ServiceNotFoundError } = require('./ContainerErrors');

class DependencyResolver {
  constructor() {
    this._resolving = new Set();
  }

  // Build a dependency map for the provider, resolving each dependency's id.
  // `resolveOne(id)` is supplied by the caller (container composition).
  resolve(provider, resolveOne) {
    const deps = {};
    for (const depId of provider.dependencies) {
      if (this._resolving.has(depId)) {
        throw new CircularDependencyError({ chain: Array.from(this._resolving), depId });
      }
      const value = resolveOne(depId);
      if (value === undefined) {
        throw new ServiceNotFoundError({ serviceId: depId });
      }
      deps[depId] = value;
    }
    return deps;
  }

  // Wrap resolution of an individual service with cycle tracking.
  resolveWithTrace(provider, resolveOne) {
    this._resolving.add(provider.id);
    try {
      return resolveOne(provider.id);
    } finally {
      this._resolving.delete(provider.id);
    }
  }
}

module.exports = DependencyResolver;