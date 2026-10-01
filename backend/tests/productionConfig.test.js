'use strict';

// Phase 37 — production startup safety validation.
//
// validateProductionConfig() is a pure function in backend/config/index.js:
//   - development/test config is always a no-op
//   - production with the weak default JWT secret is FATAL (must refuse boot)
//   - production with auth disabled, open CORS, or any tenant-isolation flag
//     disabled is a WARNING (loud, not fatal) because the documented Koyeb
//     bootstrap and same-origin Windows install legitimately use them — but
//     they must never be silent.
// resolveSecurityFlag() is the fail-closed flag resolver: unset = ON in
// production, OFF in dev/test; explicit 'true'/'false' always wins.

const { validateProductionConfig, resolveSecurityFlag } = require('../config');

function prod(overrides) {
  return {
    isProduction: true,
    jwtSecret: 'a-strong-random-production-secret-123',
    authRequired: true,
    corsOrigins: 'https://app.example.com',
    tenantResolutionEnabled: true,
    tenantMetadataEnabled: true,
    tenantFilteringEnabled: true,
    tenantEntityIsolationEnabled: true,
    tenantSalesIsolationEnabled: true,
    tenantPurchasesIsolationEnabled: true,
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

  test('explicitly disabled tenant isolation warns loudly and names every disabled flag', () => {
    const { fatal, warnings } = validateProductionConfig(prod({
      tenantFilteringEnabled: false,
      tenantSalesIsolationEnabled: false
    }));
    expect(fatal).toEqual([]);
    const iso = warnings.find(m => /ENABLE_TENANT_FILTERING/.test(m));
    expect(iso).toBeTruthy();
    expect(iso).toMatch(/ENABLE_TENANT_SALES_ISOLATION/);
    expect(iso).toMatch(/isolation/i);
  });

  test('all six isolation flags disabled produces one aggregated warning', () => {
    const { warnings } = validateProductionConfig(prod({
      tenantResolutionEnabled: false,
      tenantMetadataEnabled: false,
      tenantFilteringEnabled: false,
      tenantEntityIsolationEnabled: false,
      tenantSalesIsolationEnabled: false,
      tenantPurchasesIsolationEnabled: false
    }));
    const iso = warnings.filter(m => /ENABLE_TENANT_/.test(m));
    expect(iso.length).toBe(1);
    for (const flag of ['ENABLE_TENANT_RESOLUTION', 'ENABLE_TENANT_METADATA', 'ENABLE_TENANT_FILTERING', 'ENABLE_TENANT_ENTITY_ISOLATION', 'ENABLE_TENANT_SALES_ISOLATION', 'ENABLE_TENANT_PURCHASES_ISOLATION']) {
      expect(iso[0]).toContain(flag);
    }
  });
});

// Runtime tenant security — fail-closed flag resolution (backend/config/index.js).
//   unset   -> production ON, dev/test OFF (legacy behavior preserved)
//   'true'  -> ON everywhere
//   'false' -> OFF everywhere (documented bootstrap opt-out must stay possible)
describe('resolveSecurityFlag (fail-closed production defaults)', () => {
  test('unset defaults to ON in production', () => {
    expect(resolveSecurityFlag(undefined, true)).toBe(true);
    expect(resolveSecurityFlag(process.env.SOME_UNSET_VAR, true)).toBe(true);
  });

  test('unset keeps legacy default OFF in development and test', () => {
    expect(resolveSecurityFlag(undefined, false)).toBe(false);
  });

  test('explicit true wins everywhere', () => {
    expect(resolveSecurityFlag('true', true)).toBe(true);
    expect(resolveSecurityFlag('true', false)).toBe(true);
  });

  test('explicit false wins everywhere (documented bootstrap opt-out)', () => {
    expect(resolveSecurityFlag('false', true)).toBe(false);
    expect(resolveSecurityFlag('false', false)).toBe(false);
  });

  test('anything other than the exact strings follows the environment default', () => {
    expect(resolveSecurityFlag('', true)).toBe(true);
    expect(resolveSecurityFlag('1', true)).toBe(true);
    expect(resolveSecurityFlag('yes', false)).toBe(false);
    expect(resolveSecurityFlag(undefined, false)).toBe(false);
  });
});
