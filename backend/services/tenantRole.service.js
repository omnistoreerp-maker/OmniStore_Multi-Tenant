'use strict';

// Phase 17 — Tenant-Scoped User Roles foundation.
//
// ADDITIVE, dormant data helpers for the OPTIONAL tenant-scoped roles stored on
// a user record as `tenantRoles`, a map of `{ "<tenantId>": "<role>" }`.
//
// Scope is intentionally tiny. This module only normalizes and reads the
// optional per-tenant role. It does NOT gate access, does NOT enforce whether a
// role is allowed, does NOT touch JWT claims. Resolution of an effective role
// belongs to the authorization middleware, which decides how to use it.
//
// This module deliberately reads NO config: callers (users.service.js, the
// authorization middleware, tests) decide whether the feature flag is on and
// whether to call these helpers. This keeps the service pure, deterministic
// and unit-testable exactly like its Phase 15/16 sibling
// (tenantMembership.service.js).
//
// Behaviour rules (Phase 17):
//   - Legacy users WITHOUT tenantRoles resolve to their global `role`.
//   - Users are never migrated and never touched by these helpers.
//   - resolveEffectiveRole never invents a role: it is the per-tenant role
//     when one is present, otherwise the user's global `role`.
//   - No owner/privilege escalation is hardcoded here on purpose; that is a
//     policy decision for the authorization phase, not this data layer.

// Value representations accepted when normalizing:
//   - an object map { '<tenantId>': '<role>' }
//   - an array of records [{ tenantId: 'nile', role: 'Manager' }]
//   - an array of maps          [{ nile: 'Manager' }]
// An array of plain strings is not a supported shape and is skipped.

// Normalize incoming tenantRoles into a trimmed, non-empty map of
// { tenantId: role }. Returns undefined when `value` was not provided so
// callers can tell "not provided" apart from an explicitly empty map.
function normalize(value) {
  if (value === undefined || value === null) return undefined;
  const out = {};
  const entries = Array.isArray(value) ? value : [value];

  for (const entry of entries) {
    if (entry === undefined || entry === null) continue;
    if (typeof entry !== 'object') continue;

    if (entry.tenantId !== undefined && entry.role !== undefined) {
      const tid = String(entry.tenantId).trim();
      const role = String(entry.role).trim();
      if (tid && role) out[tid] = role;
      continue;
    }

    for (const key of Object.keys(entry)) {
      const tid = String(key).trim();
      const raw = entry[key];
      const role = String(raw === undefined || raw === null ? '' : raw).trim();
      if (tid && role) out[tid] = role;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

// Returns the user's per-tenant role for the given tenant, or undefined when
// no such role is present. Never throws.
function roleForTenant(user, tenantId) {
  if (!user || !user.tenantRoles || typeof user.tenantRoles !== 'object') return undefined;
  if (tenantId === undefined || tenantId === null) return undefined;
  const role = user.tenantRoles[String(tenantId)];
  return role === undefined || role === null || role === '' ? undefined : String(role);
}

// True when the user has an explicit per-tenant role equal to the given role.
function hasTenantRole(user, tenantId, role) {
  if (role === undefined || role === null) return false;
  return roleForTenant(user, tenantId) === String(role);
}

// Resolve the effective role a user should act as within a tenant. Never
// invents a role: a present per-tenant role wins; otherwise fall back to the
// user's global `role`; otherwise undefined.
function resolveEffectiveRole(user, tenantId) {
  const tenantRole = roleForTenant(user, tenantId);
  if (tenantRole !== undefined) return tenantRole;
  if (user && typeof user.role === 'string' && user.role !== '') return user.role;
  return undefined;
}

module.exports = { normalize, roleForTenant, hasTenantRole, resolveEffectiveRole };