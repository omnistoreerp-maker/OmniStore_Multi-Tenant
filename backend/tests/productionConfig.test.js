'use strict';

 // Phase 37 — production startup safety validation.
 //
 // validateProductionConfig() is a pure function in backend/config/index.js:
 //   - development/test config is always a no-op
 //   - production with the weak default JWT secret is FATAL (must refuse boot)
 //   - production with auth disabled or open CORS is a WARNING (loud, not fatal)
 //     because the documented Koyeb bootstrap and same-origin Windows install
 //     legitimately use them — but they must never be silent.
 //
 // runProductionStartupGate() wraps validateProductionConfig and returns
 // { ok, fatal, warnings } where ok === (fatal.length === 0). It logs via an
 // optional logger but never calls process.exit.

 const { validateProductionConfig, runProductionStartupGate } = require('../config');

function prod(overrides) {
  return {
    isProduction: true,
    jwtSecret: 'a-strong-random-production-secret-123',
    jwtRefreshSecret: 'a-strong-independent-refresh-secret-456',
    jwtRefreshSecretExplicit: true,
    authRequired: true,
    corsOrigins: 'https://app.example.com',
    ...overrides
  };
}

describe('validateProductionConfig', () => {
  test('development configuration is always a no-op', () => {
    const { fatal, warnings } = validateProductionConfig({ isProduction: false, jwtSecret: 'dev-secret', authRequired: false, corsOrigins: '' });
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('safe production configuration passes cleanly', () => {
    const { fatal, warnings } = validateProductionConfig(prod());
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('production with the weak default JWT secret is FATAL', () => {
    const { fatal, warnings } = validateProductionConfig(prod({ jwtSecret: 'dev-secret' }));
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.some(m => /JWT_SECRET/.test(m))).toBe(true);
    expect(warnings).toEqual([]);
  });

  test('production with an empty JWT secret is FATAL', () => {
    const { fatal } = validateProductionConfig(prod({ jwtSecret: '' }));
    expect(fatal.length).toBeGreaterThan(0);
  });

  test('production with authentication disabled warns loudly but is not fatal', () => {
    const { fatal, warnings } = validateProductionConfig(prod({ authRequired: false }));
    expect(fatal).toEqual([]);
    expect(warnings.some(m => /AUTH_REQUIRED/.test(m))).toBe(true);
  });

  test('production with open CORS warns loudly but is not fatal', () => {
    const { fatal, warnings } = validateProductionConfig(prod({ corsOrigins: '' }));
    expect(fatal).toEqual([]);
    expect(warnings.some(m => /CORS_ORIGINS/.test(m))).toBe(true);
  });

  test('multiple unsafe settings accumulate distinct messages', () => {
    const { fatal, warnings } = validateProductionConfig(prod({ jwtSecret: 'dev-secret', authRequired: false, corsOrigins: '' }));
    expect(fatal.length).toBe(1);
    expect(warnings.length).toBe(2);
    expect([...fatal, ...warnings].some(m => /JWT_SECRET/.test(m))).toBe(true);
    expect([...fatal, ...warnings].some(m => /AUTH_REQUIRED/.test(m))).toBe(true);
    expect([...fatal, ...warnings].some(m => /CORS_ORIGINS/.test(m))).toBe(true);
  });

  // F3 — refresh secret validation.
  test('production with a missing refresh secret is FATAL', () => {
    const { fatal } = validateProductionConfig(prod({ jwtRefreshSecret: '', jwtRefreshSecretExplicit: false }));
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
  });

  test('production with the derived refresh default is FATAL', () => {
    const { fatal } = validateProductionConfig(prod({ jwtSecret: 'a-strong-random-production-secret-123', jwtRefreshSecret: 'a-strong-random-production-secret-123:refresh', jwtRefreshSecretExplicit: false }));
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
  });

  test('production with refresh secret identical to access secret is FATAL', () => {
    const { fatal } = validateProductionConfig(prod({ jwtRefreshSecret: 'a-strong-random-production-secret-123', jwtRefreshSecretExplicit: true }));
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
  });

  test('production with the dev refresh default is FATAL', () => {
    const { fatal } = validateProductionConfig(prod({ jwtRefreshSecret: 'dev-secret', jwtRefreshSecretExplicit: true }));
    expect(fatal.length).toBeGreaterThan(0);
    expect(fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
  });

  test('production with independent refresh secret passes', () => {
    const { fatal, warnings } = validateProductionConfig(prod());
    expect(fatal).toEqual([]);
    expect(warnings).toEqual([]);
  });

  test('error messages name the setting but never reveal its value', () => {
    const { fatal } = validateProductionConfig(prod({ jwtRefreshSecret: 'a-strong-random-production-secret-123' }));
    const joined = fatal.join(' | ');
    expect(joined).not.toContain('a-strong-random-production-secret-123');
    expect(joined).toContain('JWT_REFRESH_SECRET');
  });
});

describe('runProductionStartupGate', () => {
  // Minimal logger that captures calls without side effects.
  function makeLogger() {
    const logs = { error: [], warn: [], info: [], debug: [] };
    return {
      logger: {
        error: (...args) => logs.error.push(args.join(' ')),
        warn: (...args) => logs.warn.push(args.join(' ')),
        info: (...args) => logs.info.push(args.join(' ')),
        debug: (...args) => logs.debug.push(args.join(' '))
      },
      logs
    };
  }

  test('valid production configuration returns ok: true', () => {
    const { logger, logs } = makeLogger();
    const result = runProductionStartupGate(prod(), logger);
    expect(result.ok).toBe(true);
    expect(result.fatal).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(logs.error).toEqual([]);
    expect(logs.warn).toEqual([]);
  });

  test('missing explicit JWT_REFRESH_SECRET returns ok: false', () => {
    const { logger, logs } = makeLogger();
    const result = runProductionStartupGate(prod({ jwtRefreshSecret: '', jwtRefreshSecretExplicit: false }), logger);
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
    expect(result.fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
    expect(logs.error.length).toBeGreaterThan(0);
    expect(logs.error.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
  });

  test('derived refresh secret returns ok: false', () => {
    const { logger, logs } = makeLogger();
    const result = runProductionStartupGate(prod({ jwtSecret: 'a-strong-random-production-secret-123', jwtRefreshSecret: 'a-strong-random-production-secret-123:refresh', jwtRefreshSecretExplicit: false }), logger);
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
    expect(result.fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
    expect(logs.error.length).toBeGreaterThan(0);
  });

  test('access and refresh secrets being identical returns ok: false', () => {
    const { logger, logs } = makeLogger();
    const result = runProductionStartupGate(prod({ jwtRefreshSecret: 'a-strong-random-production-secret-123', jwtRefreshSecretExplicit: true }), logger);
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
    expect(result.fatal.some(m => /JWT_REFRESH_SECRET/.test(m))).toBe(true);
    expect(logs.error.length).toBeGreaterThan(0);
  });

  test('warnings alone do not block startup (ok: true)', () => {
    const { logger, logs } = makeLogger();
    const result = runProductionStartupGate(prod({ authRequired: false, corsOrigins: '' }), logger);
    expect(result.ok).toBe(true);
    expect(result.fatal).toEqual([]);
    expect(result.warnings.length).toBe(2);
    expect(logs.error).toEqual([]);
    expect(logs.warn.length).toBe(2);
  });

  test('fatal and warning messages do not reveal secret values', () => {
    const { logger, logs } = makeLogger();
    const secret = 'a-strong-random-production-secret-123';
    const result = runProductionStartupGate(prod({ jwtSecret: secret, jwtRefreshSecret: secret, jwtRefreshSecretExplicit: true }), logger);
    const allMessages = [...logs.error, ...logs.warn].join(' | ');
    expect(allMessages).not.toContain(secret);
    expect(allMessages).toContain('JWT_REFRESH_SECRET');
  });

  test('logger absence does not crash the helper', () => {
    const result = runProductionStartupGate(prod({ jwtSecret: 'dev-secret' }));
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
  });

  test('minimal logger with only error/warn does not crash the helper', () => {
    const minimalLogger = { error: () => {}, warn: () => {} };
    const result = runProductionStartupGate(prod({ jwtSecret: 'dev-secret' }), minimalLogger);
    expect(result.ok).toBe(false);
    expect(result.fatal.length).toBeGreaterThan(0);
  });

  test('fatal messages are logged exactly once per call', () => {
    const { logger, logs } = makeLogger();
    runProductionStartupGate(prod({ jwtSecret: 'dev-secret' }), logger);
    // One 'Refusing to start' message + one fatal message
    expect(logs.error.length).toBe(2);
    expect(logs.error[0]).toBe('Refusing to start: unsafe production configuration.');
    expect(logs.error[1]).toMatch(/JWT_SECRET/);
  });

  test('warning messages are logged exactly once per call', () => {
    const { logger, logs } = makeLogger();
    runProductionStartupGate(prod({ authRequired: false, corsOrigins: '' }), logger);
    expect(logs.error).toEqual([]);
    expect(logs.warn.length).toBe(2);
    expect(logs.warn[0]).toMatch(/AUTH_REQUIRED/);
    expect(logs.warn[1]).toMatch(/CORS_ORIGINS/);
  });

  test('valid configuration produces no fatal or warning logs', () => {
    const { logger, logs } = makeLogger();
    runProductionStartupGate(prod(), logger);
    expect(logs.error).toEqual([]);
    expect(logs.warn).toEqual([]);
  });
});
