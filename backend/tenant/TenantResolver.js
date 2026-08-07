'use strict';

// TenantResolver —— identifies a tenant via the tenant identification pipeline.
//
// It is fully decoupled from HOW tenants are identified. It simply builds the
// pipeline via PipelineFactory and delegates to it. The pipeline runs the
// StaticIdentificationStep (the ONLY active step), which in turn delegates to
// StaticTenantStrategy. Host/Header/JWT/Cookie/Subdomain/Database are never
// inspected at this stage.

const PipelineFactory = require('./pipeline').PipelineFactory;

class TenantResolver {
  constructor(options) {
    const opts = options || {};
    // Pipeline assembled by the factory.
    this.pipeline = PipelineFactory.create(opts);
  }

  // Identify the fixed default tenant via the pipeline (Read-Only).
  // Uses only the configured DEFAULT_TENANT_ID — no external inputs.
  resolveDefault(context) {
    return this.pipeline.identify(context);
  }

  // Explicit alias kept for interface compatibility.
  resolve(context) {
    return this.resolveDefault(context);
  }

  // Expose the sole active step name (for observability / verification).
  get activeStrategy() {
    const step = this.pipeline.steps[0];
    return step ? step.name() : 'none';
  }
}

module.exports = TenantResolver;