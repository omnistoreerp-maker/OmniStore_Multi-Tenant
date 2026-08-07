'use strict';

// StaticTenantStrategy —— the ONLY active tenant resolution strategy.
//
// It resolves the fixed default tenant from configuration (DEFAULT_TENANT_ID),
// exactly as TenantResolver did in Phase 7. It never inspects Host, Header,
// JWT, Cookie, Subdomain or Database. This is the only strategy registered in
// the current configuration.

const BaseTenantStrategy = require('./BaseTenantStrategy');
const TenantContext = require('../TenantContext');

class StaticTenantStrategy extends BaseTenantStrategy {
  constructor(options) {
    super();
    this.defaultTenantId = (options && options.defaultTenantId) || 'default';
  }

  supports(_context) {
    // Static resolution always applies; it is the fallback/default strategy.
    return true;
  }

  resolve(_context) {
    // Read-Only fixed resolution from DEFAULT_TENANT_ID; never fails.
    return TenantContext.create({ tenantId: this.defaultTenantId });
  }

  name() {
    return 'static';
  }
}

module.exports = StaticTenantStrategy;