'use strict';

// PipelineFactory —— assembles the tenant identification pipeline.
//
// Responsible ONLY for assembling the pipeline from its registered steps.
// Current pipeline: StaticIdentificationStep ONLY. No other step may run.

const TenantIdentificationPipeline = require('./TenantIdentificationPipeline');
const StaticIdentificationStep = require('./StaticIdentificationStep');

const PipelineFactory = {
  // Build the current pipeline (StaticIdentificationStep only).
  create(options) {
    const pipeline = new TenantIdentificationPipeline([]);
    // Static step is the only active step; it is registered in order.
    pipeline.steps.push(new StaticIdentificationStep(options || {}));
    return pipeline;
  }
};

module.exports = PipelineFactory;