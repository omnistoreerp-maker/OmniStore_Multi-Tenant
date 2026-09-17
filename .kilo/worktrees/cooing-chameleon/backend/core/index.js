'use strict';

// Core —— public barrel for the application runtime container layer.
//
// Assembling this module produces a single folder of self-contained, inert
// infrastructure. IMPORTANT: this module is NOT imported by the application
// runtime. It exists now only to expose the container API for future wiring.
// Nothing here reads, modifies, or depends on the running system (no JWT,
// request, repository, service, controller, middleware, database or fileStore
// involvement).

const ApplicationContainer = require('./ApplicationContainer');
const ServiceContainer = require('./ServiceContainer');
const DependencyResolver = require('./DependencyResolver');
const ServiceProvider = require('./ServiceProvider');
const ProviderRegistry = require('./ProviderRegistry');
const LifecycleManager = require('./LifecycleManager');
const ApplicationContext = require('./ApplicationContext');

module.exports = Object.freeze({
  ApplicationContainer,
  ServiceContainer,
  DependencyResolver,
  ServiceProvider,
  ProviderRegistry,
  LifecycleManager,
  ApplicationContext,
  errors: require('./ContainerErrors'),
  LIFECYCLE_STATES: require('./LifecycleManager').LIFECYCLE_STATES,
  SERVICE_KINDS: require('./ApplicationContext').SERVICE_KINDS
});