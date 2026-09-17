'use strict';

// ServiceProvider —— minimal Provider-pattern abstraction.
//
// InfRastructure only; NOT wired into the runtime. A provider is a factory
// that knows how to build one concrete service/component. It declares which
// dependencies (by id) it needs and whether it should be treated as a
// singleton. Future composition will register one provider per component.

class ServiceProvider {
  constructor(options) {
    this.id = options.id;
    this.dependencies = Array.isArray(options.dependencies) ? options.dependencies.slice() : [];
    this.singleton = options.singleton !== false; // default: true
    this._resolved = null;
  }

  // Build the concrete component. Contracts: receives the resolved dependency
  // map and returns the instance. Base only documents the contract; concrete
  // providers override this.
  // eslint-disable-next-line no-unused-vars
  register(container) {
    throw new Error('ServiceProvider.register(container) not implemented — provider is not active');
  }

  build(deps) {
    return this.register(deps);
  }

  static compose(options, buildFn) {
    const provider = new ServiceProvider(options);
    provider.build = buildFn;
    return provider;
  }
}

module.exports = ServiceProvider;