'use strict';

// TenantErrors —— domain error types for the tenant infrastructure.
//
// Scaffolded only. Not wired into the runtime. Reserved error codes give
// future call sites a stable contract for distinguishing tenant failures.

class TenantError extends Error {
  constructor(code, message, meta) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.meta = meta || {};
  }
}

class TenantNotFoundError extends TenantError {
  constructor(meta) {
    super('TENANT_NOT_FOUND', 'Tenant not found', meta);
  }
}

class TenantInactiveError extends TenantError {
  constructor(meta) {
    super('TENANT_INACTIVE', 'Tenant is not active', meta);
  }
}

class TenantResolveError extends TenantError {
  constructor(meta) {
    super('TENANT_RESOLVE_ERROR', 'Failed to resolve tenant', meta);
  }
}

class TenantInvalidError extends TenantError {
  constructor(meta) {
    super('TENANT_INVALID', 'Invalid tenant identifier', meta);
  }
}

module.exports = {
  TenantError,
  TenantNotFoundError,
  TenantInactiveError,
  TenantResolveError,
  TenantInvalidError
};