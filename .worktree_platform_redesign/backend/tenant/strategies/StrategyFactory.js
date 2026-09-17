'use strict';

// StrategyFactory —— creates the active tenant resolution strategy.
//
// Responsible ONLY for producing the active strategy from configuration.
// Current configuration: strategy = 'static'. No other strategy is allowed to
// execute at this time. Later phases may register additional strategies.

const StaticTenantStrategy = require('./StaticTenantStrategy');
const StrategyRegistry = require('./StrategyRegistry');

const DEFAULT_STRATEGY = 'static';

const StrategyFactory = {
  // Build a registry containing the StaticTenantStrategy (the only active one).
  buildRegistry(options) {
    const registry = new StrategyRegistry();
    registry.register(new StaticTenantStrategy(options));
    return registry;
  },

  // Create the active strategy from configuration.
  // If an unknown strategy name is requested, it falls back to the only
  // registered strategy (static) so no unregistered strategy ever executes.
  create(options, strategyName) {
    const registry = this.buildRegistry(options || {});
    const active = strategyName || DEFAULT_STRATEGY;
    const strategy = registry.get(active);
    if (strategy) {
      return strategy;
    }
    // Not allowed to run an unregistered strategy — return the only active one.
    return registry.get(DEFAULT_STRATEGY);
  }
};

module.exports = StrategyFactory;
module.exports.DEFAULT_STRATEGY = DEFAULT_STRATEGY;