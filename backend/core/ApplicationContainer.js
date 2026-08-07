'use strict';

// ApplicationContainer —— the composition root for a future application runtime.
//
// Infrastructure only; NOT wired into the runtime and NOT instantiated anywhere.
// This is the single entry point that, when finally adopted, will compose
// Configuration, Repositories, TenantContext, Logger, Cache, Storage, Database
// Provider, Feature Flags, Metrics, Events and Scheduler. Today it loads NOTHING
// — it is an empty, safe blueprint.

const ServiceContainer = require('./ServiceContainer');
const LifecycleManager = require('./LifecycleManager');
const ApplicationContext = require('./ApplicationContext');
const ProviderRegistry = require('./ProviderRegistry');
class ApplicationContainer {
  constructor({ appName, env } = {}) {
    this.appName = appName || 'digitronics-backend';
    this.env = env || process.env.NODE_ENV || 'development';
    this.services = new ServiceContainer();
    this.lifecycle = new LifecycleManager();
    this.providers = new ProviderRegistry();
    this._context = null;
    // INTENTIONALLY: nothing is registered, resolved, or started here.
  }

  // Future boot: assembles every provider and exposes an ApplicationContext.
  // Currently a NO-REGION stub — documented contract only.
  async boot() {
    // register providers, resolve singletons, seal context
    this._context = ApplicationContext.create({
      appName: this.appName,
      env: this.env
    });
    return this._context;
  }

  get context() {
    return this._context;
  }

  get isBooted() {
    return this._context !== null;
  }
}

module.exports = ApplicationContainer;