'use strict';

// providerContract — the Game Hosting provider boundary.
//
// Every Game Hosting provider adapter MUST implement the operations in
// REQUIRED_OPERATIONS and MUST return the envelope documented below.
// Business logic (order service / provisioning orchestrator) NEVER
// imports a concrete provider: it resolves the active adapter through
// the provider registry only.
//
// Operation contract (async, MUST never throw for expected failure —
// return the error envelope instead; throwing is reserved for
// programming errors):
//
//   provisionServer(input) -> ProvisionResult
//     input: { orderRef, orderKey (idempotency key), planName, planId,
//             serverName, region, customerId, tenantId, meta }
//     result: { ok: true, status: 'active',
//               server: { externalId, endpoint, details }, raw } |
//             { ok: false, retryable: bool, code, message, raw }
//
//   suspendServer(input)   -> { ok: true, status: 'suspended', raw } | error envelope
//   resumeServer(input)    -> { ok: true, status: 'active', raw }    | error envelope
//   terminateServer(input) -> { ok: true, status: 'terminated', raw }| error envelope
//   getServerStatus(input) -> { ok: true, status: <provider state>, raw } | error envelope
//     input: { orderRef, externalId, tenantId }
//   getUsage(input)        -> { ok: true, usage: {...}, raw }        | error envelope
//
// renew/extend is NOT a provider operation in this platform: renewal
// extends the subscription validity (orderService) and keeps the same
// provisioned instance. Providers that need an explicit extension call
// may expose it via getServerStatus/meta — the orchestrator does not
// depend on it.
//
// Idempotency: provisionServer MUST treat `orderKey` as the
// idempotency key. Repeated calls with the same orderKey MUST return
// the same logical instance (same externalId) and MUST NOT create a
// duplicate. This is what makes provisioning retries safe.

const REQUIRED_OPERATIONS = Object.freeze([
  'provisionServer',
  'suspendServer',
  'resumeServer',
  'terminateServer',
  'getServerStatus',
  'getUsage'
]);

function _base(kind, raw) {
  const out = { ok: false, provider: kind };
  if (raw !== undefined) out.raw = raw;
  return out;
}

// Helper for adapters: build a standard failure envelope.
function providerError(kind, code, message, opts) {
  const out = _base(kind, opts && opts.raw);
  out.code = String(code || 'PROVIDER_ERROR');
  out.message = String(message || 'Provider operation failed');
  out.retryable = Boolean(opts && opts.retryable);
  return out;
}

// Helper for adapters: build a standard success envelope.
function providerSuccess(kind, status, payload, raw) {
  const out = _base(kind, raw);
  out.ok = true;
  out.status = status;
  if (payload) out.server = payload;
  return out;
}

function validateProvider(name, provider) {
  const missing = REQUIRED_OPERATIONS.filter((op) => typeof provider[op] !== 'function');
  if (missing.length) {
    throw new Error('Provider "' + name + '" is missing required operations: ' + missing.join(', '));
  }
  return true;
}

module.exports = {
  REQUIRED_OPERATIONS,
  providerError,
  providerSuccess,
  validateProvider
};
