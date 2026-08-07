'use strict';

// TenantTypes — JSDoc-style type contracts for the tenant domain.
//
// This is a CommonJS module (no TypeScript) that describes shapes via
// documentation and small factory/validator helpers. NOT WIRED INTO RUNTIME.

const { TENANT_STATUS } = require('./TenantConstants');

/**
 * @typedef {Object} TenantContextData
 * A fully-resolved tenant context attached to an in-flight identity.
 *
 * @property {string} tenantId            Unique tenant identifier.
 * @property {string|null} [tenantName]   Display name of the tenant.
 * @property {string} [status]            One of TENANT_STATUS.
 * @property {string} [storageProvider]   Storage provider name (see STORAGE_PROVIDERS).
 * @property {string} [databaseProvider]  Database provider name (see DATABASE_PROVIDERS).
 * @property {string|null} [region]       Deployment region, if any.
 * @property {string|null} [timezone]     IANA timezone, if any.
 * @property {string|null} [currency]     ISO currency code, if any.
 * @property {string|null} [locale]       Locale string, if any.
 * @property {string[]} [features]        Enabled feature set.
 * @property {Object} [metadata]          Arbitrary tenant metadata.
 */

/**
 * @typedef {Object} TenantResolutionResult
 * @property {string|null} tenantId   Resolved tenant id, or null when none.
 * @property {string} source          How the tenant was resolved (host, header,
 *                                    token, domain, default).
 * @property {Object} [context]       Associated context, if resolvable.
 */

function isValidTenantId(tenantId) {
  return typeof tenantId === 'string' && tenantId.trim().length > 0;
}

function assertValidTenantId(tenantId) {
  if (!isValidTenantId(tenantId)) {
    throw new Error(`Invalid tenantId: ${String(tenantId)}`);
  }
  return tenantId;
}

function isActiveStatus(status) {
  return status === TENANT_STATUS.ACTIVE;
}

module.exports = {
  isValidTenantId,
  assertValidTenantId,
  isActiveStatus
};