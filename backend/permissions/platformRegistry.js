'use strict';

// Platform Control Center — PLATFORM Permission Registry (single source of truth).
//
// This registry is DELIBERATELY separate from the tenant permission registry
// (backend/permissions/registry.js). Platform scope and tenant scope never mix:
//   - a tenant Owner/Admin is NOT a platform user;
//   - a platform role NEVER grants any tenant permission, and no tenant role
//     ever grants a platform permission.
//
// Platform roles:
//   MASTER_OWNER   — full platform control (team, roles, security, config).
//   PLATFORM_ADMIN — operations: businesses, users, licenses, integrations,
//                    operational reports/activity. No team/role/security control.
//   DEVELOPER      — technical diagnostics: health, service status, integration
//                    status, recent technical errors, build identity. Read-only,
//                    never team/role/security control, never secrets.
//   DATA_ENTRY     — operational content entry (platform catalog/content) only.
//                    Never team/role/security control, never secrets, and can
//                    never escalate its own or another user's permissions.
//
// Unknown roles resolve to an EMPTY permission set (never an invented grant).

const PLATFORM_ROLES = ['MASTER_OWNER', 'PLATFORM_ADMIN', 'DEVELOPER', 'DATA_ENTRY'];

// The roles that carry FULL platform-administration reach (the legacy
// `requirePlatformAdmin` gate). DEVELOPER and DATA_ENTRY are intentionally
// excluded so they can never inherit the broad operations surface.
const PLATFORM_ADMIN_ROLES = ['MASTER_OWNER', 'PLATFORM_ADMIN'];

const PLATFORM_GROUPS = [
  { group: 'dashboard', permissions: ['platform.dashboard.view'] },
  { group: 'team', permissions: ['platform.team.view', 'platform.team.manage'] },
  { group: 'roles', permissions: ['platform.roles.manage'] },
  { group: 'security', permissions: ['platform.security.manage'] },
  { group: 'config', permissions: ['platform.config.view', 'platform.config.manage'] },
  { group: 'companies', permissions: ['platform.companies.view', 'platform.companies.manage'] },
  { group: 'users', permissions: ['platform.users.view', 'platform.users.manage'] },
  { group: 'licenses', permissions: ['platform.licenses.view', 'platform.licenses.manage'] },
  { group: 'integrations', permissions: ['platform.integrations.view', 'platform.integrations.manage'] },
  { group: 'audit', permissions: ['platform.audit.view'] },
  { group: 'diagnostics', permissions: ['platform.diagnostics.view'] },
  { group: 'catalog', permissions: ['catalog.read', 'catalog.create', 'catalog.update'] }
];

const ALL_PLATFORM_PERMISSIONS = Array.from(
  new Set(PLATFORM_GROUPS.flatMap(g => g.permissions))
);

const ALL_WILDCARD = '*';

// Role → default permission set. MASTER_OWNER is represented as ['*'] (all).
const PLATFORM_ROLE_PERMISSIONS = {
  MASTER_OWNER: [ALL_WILDCARD],
  PLATFORM_ADMIN: [
    'platform.dashboard.view',
    'platform.team.view',
    'platform.companies.view', 'platform.companies.manage',
    'platform.users.view', 'platform.users.manage',
    'platform.licenses.view', 'platform.licenses.manage',
    'platform.integrations.view', 'platform.integrations.manage',
    'platform.audit.view',
    'catalog.read'
  ],
  DEVELOPER: [
    'platform.dashboard.view',
    'platform.audit.view',
    'platform.diagnostics.view',
    'catalog.read'
  ],
  DATA_ENTRY: [
    'platform.dashboard.view',
    'catalog.read', 'catalog.create', 'catalog.update'
  ]
};

function normalizeRole(role) {
  if (role === undefined || role === null) return '';
  return String(role).trim().toUpperCase();
}

function isPlatformRole(role) {
  return PLATFORM_ROLES.includes(normalizeRole(role));
}

function isPlatformAdminRole(role) {
  return PLATFORM_ADMIN_ROLES.includes(normalizeRole(role));
}

// Default permission set for a role (a copy — callers can never mutate the
// registry). Unknown roles return an empty array.
function rolePermissions(role) {
  const canonical = normalizeRole(role);
  const base = PLATFORM_ROLE_PERMISSIONS[canonical];
  return Array.isArray(base) ? base.slice() : [];
}

// Effective permissions = role defaults UNION valid per-member overrides.
// Overrides can only ADD permissions from the known platform set (an unknown
// override is ignored). Wildcard roles stay wildcard.
function resolvePermissions(role, overrides) {
  const base = rolePermissions(role);
  if (base.includes(ALL_WILDCARD)) return [ALL_WILDCARD];
  const set = new Set(base);
  if (Array.isArray(overrides)) {
    for (const p of overrides) {
      const norm = String(p || '').trim();
      if (norm === ALL_WILDCARD) { set.add(ALL_WILDCARD); continue; }
      if (ALL_PLATFORM_PERMISSIONS.includes(norm)) set.add(norm);
    }
  }
  return Array.from(set);
}

function hasPlatformPermission(role, permission, overrides) {
  if (!isPlatformRole(role)) return false;
  const target = String(permission || '').trim();
  if (!target) return false;
  const perms = resolvePermissions(role, overrides);
  return perms.includes(ALL_WILDCARD) || perms.includes(target);
}

function groups() {
  return PLATFORM_GROUPS.map(g => ({ group: g.group, permissions: g.permissions.slice() }));
}

function allPermissions() {
  return ALL_PLATFORM_PERMISSIONS.slice();
}

function roles() {
  return PLATFORM_ROLES.slice();
}

// The full role → permission matrix (used by the control-center UI + tests).
function matrix() {
  return PLATFORM_ROLES.map(role => ({
    role,
    permissions: rolePermissions(role),
    fullAccess: rolePermissions(role).includes(ALL_WILDCARD)
  }));
}

module.exports = {
  PLATFORM_ROLES,
  PLATFORM_ADMIN_ROLES,
  PLATFORM_GROUPS,
  ALL_PLATFORM_PERMISSIONS,
  ALL_WILDCARD,
  normalizeRole,
  isPlatformRole,
  isPlatformAdminRole,
  rolePermissions,
  resolvePermissions,
  hasPlatformPermission,
  groups,
  allPermissions,
  roles,
  matrix
};
