'use strict';

// Strategies —— public barrel for tenant resolution strategies.
//
// Exposes the strategy classes and factory. Used by TenantResolver to stay
// decoupled from how tenants are actually resolved.

const BaseTenantStrategy = require('./BaseTenantStrategy');
const StaticTenantStrategy = require('./StaticTenantStrategy');
const StrategyRegistry = require('./StrategyRegistry');
const StrategyFactory = require('./StrategyFactory');

module.exports = Object.freeze({
  BaseTenantStrategy,
  StaticTenantStrategy,
  StrategyRegistry,
  StrategyFactory,
  DEFAULT_STRATEGY: StrategyFactory.DEFAULT_STRATEGY
});