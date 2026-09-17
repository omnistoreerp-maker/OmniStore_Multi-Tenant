'use strict';

// Tenant —— public barrel for the tenant infrastructure layer.
//
// Assembling this module produces a single folder of self-contained,
// inert infrastructure. IMPORTANT: this module is NOT imported by the
// application runtime. It exists now only to expose the tenant API for
// future wiring. Nothing here reads, modifies, or depends on the running
// system (no JWT, request, repository, service, controller, middleware,
// database or fileStore involvement).

const TenantContext = require('./TenantContext');
const TenantConfig = require('./TenantConfig');
const TenantResolver = require('./TenantResolver');
const TenantRegistry = require('./TenantRegistry');

module.exports = Object.freeze({
  TenantContext,
  TenantConfig,
  TenantResolver,
  TenantRegistry,
  strategies: require('./strategies'),
  pipeline: require('./pipeline'),
  access: require('./access'),
  constants: require('./TenantConstants'),
  errors: require('./TenantErrors'),
  types: require('./TenantTypes'),
  utils: require('./TenantUtils')
});