'use strict';

// StrategyRegistry —— registry of tenant resolution strategies.
//
// Responsible ONLY for: register a strategy, get a strategy, list strategies,
// and prevent duplicates. It holds no resolution logic and no other behaviour.

class StrategyRegistry {
  constructor() {
    this._strategies = new Map();
  }

  // Register a strategy by its name(). Throws on duplicates.
  register(strategy) {
    if (!strategy || typeof strategy.name !== 'function') {
      throw new Error('StrategyRegistry.register requires a strategy with a name() method');
    }
    const name = strategy.name();
    if (this._strategies.has(name)) {
      throw new Error(`Strategy already registered: ${name}`);
    }
    this._strategies.set(name, strategy);
    return this;
  }

  // Get a strategy by name.
  get(name) {
    return this._strategies.get(name) || null;
  }

  // List all registered strategy names.
  list() {
    return Array.from(this._strategies.keys());
  }

  get size() {
    return this._strategies.size;
  }
}

module.exports = StrategyRegistry;