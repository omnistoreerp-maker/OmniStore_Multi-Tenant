'use strict';

// Phase C — Permission Registry unit tests: the single source of truth for
// permission names, role baselines, legacy aliases and ranks.

const registry = require('../permissions/registry');

describe('permission normalization', () => {
  test('maps legacy verb read to canonical view', () => {
    expect(registry.normalizePermission('sales.read')).toBe('sales.view');
  });

  test('maps legacy verb update to canonical edit', () => {
    expect(registry.normalizePermission('sales.update')).toBe('sales.edit');
  });

  test('maps legacy verb list to canonical view', () => {
    expect(registry.normalizePermission('inventory.list')).toBe('inventory.view');
  });

  test('canonical verbs pass through unchanged', () => {
    expect(registry.normalizePermission('sales.view')).toBe('sales.view');
    expect(registry.normalizePermission('purchases.delete')).toBe('purchases.delete');
  });

  test('treats all and star as the wildcard', () => {
    expect(registry.normalizePermission('all')).toBe('all');
    expect(registry.normalizePermission('*')).toBe('all');
  });

  test('isKnown accepts real, planned and synonym forms', () => {
    expect(registry.isKnown('sales.view')).toBe(true);
    expect(registry.isKnown('sales.refund')).toBe(true); // planned still registered
    expect(registry.isKnown('sales.read')).toBe(true);   // synonym
  });

  test('isKnown rejects unknown permissions', () => {
    expect(registry.isKnown('bogus.none')).toBe(false);
    expect(registry.isKnown('')).toBe(false);
    expect(registry.isKnown(undefined)).toBe(false);
  });

  test('isEnforceable is true for REAL permissions only', () => {
    expect(registry.isEnforceable('sales.view')).toBe(true);
    expect(registry.isEnforceable('users.permissions.view')).toBe(true);
    expect(registry.isEnforceable('sales.refund')).toBe(false);
    expect(registry.isEnforceable('expenses.view')).toBe(false);
  });
});

describe('role baselines', () => {
  test('Owner and Admin baselines are the full enforceable set', () => {
    expect(registry.getRoleBaseline('Owner')).toEqual(registry.realPermissions());
    expect(registry.getRoleBaseline('Admin')).toEqual(registry.realPermissions());
  });

  test('Sales legacy alias inherits the Cashier baseline', () => {
    expect(registry.getRoleBaseline('Sales')).toEqual(registry.getRoleBaseline('Cashier'));
    expect(registry.getRoleBaseline('Sales').length).toBeGreaterThan(0);
  });

  test('Support legacy alias inherits the Viewer baseline', () => {
    expect(registry.getRoleBaseline('Support')).toEqual(registry.getRoleBaseline('Viewer'));
  });

  test('unknown role resolves to an empty baseline, never Owner', () => {
    expect(registry.getRoleBaseline('Sudo')).toEqual([]);
    expect(registry.getRoleBaseline()).toEqual([]);
    expect(registry.getRoleBaseline(null)).toEqual([]);
  });

  test('Cashier baseline includes sales.view but not sales.delete', () => {
    const baseline = registry.getRoleBaseline('Cashier');
    expect(baseline).toContain('sales.view');
    expect(baseline).not.toContain('sales.delete');
  });

  test('Manager baseline includes user management but not permission editing', () => {
    const baseline = registry.getRoleBaseline('Manager');
    expect(baseline).toContain('users.edit');
    expect(baseline).toContain('users.delete');
    expect(baseline).not.toContain('users.permissions.edit');
    expect(baseline).not.toContain('users.password.reset');
  });
});

describe('role ranks', () => {
  test('ranks order Owner > Admin > Manager > operators > viewers', () => {
    expect(registry.roleRank('Owner')).toBe(4);
    expect(registry.roleRank('Admin')).toBe(3);
    expect(registry.roleRank('Manager')).toBe(2);
    expect(registry.roleRank('Cashier')).toBe(1);
    expect(registry.roleRank('Technician')).toBe(1);
    expect(registry.roleRank('WarehouseSales')).toBe(1);
    expect(registry.roleRank('Sales')).toBe(1);
    expect(registry.roleRank('Support')).toBe(0);
    expect(registry.roleRank('Viewer')).toBe(0);
  });

  test('unknown roles rank 0', () => {
    expect(registry.roleRank('Mystery')).toBe(0);
    expect(registry.roleRank('')).toBe(0);
  });
});

describe('registry structure', () => {
  test('groups() exposes only enforceable groups', () => {
    const all = registry.groups().flatMap(g => g.permissions);
    expect(registry.groups().length).toBe(13);
    expect(all).toContain('sales.view');
    expect(all).toContain('users.permissions.view');
    expect(all).not.toContain('sales.refund');
    expect(all).not.toContain('expenses.view');
  });

  test('plannedGroups holds forward-only permissions', () => {
    const planned = registry.plannedGroups().flatMap(g => g.permissions);
    expect(planned).toContain('expenses.view');
    expect(planned).toContain('sales.refund');
    expect(planned).toContain('license.manage');
  });

  test('allPermissions is the real + planned union without duplicates', () => {
    const all = registry.allPermissions();
    expect(all).toContain('sales.view');
    expect(all).toContain('sales.refund');
    expect(all).toContain('users.enable');
    expect(new Set(all).size).toBe(all.length);
  });

  test('knownRoles covers every canonical and legacy role', () => {
    const known = registry.knownRoles();
    for (const role of ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician', 'WarehouseSales', 'Sales', 'Support', 'Viewer']) {
      expect(known).toContain(role);
    }
  });
});