'use strict';

// providerRegistry — resolves the ACTIVE Game Hosting provider adapter.
//
// Business logic never imports a concrete adapter. The registry selects
// by GAME_HOSTING_PROVIDER:
//   unset / 'mock'           → MockProvider (explicit test/dry-run only)
//   'unavailable'            → UnavailableProvider (structured failures)
//   anything else            → UnavailableProvider with an integration
//                              dependency note (real adapters register
//                              themselves via registerProvider() once
//                              their integration is actually built).
//
// The selection is captured at require-time (envOverride lets tests pin
// a specific adapter). In production the default resolves to
// 'unavailable' so the platform never fakes real provisioning.

const { MockProvider } = require('./mockProvider');
const { UnavailableProvider } = require('./unavailableProvider');
const { validateProvider } = require('./providerContract');

const _customProviders = new Map();

function registerProvider(name, provider) {
  validateProvider(name, provider);
  _customProviders.set(String(name).toLowerCase(), provider);
  return true;
}

function _resolveName() {
  const raw = (process.env.GAME_HOSTING_PROVIDER || '').trim().toLowerCase();
  if (!raw || raw === 'mock' || raw === 'test') {
    return { name: 'mock', note: null };
  }
  if (raw === 'unavailable' || raw === 'none') {
    return { name: 'unavailable', note: null };
  }
  return {
    name: raw,
    note: 'Provider "' + raw + '" is not implemented in this build. ' +
      'Register a real adapter via registerProvider() before production provisioning.'
  };
}

// Stable adapter instances: the active adapter is a process-level
// singleton so stateful adapters (e.g. the mock's instance registry)
// behave consistently across calls. Tests that need isolation should
// register a custom provider instead of re-resolving.
const _activeCache = new Map();

function getActiveProvider(envOverride) {
  const resolved = _resolveName();
  const name = envOverride ? String(envOverride).toLowerCase() : resolved.name;
  const custom = _customProviders.get(name);
  if (custom) return custom;
  if (_activeCache.has(name)) return _activeCache.get(name);
  let instance;
  if (name === 'unavailable') {
    instance = new UnavailableProvider(resolved.note || undefined);
  } else {
    // 'mock' / unknown → deterministic mock, flagged in the envelope so
    // operators can tell simulated infrastructure from real.
    instance = new MockProvider({ kind: 'mock' });
  }
  _activeCache.set(name, instance);
  return instance;
}

function getStatus() {
  const resolved = _resolveName();
  return {
    configured: resolved.name,
    active: resolved.name,
    isRealProvider: resolved.name !== 'mock' && resolved.name !== 'unavailable' && _customProviders.has(resolved.name),
    note: resolved.note,
    lastUpdated: new Date().toISOString()
  };
}

module.exports = {
  registerProvider,
  getActiveProvider,
  getStatus,
  // exposed for tests
  _resetForTests() { _customProviders.clear(); _activeCache.clear(); }
};
