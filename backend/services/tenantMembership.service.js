'use strict';

// Phase 15 — Tenant User Membership Foundation.
//
// ADDITIVE, dormant data helpers for the OPTIONAL tenant membership stored on
// a user record as `tenantIds` (an array of company ids / tenant ids).
//
// Scope is intentionally tiny. This module only normalizes and reads the
// optional membership. It does NOT gate access, does NOT validate login against
// the user's allowed tenants, does NOT filter anything. All of that belongs to
// later authorization phases.
//
// Behaviour rules (Phase 15):
//   - Legacy users WITHOUT a tenantIds simply resolve to an empty membership.
//   - Existing users are never migrated and never touched by these helpers.
//   - When ENABLE_TENANT_USER_MEMBERSHIP is OFF, callers simply skip calling
//     these helpers entirely; the raw user records are passed through unchanged.
//
// Value representations accepted when normalizing:
//   - a single string id
//   - an array of string ids
//   - an array of objects: [{ tenantId: 'nile' }] (forward-compatible)

// Normalize incoming membership data into a unique array of string tenant ids.
// Returns undefined when `value` was not provided, so callers can tell
// "not provided" apart from an explicitly empty membership.
function normalize(value) {
  if (value === undefined || value === null) return undefined;
  const items = Array.isArray(value) ? value : [value];
  const seen = new Set();
  for (const item of items) {
    if (item === undefined || item === null || item === '') continue;
    const id = (item && typeof item === 'object') ? item.tenantId : item;
    const cleaned = String(id).trim();
    if (cleaned) seen.add(cleaned);
  }
  return Array.from(seen);
}

// Returns the membership ids for a user as a string array. Legacy users
// without membership resolve to an empty array. Never throws.
function idsFor(user) {
  if (!user || !Array.isArray(user.tenantIds)) return [];
  return normalize(user.tenantIds) || [];
}

// True when the user membership includes the given tenant id.
// No membership -> always false.
function hasTenantId(user, tenantId) {
  if (!user || tenantId === undefined || tenantId === null) return false;
  return idsFor(user).includes(String(tenantId));
}

// Phase 16 — login enforcement helper.
// Returns TRUE when the user must be DENIED access to the given tenant/company.
//
// Denial happens ONLY when the user actually holds a non-empty membership and
// that membership does not include the selected tenant id.
//
// Legacy rule (preserved):
//   - no tenantIds, OR
//   - tenantIds: []  (empty membership),
// are treated as "no membership" and are NEVER denied. That stricter model is
// reserved for a later, explicitly designed authorization phase.
function isTenantDenied(user, tenantId) {
  if (!user || tenantId === undefined || tenantId === null) return false;
  const membership = idsFor(user);
  if (membership.length === 0) return false; // legacy / empty membership
  return membership.includes(String(tenantId)) === false;
}

module.exports = { normalize, idsFor, hasTenantId, isTenantDenied };