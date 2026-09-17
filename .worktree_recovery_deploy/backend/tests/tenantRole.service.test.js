'use strict';

// Phase 17 — Tenant-Scoped User Roles: unit tests for the pure service.
//
// Verifies the data-layer helpers only: normalize, roleForTenant,
// hasTenantRole, resolveEffectiveRole. No app bootstrapping, no HTTP, no config
// dependence — the service is deliberately config-free, so these tests are
// deterministic under any feature-flag state.

const tenantRole = require('../services/tenantRole.service');

describe('tenantRole.service normalize', () => {
  it('returns undefined when value is not provided (nullish)', () => {
    expect(tenantRole.normalize(undefined)).toBeUndefined();
    expect(tenantRole.normalize(null)).toBeUndefined();
  });

  it('returns undefined for an empty object map', () => {
    expect(tenantRole.normalize({})).toBeUndefined();
  });

  it('returns undefined for an empty array', () => {
    expect(tenantRole.normalize([])).toBeUndefined();
  });

  it('normalizes a plain object map { tenantId: role }', () => {
    expect(tenantRole.normalize({ digitronics: 'Admin', nile: 'Manager' }))
      .toEqual({ digitronics: 'Admin', nile: 'Manager' });
  });

  it('normalizes a single record { tenantId, role }', () => {
    expect(tenantRole.normalize({ tenantId: 'omni', role: 'Cashier' }))
      .toEqual({ omni: 'Cashier' });
  });

  it('normalizes an array of records { tenantId, role }', () => {
    expect(tenantRole.normalize([
      { tenantId: 'digitronics', role: 'Admin' },
      { tenantId: 'nile', role: 'Manager' }
    ])).toEqual({ digitronics: 'Admin', nile: 'Manager' });
  });

  it('trims ids and roles', () => {
    expect(tenantRole.normalize({ '  nile  ': '  Cashier  ' }))
      .toEqual({ nile: 'Cashier' });
  });

  it('skips empty ids and empty roles', () => {
    expect(tenantRole.normalize({ '': 'Admin', nile: '  ' })).toBeUndefined();
    expect(tenantRole.normalize([{ tenantId: ' ', role: 'Admin' }])).toBeUndefined();
  });

  it('skips non-object entries (plain strings) defensively', () => {
    expect(tenantRole.normalize(['nile', 'omni'])).toBeUndefined();
  });

  it('skips null/undefined entries in an array', () => {
    expect(tenantRole.normalize([null, undefined, { tenantId: 'nile', role: 'Manager' }]))
      .toEqual({ nile: 'Manager' });
  });

  it('last id wins on duplicate tenant ids', () => {
    expect(tenantRole.normalize([
      { tenantId: 'nile', role: 'Manager' },
      { tenantId: 'nile', role: 'Cashier' }
    ])).toEqual({ nile: 'Cashier' });
  });
});

describe('tenantRole.service — roleForTenant / hasTenantRole', () => {
  const user = {
    role: 'Admin',
    tenantRoles: { digitronics: 'Manager', nile: 'Cashier' }
  };

  it('returns the per-tenant role when present', () => {
    expect(tenantRole.roleForTenant(user, 'digitronics')).toBe('Manager');
  });

  it('returns undefined when the tenant is not mapped', () => {
    expect(tenantRole.roleForTenant(user, 'omni')).toBeUndefined();
  });

  it('returns undefined for a nullish tenant id', () => {
    expect(tenantRole.roleForTenant(user, undefined)).toBeUndefined();
    expect(tenantRole.roleForTenant(user, null)).toBeUndefined();
  });

  it('returns undefined for a user without tenantRoles', () => {
    expect(tenantRole.roleForTenant({ role: 'Admin' }, 'digitronics')).toBeUndefined();
  });

  it('matches tenant id as string regardless of input type', () => {
    expect(tenantRole.roleForTenant(user, 'nile')).toBe('Cashier');
  });

  it('hasTenantRole is true only for an exact matching per-tenant role', () => {
    expect(tenantRole.hasTenantRole(user, 'digitronics', 'Manager')).toBe(true);
    expect(tenantRole.hasTenantRole(user, 'digitronics', 'Admin')).toBe(false);
    expect(tenantRole.hasTenantRole(user, 'omni', 'Manager')).toBe(false);
    expect(tenantRole.hasTenantRole(user, 'digitronics', undefined)).toBe(false);
  });
});

describe('tenantRole.service — resolveEffectiveRole', () => {
  it('prefers the per-tenant role when present', () => {
    const u = { role: 'Admin', tenantRoles: { nile: 'Manager' } };
    expect(tenantRole.resolveEffectiveRole(u, 'nile')).toBe('Manager');
  });

  it('falls back to the global role when no tenant role is mapped', () => {
    const u = { role: 'Cashier', tenantRoles: { nile: 'Manager' } };
    expect(tenantRole.resolveEffectiveRole(u, 'omni')).toBe('Cashier');
  });

  it('falls back to the global role for a legacy user without tenantRoles', () => {
    expect(tenantRole.resolveEffectiveRole({ role: 'Owner' }, 'digitronics')).toBe('Owner');
  });

  it('returns undefined when no role exists at all', () => {
    expect(tenantRole.resolveEffectiveRole({}, 'digitronics')).toBeUndefined();
    expect(tenantRole.resolveEffectiveRole(null, 'digitronics')).toBeUndefined();
  });

  it('never invents a role for an unmapped tenant of a role-less user', () => {
    expect(tenantRole.resolveEffectiveRole({}, 'nile')).toBeUndefined();
  });
});