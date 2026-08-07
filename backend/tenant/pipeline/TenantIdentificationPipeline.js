'use strict';

// TenantIdentificationPipeline —— executes registered steps in order.
//
// Responsible ONLY for running the registered steps in registration order and
// stopping after the FIRST successful identification. Currently the pipeline
// executes StaticIdentificationStep and returns the resulting TenantContext.

const PipelineRegistry = require('./PipelineRegistry');

class TenantIdentificationPipeline {
  constructor(steps) {
    this.steps = Array.isArray(steps) ? steps : [];
  }

  // Run each step in order; stop at the first successful identification.
  identify(context) {
    for (const step of this.steps) {
      if (!step.supports(context)) {
        continue;
      }
      const result = step.identify(context);
      if (result != null) {
        return result;
      }
    }
    return null;
  }

  get size() {
    return this.steps.length;
  }
}

module.exports = TenantIdentificationPipeline;
module.exports.PipelineRegistry = PipelineRegistry;