'use strict';

// requestContext — Feature-flag-gated middleware.
//
// Responsibilities (nothing else):
//   1. When ENABLE_REQUEST_CONTEXT is false (default): no-op, next() immediately.
//   2. When ENABLE_REQUEST_CONTEXT is true: create an EMPTY RequestContext.
//   3. When BOTH ENABLE_REQUEST_CONTEXT and ENABLE_TENANT_RESOLUTION are true:
//      resolve the fixed default tenant via TenantResolver and attach the
//      resulting TenantContext to the request context. Then STOP.
//
// It performs no other logic — no user, no JWT, no locale, no timezone, no
// currency, no repository, no database. The TenantContext is carried but is
// not consumed by anything else in the system.

const config = require('../config');
const ContextFactory = require('../context/ContextFactory');
const TenantResolver = require('../tenant/TenantResolver');

const tenantResolver = new TenantResolver({ defaultTenantId: config.defaultTenantId });

function requestContext(req, res, next) {
  if (!config.requestContextEnabled) {
    return next();
  }

  let context = ContextFactory.createEmpty();

  if (config.tenantResolutionEnabled) {
    // Read-only fixed resolution from DEFAULT_TENANT_ID; never fails.
    const tenant = tenantResolver.resolveDefault();
    context = context.with({ tenant });
  }

  req.requestContext = context;
  return next();
}

module.exports = requestContext;