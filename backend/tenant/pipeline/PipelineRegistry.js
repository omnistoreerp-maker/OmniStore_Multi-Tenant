'use strict';

// PipelineRegistry —— registry of tenant identification steps.
//
// Responsible ONLY for: register a step, get a step, list steps, and prevent
// duplicate names. It holds no identification logic and no other behaviour.

class PipelineRegistry {
  constructor() {
    this._steps = new Map();
  }

  register(step) {
    if (!step || typeof step.name !== 'function') {
      throw new Error('PipelineRegistry.register requires a step with a name() method');
    }
    const name = step.name();
    if (this._steps.has(name)) {
      throw new Error(`Step already registered: ${name}`);
    }
    this._steps.set(name, step);
    return this;
  }

  get(name) {
    return this._steps.get(name) || null;
  }

  list() {
    return Array.from(this._steps.keys());
  }

  get size() {
    return this._steps.size;
  }
}

module.exports = PipelineRegistry;