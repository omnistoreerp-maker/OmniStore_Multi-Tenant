'use strict';

// BaseTenantStrategy —— pure abstract interface for tenant resolution strategies.
//
// All concrete strategies implement these three contracts. The base class
// itself performs no resolution and holds no state. It is NOT wired into the
// runtime; it is the contract future phases (Header/Host/Subdomain/Jwt/ApiKey/
// Database) will implement.

class BaseTenantStrategy {
  // Whether this strategy can resolve given the context.
  // eslint-disable-next-line no-unused-vars
  supports(context) {
    throw new Error('BaseTenantStrategy.supports() not implemented');
  }

  // Resolve a TenantContext from the context. Returns TenantContext or throws.
  // eslint-disable-next-line no-unused-vars
  resolve(context) {
    throw new Error('BaseTenantStrategy.resolve() not implemented');
  }

  // A stable, unique name for the strategy.
  name() {
    throw new Error('BaseTenantStrategy.name() not implemented');
  }
}

module.exports = BaseTenantStrategy;