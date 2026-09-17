'use strict';

// Access —— public barrel for the tenant access layer.
//
// Exposes the accessor classes and factory. This abstraction is NOT injected
// into any repository or service yet; it exists as a stable dependency target
// for future phases.

const BaseTenantAccessor = require('./BaseTenantAccessor');
const RequestTenantAccessor = require('./RequestTenantAccessor');
const TenantAccessorFactory = require('./TenantAccessorFactory');
const TenantAccessorRegistry = require('./TenantAccessorRegistry');

module.exports = Object.freeze({
  BaseTenantAccessor,
  RequestTenantAccessor,
  TenantAccessorFactory,
  TenantAccessorRegistry,
  DEFAULT_ACCESSOR: TenantAccessorFactory.DEFAULT_ACCESSOR
});