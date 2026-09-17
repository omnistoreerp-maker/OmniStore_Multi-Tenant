'use strict';

// Phase C — Authorization Service: the pure decision engine behind
// requirePermission and /auth/me enrichment.
//
// All functions are stateless and never read a request object; they take an
// explicit user record and, optionally, the tenant they act in. The tenant id
// passed in is ALWAYS the trusted server-side tenant (a signed token claim or a
// reconstructed tenant context) — never client input.
//
// Rules (Phase B):
//   - Effective role = per-tenant role when present, else the global `role`.
//   - Owner/Admin bypasses every permission check (Owner bypass is therefore
//     always tenant-scoped: a tenant that overrides an Owner to a lower role
//     removes the bypass for that tenant).
//   - Otherwise: baseline(role) + overrides. permissions[] grants names
//     additively (and 'all' grants every known permission); a permissions map
//     { name: boolean } asserts/recedes with true/false; absent names inherit.
//   - Unknown permissions are never granted.

const registry = require('../permissions/registry');
const tenantRole = require('./tenantRole.service');

function isPrivilegedRole(role) {
  return role === 'Owner' || role === 'Admin';
}

function resolveEffectiveRole(user, tenantId) {
  return tenantRole.resolveEffectiveRole(user, tenantId);
}

function _addWildcard(target, source) {
  for (const p of source) target.add(p);
}

function getEffectivePermissions(user, tenantId) {
  if (!user || typeof user !== 'object') return [];
  const role = resolveEffectiveRole(user, tenantId);
  if (isPrivilegedRole(role)) return registry.allPermissions().slice();

  const granted = new Set(registry.getRoleBaseline(role || ''));
  const perms = user.permissions;

  if (Array.isArray(perms)) {
    for (const raw of perms) {
      const normalized = registry.normalizePermission(raw);
      if (!normalized) continue;
      if (normalized === 'all') { _addWildcard(granted, registry.allPermissions()); continue; }
      if (registry.isKnown(normalized)) granted.add(normalized);
    }
  } else if (perms && typeof perms === 'object') {
    const entries = Object.entries(perms);
    const isBooleanMap = entries.some(([, value]) => typeof value === 'boolean');
    if (isBooleanMap) {
      for (const [raw, value] of entries) {
        const normalized = registry.normalizePermission(raw);
        if (normalized === 'all') { if (value === true) _addWildcard(granted, registry.allPermissions()); continue; }
        if (!registry.isKnown(normalized)) continue;
        if (value === true) granted.add(normalized);
        else if (value === false) granted.delete(normalized);
      }
    } else {
      for (const raw of Object.keys(perms)) {
        const normalized = registry.normalizePermission(raw);
        if (normalized === 'all') { _addWildcard(granted, registry.allPermissions()); continue; }
        if (registry.isKnown(normalized)) granted.add(normalized);
      }
    }
  }

  // Phase E — per-tenant permission overrides. The user's additively-stored
  // tenantPermissions map is scoped to a single trusted tenant and applied
  // on top of the baseline + global grants. Absence (inheritance) is preserved.
  if (tenantId !== undefined && tenantId !== null && user.tenantPermissions && typeof user.tenantPermissions === 'object') {
    const overrides = user.tenantPermissions[String(tenantId)];
    if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
      for (const [raw, value] of Object.entries(overrides)) {
        const normalized = registry.normalizePermission(raw);
        if (normalized === 'all') { if (value === true) _addWildcard(granted, registry.allPermissions()); continue; }
        if (!registry.isKnown(normalized)) continue;
        if (value === true) granted.add(normalized);
        else if (value === false) granted.delete(normalized);
      }
    }
  }

  return Array.from(granted);
}

function hasPermission(user, permission, tenantId) {
  if (!user || typeof user !== 'object') return false;
  const role = resolveEffectiveRole(user, tenantId);
  if (isPrivilegedRole(role)) return true;
  const normalized = registry.normalizePermission(permission);
  if (!normalized || (normalized !== 'all' && !registry.isKnown(normalized))) return false;
  if (normalized === 'all') return false;
  return getEffectivePermissions(user, tenantId).includes(normalized);
}

// Tenant access: guards whether the actor may operate inside a tenant at all.
// Owner/Admin and fully-unbound (legacy) actors are always accepted.
function assertTenantAccess(actor, tenantId) {
  if (!actor || typeof actor !== 'object') return { allowed: false, reason: 'no_actor' };
  if (tenantId === undefined || tenantId === null) return { allowed: true, reason: 'no_tenant' };
  const role = resolveEffectiveRole(actor, tenantId);
  if (isPrivilegedRole(role)) return { allowed: true, reason: 'privileged' };

  if (Array.isArray(actor.tenantIds) && actor.tenantIds.some(t => String(t) === String(tenantId))) {
    return { allowed: true, reason: 'member' };
  }
  const hasMemberships = Array.isArray(actor.tenantIds) && actor.tenantIds.length > 0;
  const hasTenantRoles = actor.tenantRoles && typeof actor.tenantRoles === 'object' && Object.keys(actor.tenantRoles).length > 0;
  if (!hasMemberships && !hasTenantRoles) return { allowed: true, reason: 'unbound' };
  return { allowed: false, reason: 'not_member' };
}

function _boundTenants(user) {
  const set = new Set();
  if (user && Array.isArray(user.tenantIds)) {
    for (const t of user.tenantIds) if (t != null) set.add(String(t));
  }
  if (user && user.tenantRoles && typeof user.tenantRoles === 'object') {
    for (const t of Object.keys(user.tenantRoles)) if (t) set.add(String(t));
  }
  return set;
}

// Target-in-tenant: whether a managed target may be touched from the given
// tenant. Unbound targets live in the shared legacy space and stay reachable.
function assertTargetInTenant(actor, target, tenantId) {
  if (tenantId === undefined || tenantId === null) return true;
  if (!actor || typeof actor !== 'object') return false;
  const role = resolveEffectiveRole(actor, tenantId);
  if (isPrivilegedRole(role)) return true;
  const targetTenants = _boundTenants(target);
  if (targetTenants.size === 0) return true;
  return targetTenants.has(String(tenantId));
}

// Whether the actor may create/edit/delete the given target user. A Manager
// may manage any user they satisfy users.edit for, except Owner/Admin and
// users bound to a different tenant. Owner/Admin manage everyone WITHIN the
// tenant — the tenant boundary always holds, even for privileged actors: a
// target bound to a DIFFERENT tenant is off-limits no matter the actor's rank
// (cross-tenant mutation closure). Unbound (legacy) targets stay reachable,
// and legacy mode (no tenantId) keeps the historical behavior.
function canManageUser(actor, target, tenantId) {
  if (!actor || typeof actor !== 'object') return false;
  const role = resolveEffectiveRole(actor, tenantId);
  // Tenant boundary first — never bypassed by privilege. A bound target that
  // does not include the trusted tenant is unreachable from this tenant.
  if (tenantId !== undefined && tenantId !== null && target && typeof target === 'object') {
    const targetTenants = _boundTenants(target);
    if (targetTenants.size > 0 && !targetTenants.has(String(tenantId))) return false;
  }
  if (role === 'Owner' || role === 'Admin') return true;
  if (!hasPermission(actor, 'users.edit', tenantId)) return false;
  if (!assertTargetInTenant(actor, target, tenantId)) return false;
  if (!target || typeof target !== 'object') return true;
  const targetRole = resolveEffectiveRole(target, tenantId);
  if (isPrivilegedRole(targetRole)) return false;
  return true;
}

// Whether the actor may assign/create the given role. Owner manages any role
// (last-Owner protection is enforced separately); everyone else only
// roles strictly below their own rank.
function canManageRole(actor, targetRole, tenantId) {
  if (!actor || typeof actor !== 'object') return false;
  const role = resolveEffectiveRole(actor, tenantId);
  if (role === 'Owner') return true;
  if (isPrivilegedRole(role)) return true;
  if (!role) return false;
  return registry.roleRank(role) > registry.roleRank(targetRole);
}

// Whether the actor may grant/edit the given permission. Owner/Admin bypass;
// otherwise the actor needs users.permissions.edit AND the permission must be a
// known registry permission.
function canGrantPermission(actor, permission, tenantId) {
  if (!actor || typeof actor !== 'object') return false;
  const role = resolveEffectiveRole(actor, tenantId);
  if (isPrivilegedRole(role)) return true;
  if (!hasPermission(actor, 'users.permissions.edit', tenantId)) return false;
  const normalized = registry.normalizePermission(permission);
  return Boolean(normalized) && registry.isKnown(normalized);
}

// Whether the supplied user set contains exactly one Owner in the tenant — the
// state guarded by the last-Owner safety rule.
function isLastOwner(users, tenantId) {
  const pool = Array.isArray(users) ? users : [];
  const owners = pool.filter(u => {
    if (!u || typeof u !== 'object') return false;
    return resolveEffectiveRole(u, tenantId) === 'Owner';
  });
  return owners.length === 1;
}

// Validate an incoming permission override map WITHOUT mutating it. Accepts
// { 'permission': true|false }. When allowedSet is provided (e.g. only what the
// caller may grant), anything outside it is rejected.
function validatePermissionMap(map, allowedSet) {
  const clean = {};
  const errors = [];
  if (!map || typeof map !== 'object' || Array.isArray(map)) {
    return { clean, errors: ['permission map must be an object mapping permission to boolean'] };
  }
  for (const [raw, value] of Object.entries(map)) {
    const normalized = registry.normalizePermission(raw);
    if (!normalized || (normalized !== 'all' && !registry.isKnown(normalized))) {
      errors.push('unknown permission: ' + raw);
      continue;
    }
    if (typeof value !== 'boolean') {
      errors.push('permission value must be boolean: ' + raw);
      continue;
    }
    if (allowedSet) {
      const allowed = Array.isArray(allowedSet) ? allowedSet : Array.from(allowedSet);
      const allowedKeys = allowed.map(p => registry.normalizePermission(p));
      if (!allowedKeys.includes(normalized)) {
        errors.push('permission not grantable: ' + raw);
        continue;
      }
    }
    clean[normalized] = value;
  }
  return { clean, errors };
}

module.exports = {
  resolveEffectiveRole,
  getEffectivePermissions,
  hasPermission,
  assertTenantAccess,
  assertTargetInTenant,
  canManageUser,
  canManageRole,
  canGrantPermission,
  isLastOwner,
  validatePermissionMap,
  isPrivilegedRole
};