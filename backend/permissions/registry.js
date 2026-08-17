'use strict';

// Phase C — Permission Registry: the single source of truth for permission
// names, their operational groups, and the default permission set per role.
//
// REAL groups map to route families that already exist and are enforceable by
// requirePermission. PLANNED groups are registered for forward-compatibility
// only; they are intentionally NOT wired to any middleware and must never be
// treated as granted-at-route-level by the codebase.
//
// Aliasing: legacy role names (Sales, Support) resolve to a modern baseline so
// pre-existing records keep sensible defaults without being migrated. Unknown
// roles resolve to an EMPTY baseline (never an invented Owner access).

const REAL_GROUPS = [
  { group: 'sales', permissions: ['sales.view', 'sales.create', 'sales.edit', 'sales.delete'] },
  { group: 'purchases', permissions: ['purchases.view', 'purchases.create', 'purchases.edit', 'purchases.delete'] },
  { group: 'inventory', permissions: ['inventory.view', 'inventory.create', 'inventory.edit', 'inventory.delete'] },
  { group: 'products', permissions: ['products.view', 'products.create', 'products.edit', 'products.delete'] },
  { group: 'customers', permissions: ['customers.view', 'customers.create', 'customers.edit', 'customers.delete'] },
  { group: 'suppliers', permissions: ['suppliers.view', 'suppliers.create', 'suppliers.edit', 'suppliers.delete'] },
  { group: 'treasury', permissions: ['treasury.view', 'treasury.create', 'treasury.edit', 'treasury.delete'] },
  { group: 'reports', permissions: ['reports.view'] },
  { group: 'dashboard', permissions: ['dashboard.view'] },
  {
    group: 'users',
    permissions: [
      'users.view', 'users.create', 'users.edit', 'users.delete',
      'users.password.reset', 'users.permissions.view', 'users.permissions.edit',
      'users.enable', 'users.disable'
    ]
  },
  { group: 'audit', permissions: ['audit.view'] },
  { group: 'company', permissions: ['company.view', 'company.create'] },
  { group: 'settings', permissions: ['settings.view', 'settings.edit'] }
];

const PLANNED_GROUPS = [
  { group: 'sales', permissions: ['sales.refund', 'sales.print', 'sales.export'] },
  { group: 'purchases', permissions: ['purchases.approve', 'purchases.export'] },
  { group: 'inventory', permissions: ['inventory.adjust', 'inventory.transfer'] },
  { group: 'expenses', permissions: ['expenses.view', 'expenses.create', 'expenses.edit', 'expenses.delete'] },
  { group: 'audit', permissions: ['audit.export'] },
  { group: 'license', permissions: ['license.view', 'license.manage'] },
  { group: 'company', permissions: ['company.settings.view', 'company.settings.edit'] }
];

const ALL_PERMISSIONS = Array.from(
  new Set([...REAL_GROUPS, ...PLANNED_GROUPS].flatMap(g => g.permissions))
);

const REAL_PERMISSIONS = Array.from(new Set(REAL_GROUPS.flatMap(g => g.permissions)));

// Legacy role names map to a modern baseline without mutating the record.
const ROLE_ALIASES = { Sales: 'Cashier', Support: 'Viewer' };

// Role rank: higher outranks lower when deciding who may manage whom.
const ROLE_RANK = {
  Owner: 4,
  Admin: 3,
  Manager: 2,
  Cashier: 1,
  Technician: 1,
  WarehouseSales: 1,
  Sales: 1,
  Support: 0,
  Viewer: 0
};

// Default grant per role. Owner and Admin short-circuit in the authorization
// engine; their baselines are the full enforceable set so /auth/me stays a
// truthful reflection of what the engine permits.
const ROLE_DEFAULTS = {
  Owner: REAL_PERMISSIONS,
  Admin: REAL_PERMISSIONS,
  Manager: [
    'sales.view', 'sales.create', 'sales.edit',
    'purchases.view', 'purchases.create', 'purchases.edit',
    'inventory.view', 'inventory.create', 'inventory.edit',
    'products.view', 'products.create', 'products.edit',
    'customers.view', 'customers.create', 'customers.edit',
    'suppliers.view', 'suppliers.create', 'suppliers.edit',
    'treasury.view', 'treasury.create', 'treasury.edit',
    'reports.view', 'dashboard.view',
    'users.view', 'users.create', 'users.edit', 'users.delete',
    'audit.view', 'company.view', 'settings.view'
  ],
  Cashier: ['sales.view', 'sales.create', 'customers.view', 'customers.create', 'dashboard.view', 'treasury.view', 'reports.view'],
  Technician: ['inventory.view', 'inventory.create', 'inventory.edit', 'products.view', 'dashboard.view'],
  WarehouseSales: ['inventory.view', 'inventory.create', 'inventory.edit', 'products.view', 'products.create', 'products.edit', 'sales.view', 'dashboard.view'],
  Viewer: ['dashboard.view', 'reports.view', 'sales.view', 'purchases.view', 'inventory.view', 'products.view', 'customers.view', 'suppliers.view', 'treasury.view', 'company.view']
};

// Legacy verb synonyms -> canonical permission verbs. read/update/list are
// historical spellings of the canonical view/edit verbs.
const PERMISSION_SYNONYMS = { read: 'view', update: 'edit', list: 'view' };

function normalizePermission(name) {
  if (name === undefined || name === null) return '';
  const raw = String(name).trim();
  if (raw === '*' ) return 'all';
  if (raw.toLowerCase() === 'all') return 'all';
  const parts = raw.split('.');
  if (parts.length > 1 && PERMISSION_SYNONYMS[parts[parts.length - 1]]) {
    parts[parts.length - 1] = PERMISSION_SYNONYMS[parts[parts.length - 1]];
    return parts.join('.');
  }
  return raw;
}

function isKnown(name) {
  if (name === undefined || name === null) return false;
  const normalized = normalizePermission(name);
  return normalized === 'all' || ALL_PERMISSIONS.includes(normalized);
}

function isEnforceable(name) {
  if (name === undefined || name === null) return false;
  const normalized = normalizePermission(name);
  return normalized === 'all' || REAL_PERMISSIONS.includes(normalized);
}

function canonicalRole(role) {
  if (role === undefined || role === null) return '';
  const raw = String(role).trim();
  return ROLE_ALIASES[raw] || raw;
}

function getRoleBaseline(role) {
  const canonical = canonicalRole(role);
  return Array.isArray(ROLE_DEFAULTS[canonical]) ? ROLE_DEFAULTS[canonical].slice() : [];
}

function roleRank(role) {
  const canonical = canonicalRole(role);
  return ROLE_RANK[canonical] !== undefined ? ROLE_RANK[canonical] : 0;
}

function groups() {
  return REAL_GROUPS.map(g => ({ group: g.group, permissions: g.permissions.slice() }));
}

function plannedGroups() {
  return PLANNED_GROUPS.map(g => ({ group: g.group, permissions: g.permissions.slice() }));
}

function allPermissions() {
  return ALL_PERMISSIONS.slice();
}

function realPermissions() {
  return REAL_PERMISSIONS.slice();
}

function knownRoles() {
  return ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician', 'WarehouseSales', 'Sales', 'Support', 'Viewer'];
}

module.exports = {
  REAL_GROUPS,
  PLANNED_GROUPS,
  ROLE_ALIASES,
  ROLE_RANK,
  ROLE_DEFAULTS,
  normalizePermission,
  isKnown,
  isEnforceable,
  canonicalRole,
  getRoleBaseline,
  roleRank,
  groups,
  plannedGroups,
  allPermissions,
  realPermissions,
  knownRoles
};