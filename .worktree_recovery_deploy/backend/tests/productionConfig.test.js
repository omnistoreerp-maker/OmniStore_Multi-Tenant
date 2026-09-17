'use strict';

// Phase 37 — production startup safety validation.
//
// validateProductionConfig() is a pure function in backend/config/index.js:
//   - development/test config is always a no-op
//   - production with the weak default JWT secret is FATAL (must refuse boot)
//   - production with auth disabled or open CORS is a WARNING (loud, not fatal)
//     because the documented Koyeb bootstrap and same-origin Windows install
//     legitimately use them — but they must never be silent.

const { validateProductionConfig } = require('../config');

function prod(overrides) {
  return {
    isProduction: true,
    jwtSecret: 'a-strong-random-production-secret-123',
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
});
