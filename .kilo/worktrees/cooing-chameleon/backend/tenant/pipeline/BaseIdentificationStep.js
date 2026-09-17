'use strict';

// BaseIdentificationStep —— abstract contract for tenant identification steps.
//
// A step inspects some source (static config, host, header, JWT, cookie, API
// key, database — future) and, if it supports the context, identifies a tenant.
// The base is a pure contract; it holds no logic. Extension points only.

class BaseIdentificationStep {
  // Whether this step can identify for the given context.
  // eslint-disable-next-line no-unused-vars
  supports(context) {
    throw new Error('BaseIdentificationStep.supports() not implemented');
  }

  // Attempt to identify a TenantContext. Resolves with a TenantContext when
  // successful, or signals "not identified" for the next step.
  // eslint-disable-next-line no-unused-vars
  identify(context) {
    throw new Error('BaseIdentificationStep.identify() not implemented');
  }

  // A stable, unique name for the step.
  name() {
    throw new Error('BaseIdentificationStep.name() not implemented');
  }
}

module.exports = BaseIdentificationStep;