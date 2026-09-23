'use strict';

// mockProvider — deterministic in-memory/test provider.
//
// NEVER wired in production. It exists so the full order → payment →
// provisioning → lifecycle pipeline can run (and be tested) without
// external credentials. Behaviour is controlled per-instance:
//
//   new MockProvider({
//     kind: 'mock',                  // reported in envelopes
//     latencyMs: 0,                  // simulated delay
//     failNext: { provisionServer: { retryable: true, code: 'CAPACITY', message: 'no capacity' } }
//   })
//
// `failNext[op]` makes the NEXT call of that operation fail once with
// the given envelope fields, then automatically clears — perfect for
// testing retry flows. `failAlways[op]` keeps failing until cleared
// (tests simulate a dead provider). All state lives in this instance,
// so tests construct isolated providers and register them via
// providerRegistry.registerProvider().

const { v4: uuidv4 } = require('uuid');
const { providerError, providerSuccess } = require('./providerContract');

function _consume(spec, op) {
  if (spec && spec.failNext && spec.failNext[op]) {
    const f = spec.failNext[op];
    delete spec.failNext[op];
    return f;
  }
  if (spec && spec.failAlways && spec.failAlways[op]) {
    return spec.failAlways[op];
  }
  return null;
}

function _externalKey(orderKey) {
  return 'mocksrv-' + String(orderKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
}

class MockProvider {
  constructor(opts) {
    this.kind = (opts && opts.kind) || 'mock';
    this.latencyMs = (opts && opts.latencyMs) || 0;
    this.failNext = Object.assign({}, opts && opts.failNext);
    this.failAlways = Object.assign({}, opts && opts.failAlways);
    // orderKey -> { externalId, endpoint, status, createdAt }
    this._instances = new Map();
  }

  async _delay() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  _find(orderKey) {
    return this._instances.get(String(orderKey)) || null;
  }

  async provisionServer(input) {
    await this._delay();
    const fail = _consume(this, 'provisionServer');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated provision failure', { retryable: !!fail.retryable, raw: fail });
    const key = String(input && input.orderKey || '');
    if (!key) return providerError(this.kind, 'INVALID_INPUT', 'orderKey is required', {});
    const existing = this._find(key);
    if (existing) {
      // Idempotent replay: return the SAME instance, never create a duplicate.
      return providerSuccess(this.kind, existing.status, { externalId: existing.externalId, endpoint: existing.endpoint, details: { replayed: true } }, { idempotentReplay: true });
    }
    const rec = {
      externalId: _externalKey(key) + '-' + uuidv4().slice(0, 8),
      endpoint: 'mock://' + String(input && input.serverName || 'server'),
      status: 'active',
      createdAt: new Date().toISOString()
    };
    this._instances.set(key, rec);
    return providerSuccess(this.kind, 'active', { externalId: rec.externalId, endpoint: rec.endpoint, details: { createdAt: rec.createdAt } }, null);
  }

  _requireInstance(input) {
    const key = String(input && input.orderKey || '');
    const rec = this._find(key);
    if (!rec) return { error: providerError(this.kind, 'NOT_FOUND', 'No mock instance for orderKey', {}) };
    return { rec };
  }

  async suspendServer(input) {
    await this._delay();
    const fail = _consume(this, 'suspendServer');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated suspend failure', { retryable: !!fail.retryable, raw: fail });
    const { rec, error: err } = this._requireInstance(input);
    if (err) return err;
    rec.status = 'suspended';
    return providerSuccess(this.kind, 'suspended', { externalId: rec.externalId }, null);
  }

  async resumeServer(input) {
    await this._delay();
    const fail = _consume(this, 'resumeServer');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated resume failure', { retryable: !!fail.retryable, raw: fail });
    const { rec, error: err } = this._requireInstance(input);
    if (err) return err;
    rec.status = 'active';
    return providerSuccess(this.kind, 'active', { externalId: rec.externalId }, null);
  }

  async terminateServer(input) {
    await this._delay();
    const fail = _consume(this, 'terminateServer');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated terminate failure', { retryable: !!fail.retryable, raw: fail });
    const { rec, error: err } = this._requireInstance(input);
    if (err) return err;
    rec.status = 'terminated';
    return providerSuccess(this.kind, 'terminated', { externalId: rec.externalId }, null);
  }

  async getServerStatus(input) {
    await this._delay();
    const fail = _consume(this, 'getServerStatus');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated status failure', { retryable: !!fail.retryable, raw: fail });
    const { rec, error: err } = this._requireInstance(input);
    if (err) return err;
    return providerSuccess(this.kind, rec.status, { externalId: rec.externalId, endpoint: rec.endpoint }, null);
  }

  async getUsage(input) {
    await this._delay();
    const fail = _consume(this, 'getUsage');
    if (fail) return providerError(this.kind, fail.code || 'MOCK_FAIL', fail.message || 'simulated usage failure', { retryable: !!fail.retryable, raw: fail });
    const { rec, error: err } = this._requireInstance(input);
    if (err) return err;
    return providerSuccess(this.kind, rec.status, null, { usage: { cpuPercent: 12.5, memoryPercent: 40, uptimeSeconds: 3600 }, externalId: rec.externalId });
  }
}

module.exports = { MockProvider };
