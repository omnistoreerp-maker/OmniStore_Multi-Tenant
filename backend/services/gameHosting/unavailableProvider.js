'use strict';

// unavailableProvider — the safe default when no real provider is
// configured (no credentials / no integration built yet).
//
// Per the module protocol: when no real provider exists we do NOT
// fake production provisioning. Every operation returns a structured
// NOT_CONFIGURED envelope marked non-retryable so the orchestrator
// records the failure and the order stays recoverable — the platform
// surfaces "provider integration unavailable" instead of pretending.

const { providerError } = require('./providerContract');

class UnavailableProvider {
  constructor(reason) {
    this.kind = 'unavailable';
    this.reason = reason || 'No Game Hosting provider is configured. Provisioning requires a real provider integration (credentials + adapter).';
  }

  _blocked(op) {
    return providerError(this.kind, 'NOT_CONFIGURED', this.reason, { retryable: false, raw: { operation: op } });
  }

  async provisionServer() { return this._blocked('provisionServer'); }
  async suspendServer() { return this._blocked('suspendServer'); }
  async resumeServer() { return this._blocked('resumeServer'); }
  async terminateServer() { return this._blocked('terminateServer'); }
  async getServerStatus() { return this._blocked('getServerStatus'); }
  async getUsage() { return this._blocked('getUsage'); }
}

module.exports = { UnavailableProvider };
