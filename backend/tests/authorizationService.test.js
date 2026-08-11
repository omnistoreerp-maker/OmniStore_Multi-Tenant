'use strict';

// Phase C — Authorization service unit tests: the pure decision engine for
// effective permissions, tenant-scoped roles, and user-management helpers.

const authorization = require('../services/authorization.service');
const registry = require('../permissions/registry');

const owner = { id: '1', username: 'owner', role: 'Owner' };
const admin = { id: '2', username: 'admin', role: 'Admin' };
const manager = { id: '3', username: 'mgr', role: 'Manager' };
const cashier = { id: '4', username: 'cash', role: 'Cashier' };

describe('hasPermission — privileged bypass', () => {
  test('Owner bypasses every permission, even unknown ones', () => {
    expect(authorization.hasPermission(owner, 'sales.delete', undefined)).toBe(true);
    expect(authorization.hasPermission(owner, 'totally.bogus', undefined)).toBe(true);
    expect(authorization.hasPermission(owner, 'sales.view', 'nile')).toBe(true);
  });

  test('Admin bypasses every permission', () => {
    expect(authorization.hasPermission(admin, 'users.enable', undefined)).toBe(true);
    expect(authorization.hasPermission(admin, 'audit.view', undefined)).toBe(true);
  });

  test('missing or malformed users are denied', () => {
    expect(authorization.hasPermission(null, 'sales.view', undefined)).toBe(false);
    expect(authorization.hasPermission({}, 'sales.view', undefined)).toBe(false);
    expect(authorization.hasPermission(undefined, 'sales.view', undefined)).toBe(false);
  });
});

describe('hasPermission — role baselines', () => {
  test('Cashier baseline allows sales.view and denies sales.delete', () => {
    expect(authorization.hasPermission(cashier, 'sales.view', undefined)).toBe(true);
    expect(authorization.hasPermission(cashier, 'sales.delete', undefined)).toBe(false);
  });

  test('Manager baseline allows sales.edit and operator management but not privileged user ops', () => {
    expect(authorization.hasPermission(manager, 'sales.edit', undefined)).toBe(true);
    expect(authorization.hasPermission(manager, 'users.edit', undefined)).toBe(true);
    expect(authorization.hasPermission(manager, 'users.delete', undefined)).toBe(true);
    expect(authorization.hasPermission(manager, 'users.permissions.edit', undefined)).toBe(false);
    expect(authorization.hasPermission(manager, 'users.password.reset', undefined)).toBe(false);
    expect(authorization.hasPermission(manager, 'users.enable', undefined)).toBe(false);
  });

  test('unknown role resolves to empty baseline (never Owner)', () => {
    expect(authorization.hasPermission({ role: 'Sudo' }, 'sales.view', undefined)).toBe(false);
    expect(authorization.hasPermission({ role: 'Sudo' }, 'dashboard.view', undefined)).toBe(false);
  });

  test('Sales legacy role inherits the Cashier baseline', () => {
    expect(authorization.hasPermission({ role: 'Sales' }, 'sales.view', undefined)).toBe(true);
    expect(authorization.hasPermission({ role: 'Sales' }, 'sales.delete', undefined)).toBe(false);
  });
});

describe('hasPermission — explicit grants and overrides', () => {
  test('array grants add permissions', () => {
    const cash = { ...cashier, permissions: ['sales.delete'] };
    expect(authorization.hasPermission(cash, 'sales.delete', undefined)).toBe(true);
  });

  test('wildcard all grants every known permission', () => {
    const cash = { ...cashier, permissions: ['all'] };
    expect(authorization.hasPermission(cash, 'sales.delete', undefined)).toBe(true);
    expect(authorization.hasPermission(cash, 'users.delete', undefined)).toBe(true);
  });

  test('boolean overrides can recede a baseline permission', () => {
    const cash = { ...cashier, permissions: { 'sales.view': false } };
    expect(authorization.hasPermission(cash, 'sales.view', undefined)).toBe(false);
  });

  test('boolean overrides can extend the baseline', () => {
    const cash = { ...cashier, permissions: { 'sales.delete': true } };
    expect(authorization.hasPermission(cash, 'sales.delete', undefined)).toBe(true);
  });

  test('unknown permissions cannot be granted', () => {
    const cash = { ...cashier, permissions: ['bogus.nope'] };
    expect(authorization.hasPermission(cash, 'bogus.nope', undefined)).toBe(false);
  });

  test('unknown permission is denied for non-privileged users', () => {
    expect(authorization.hasPermission(cashier, 'bogus.nope', undefined)).toBe(false);
  });
});

describe('hasPermission — tenant-scoped effective role', () => {
  const downgraded = { id: '5', username: 'omni', role: 'Admin', tenantIds: ['nile'], tenantRoles: { nile: 'Cashier' } };

  test('tenant override downgrades an Admin to Cashier within that tenant', () => {
    expect(authorization.resolveEffectiveRole(downgraded, 'nile')).toBe('Cashier');
    expect(authorization.resolveEffectiveRole(downgraded, undefined)).toBe('Admin');
    expect(authorization.hasPermission(downgraded, 'sales.view', 'nile')).toBe(true);  // cashier baseline
    expect(authorization.hasPermission(downgraded, 'users.delete', 'nile')).toBe(false); // no admin
    expect(authorization.hasPermission(downgraded, 'users.delete', undefined)).toBe(true); // global Admin
  });

  test('tenant-scoped Owner bypass is never global', () => {
    const boss = { role: 'Owner', tenantRoles: { nile: 'Cashier', omni: 'Owner' } };
    expect(authorization.hasPermission(boss, 'sales.delete', 'nile')).toBe(false);   // downgraded
    expect(authorization.hasPermission(boss, 'sales.delete', 'omni')).toBe(true);    // owner of omni
    expect(authorization.hasPermission(boss, 'sales.delete', undefined)).toBe(true); // unbound/legacy -> Owner
  });

  test('getEffectivePermissions is tenant-scoped', () => {
    const boss = { role: 'Owner', tenantRoles: { nile: 'Cashier' } };
    const inNile = authorization.getEffectivePermissions(boss, 'nile');
    expect(inNile).toContain('sales.view');
    expect(inNile).not.toContain('users.delete');
    const wherever = authorization.getEffectivePermissions(boss, undefined);
    expect(wherever).toEqual(expect.arrayContaining(registry.realPermissions()));
  });

  test('privileged users resolve the full registry', () => {
    expect(authorization.getEffectivePermissions(owner, undefined)).toEqual(expect.arrayContaining(['sales.delete', 'users.permissions.edit']));
    expect(authorization.getEffectivePermissions(admin, 'nile')).toEqual(expect.arrayContaining(['sales.delete']));
  });
});

describe('tenant access helpers', () => {
  test('assertTenantAccess allows privileged, members and unbound actors', () => {
    expect(authorization.assertTenantAccess(owner, 'nile').allowed).toBe(true);
    expect(authorization.assertTenantAccess(admin, 'nile').allowed).toBe(true);
    expect(authorization.assertTenantAccess({ role: 'Cashier' }, undefined).allowed).toBe(true);
    expect(authorization.assertTenantAccess({ role: 'Cashier', tenantIds: ['nile'] }, 'nile').allowed).toBe(true);
  });

  test('assertTenantAccess denies a non-member in another tenant', () => {
    expect(authorization.assertTenantAccess({ role: 'Cashier', tenantIds: ['nile'] }, 'omni').allowed).toBe(false);
    expect(authorization.assertTenantAccess(null, 'omni').allowed).toBe(false);
  });

  test('assertTargetInTenant blocks cross-tenant management', () => {
    const mgrNile = { role: 'Manager', tenantIds: ['nile'] };
    expect(authorization.assertTargetInTenant(mgrNile, { tenantIds: ['nile'] }, 'nile')).toBe(true);
    expect(authorization.assertTargetInTenant(mgrNile, { tenantIds: ['omni'] }, 'nile')).toBe(false);
    expect(authorization.assertTargetInTenant(mgrNile, {}, 'nile')).toBe(true); // unbound targets stay reachable
    expect(authorization.assertTargetInTenant(mgrNile, { tenantIds: ['omni'] }, undefined)).toBe(true);
    expect(authorization.assertTargetInTenant(owner, { tenantIds: ['omni'] }, 'nile')).toBe(true); // privileged
  });
});

describe('user management helpers', () => {
  test('Owner and Admin can manage any user', () => {
    expect(authorization.canManageUser(owner, admin, undefined)).toBe(true);
    expect(authorization.canManageUser(admin, cashier, undefined)).toBe(true);
  });

  test('Manager can manage a Cashier but never an Admin or Owner', () => {
    expect(authorization.canManageUser(manager, cashier, undefined)).toBe(true);
    expect(authorization.canManageUser(manager, admin, undefined)).toBe(false);
    expect(authorization.canManageUser(manager, owner, undefined)).toBe(false);
  });

  test('a role without users.edit cannot manage users', () => {
    expect(authorization.canManageUser(cashier, cashier, undefined)).toBe(false);
  });

  test('canManageRole requires a strictly higher rank', () => {
    expect(authorization.canManageRole(owner, 'Owner', undefined)).toBe(true);
    expect(authorization.canManageRole(manager, 'Cashier', undefined)).toBe(true);
    expect(authorization.canManageRole(manager, 'Admin', undefined)).toBe(false);
    expect(authorization.canManageRole(cashier, 'Cashier', undefined)).toBe(false);
    expect(authorization.canManageRole(cashier, 'Viewer', undefined)).toBe(true); // operator outranks viewer
  });

  test('canGrantPermission limits Manager grants to known permissions', () => {
    const mgr = { ...manager, permissions: ['users.permissions.edit'] };
    expect(authorization.canGrantPermission(mgr, 'sales.view', undefined)).toBe(true);
    expect(authorization.canGrantPermission(mgr, 'bogus.x', undefined)).toBe(false);
    expect(authorization.canGrantPermission(owner, 'anything.known', undefined)).toBe(true);
    expect(authorization.canGrantPermission(admin, 'users.enable', undefined)).toBe(true);
  });

  test('isLastOwner detects the sole Owner', () => {
    expect(authorization.isLastOwner([owner, cashier], undefined)).toBe(true);
    expect(authorization.isLastOwner([{ role: 'Owner' }, { role: 'Owner' }], undefined)).toBe(false);
    expect(authorization.isLastOwner([cashier], undefined)).toBe(false);
  });
});

describe('validatePermissionMap', () => {
  test('cleans a valid boolean map without mutating the input', () => {
    const input = { 'sales.view': true, 'sales.delete': false };
    const snapshot = JSON.parse(JSON.stringify(input));
    const { clean, errors } = authorization.validatePermissionMap(input);
    expect(errors).toEqual([]);
    expect(clean['sales.view']).toBe(true);
    expect(clean['sales.delete']).toBe(false);
    expect(input).toEqual(snapshot);
  });

  test('rejects unknown permissions', () => {
    const { clean, errors } = authorization.validatePermissionMap({ 'bogus.x': true });
    expect(errors).toHaveLength(1);
    expect(Object.keys(clean)).toHaveLength(0);
  });

  test('rejects non-boolean values', () => {
    const { errors } = authorization.validatePermissionMap({ 'sales.view': 'yes' });
    expect(errors).toHaveLength(1);
  });

  test('allowedSet restricts what may be granted', () => {
    const { errors } = authorization.validatePermissionMap({ 'sales.view': true, 'sales.delete': true }, ['sales.view']);
    expect(errors).toHaveLength(1);
  });

  test('aliases normalize inside maps', () => {
    const { clean, errors } = authorization.validatePermissionMap({ 'sales.read': false });
    expect(errors).toEqual([]);
    expect(clean['sales.view']).toBe(false);
    expect(clean['sales.read']).toBeUndefined();
  });

  test('rejects non-object maps', () => {
    expect(authorization.validatePermissionMap(['sales.view']).errors.length).toBe(1);
    expect(authorization.validatePermissionMap(null).errors.length).toBe(1);
  });
});