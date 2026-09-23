'use strict';

// gameHosting/provider — legacy façade over the provider registry.
//
// The Phase B controller (gameHostingProvider.js in controllers/) used
// a hard-coded BLOCKED module. This façade keeps the old import path
// and call shape (`execute(action, ctx)`) working while delegating to
// the new provider-agnostic contract, so existing callers and tests
// keep passing during the migration.

const { getActiveProvider, getStatus } = require('./providerRegistry');

function getStatusLegacy() {
  const reg = getStatus();
  const provider = getActiveProvider();
  const isReal = reg.isRealProvider;
  return {
    status: isReal ? 'READY' : (reg.configured === 'unavailable' ? 'BLOCKED' : 'MOCK'),
    reason: reg.note ||
      (isReal
        ? 'Real provider adapter active.'
        : 'No real provider integration is active. Operations run against the "' + reg.configured + '" adapter (non-production). A real provider adapter must be implemented before production provisioning.'),
    implementedOperations: isReal ? ['start', 'stop', 'terminate', 'provision', 'deprovision'] : [],
    blockedOperations: isReal ? [] : ['start', 'stop', 'terminate', 'provision', 'deprovision'],
    providerKind: provider.kind,
    configured: reg.configured,
    isRealProvider: isReal,
    lastUpdated: new Date().toISOString()
  };
}

// Legacy shape: execute('provision'|'start'|'stop'|'terminate', ctx)
// Map legacy action names onto contract operations.
const LEGACY_ACTION_MAP = {
  provision: 'provisionServer',
  start: 'resumeServer',
  stop: 'suspendServer',
  terminate: 'terminateServer',
  deprovision: 'terminateServer'
};

async function execute(action, context) {
  const op = LEGACY_ACTION_MAP[action];
  if (!op) {
    return { status: 'ERROR', operation: action, reason: 'Unknown provider action: ' + action, timestamp: new Date().toISOString() };
  }
  const provider = getActiveProvider();
  try {
    const result = await provider[op](context || {});
    return {
      status: result.ok ? 'OK' : 'ERROR',
      operation: action,
      provider: result.provider,
      reason: result.ok ? null : (result.message || 'Provider operation failed'),
      code: result.code || null,
      retryable: result.retryable || false,
      timestamp: new Date().toISOString(),
      raw: result.raw
    };
  } catch (err) {
    return { status: 'ERROR', operation: action, reason: err.message, timestamp: new Date().toISOString() };
  }
}

module.exports = { getStatus: getStatusLegacy, execute };
