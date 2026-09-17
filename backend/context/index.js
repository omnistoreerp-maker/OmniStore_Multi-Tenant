'use strict';

// Context —— public barrel for the request context infrastructure layer.
//
// Assembling this module produces a single folder of self-contained, inert
// infrastructure. IMPORTANT: this module is NOT imported by the application
// runtime. It exists only to expose the request-context API for future wiring.
// Nothing here reads real requests, uses Express, AsyncLocalStorage, JWT,
// tenants, middleware, or any part of the running system.

const RequestContext = require('./RequestContext');
const ContextFactory = require('./ContextFactory');
const ContextStore = require('./ContextStore');

module.exports = Object.freeze({
  RequestContext,
  ContextFactory,
  ContextStore,
  errors: require('./ContextErrors'),
  types: require('./ContextTypes'),
  utils: require('./ContextUtils')
});