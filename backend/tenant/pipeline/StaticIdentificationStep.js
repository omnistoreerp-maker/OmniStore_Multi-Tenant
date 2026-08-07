'use strict';

// StaticIdentificationStep —— the ONLY active identification step.
//
// It merely delegates to StaticTenantStrategy. It adds NO additional logic —
// no header/host/JWT/cookie/API-key/database inspection. This step always
// supports a context and always yields the configured default tenant.

const BaseIdentificationStep = require('./BaseIdentificationStep');
const StaticTenantStrategy = require('../strategies/StaticTenantStrategy');

class StaticIdentificationStep extends BaseIdentificationStep {
  constructor(options) {
    super();
    this.strategy = new StaticTenantStrategy(options || {});
  }

  supports(_context) {
    return true;
  }

  identify(context) {
    return this.strategy.resolve(context);
  }

  name() {
    return 'static';
  }
}

module.exports = StaticIdentificationStep;