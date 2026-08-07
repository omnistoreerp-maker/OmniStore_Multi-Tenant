'use strict';

// ContextTypes —— JSDoc-style type contracts for the request context domain.
//
// CommonJS (no TypeScript): documents shapes and offers small, pure
// validation helpers. NOT WIRED INTO RUNTIME.

/**
 * @typedef {Object} RequestContextData
 * Immutable per-request context object. All optional fields default to
 * null/false so a freshly created context is always "empty".
 *
 * @property {string|null} requestId       Unique id for this request.
 * @property {string|null} correlationId  Correlation id linking related requests.
 * @property {Object|null} tenant         Tenant handle (future); null until filled.
 * @property {Object|null} user           User handle (future); null until filled.
 * @property {string|null} locale         Locale string.
 * @property {string|null} timezone       IANA timezone.
 * @property {string|null} currency       ISO currency code.
 * @property {Object}      metadata       Arbitrary per-request metadata.
 */

function isValidRequestId(id) {
  return typeof id === 'string' && id.trim().length > 0;
}

function assertValidRequestId(id) {
  if (!isValidRequestId(id)) {
    throw new Error(`Invalid requestId: ${String(id)}`);
  }
  return id;
}

module.exports = {
  isValidRequestId,
  assertValidRequestId
};