'use strict';

const { success, error } = require('../utils/apiResponse');
const catalogMetadata = require('../services/catalogMetadata.service');
const authorization = require('../services/authorization.service');
const { assertTenantAccess } = authorization;
const usersService = require('../services/users.service');
const { resolveTenantRoleForRequest, trustedTenantId, actorIsBoundToTenant, actorHasTenantBinding } = require('../middleware/authorize');
const platformAdmin = require('../services/platformAdmin.service');
const platformRegistry = require('../permissions/platformRegistry');

// Read-only, server-authoritative catalog of services the authenticated caller
// is allowed to discover.
//
// Authorization boundary (strict separation of tenant vs platform scope):
//
//   TENANT scope:
//     - The real persisted actor is resolved via usersService.getByUsername()
//       and passed to authorization.hasPermission() — never the thin req.user
//       object (which lacks tenantRoles, permissions, tenantPermissions,
//       tenantIds).
//     - The effective role is resolved via resolveTenantRoleForRequest(req),
//       which honors ENABLE_TENANT_ROLES, tenant context, and per-tenant role
//       overrides, falling back to req.user.role in legacy mode.
//     - The trusted tenant is resolved via trustedTenantId(req) — never from
//       query/body/header.
//     - Owner/Admin tenant bypass applies within tenant scope only — it never
//       grants platform visibility.
//     - A tenant Owner/Admin is NOT automatically a platform member.
//
//   PLATFORM/MASTER scope:
//     - The authenticated username is revalidated against a real current user
//       record (usersService.getByUsername) before platform membership is
//       resolved — mirroring platformAuth._platformActor.
//     - Active platform membership comes from platformAdmin.platformRoleFor()
//       and platformAdmin.resolvePermissionsFor() — server-side store only.
//     - Each master service is gated by its verified platformPermission via
//       platformRegistry.hasPlatformPermission(role, permission, overrides).
//     - Services without a verified platformPermission mapping are withheld.
//     - Platform membership never grants tenant capabilities.
//
//   INTERNAL scope:
//     - Internal services are never exposed to any role.
//
//   API response minimization:
//     - source references are kept server-side only, never returned.
//     - user id, username, and raw tenantId are not returned.
//     - Only the effective display role is returned.

function getCatalog(req, res) {
  try {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    const username = req.user.username;
    if (!username) {
      return error(res, 'Authentication required', 401);
    }

    // Trusted tenant from server-side state only (never query/body/header).
    const tenantId = trustedTenantId(req);

    // Resolve effective role through the existing tenant authorization flow:
    // feature-flag gated, tenant-context aware, real-user-record backed.
    // Falls back to the token's global role when tenant roles are off or no
    // valid tenant context exists.
    const effectiveRole = resolveTenantRoleForRequest(req) || req.user.role;

    // Revalidate the real persisted actor. The thin req.user (id/username/role/
    // tenantId) is insufficient for authorization.hasPermission, which needs
    // tenantRoles, permissions, tenantPermissions, tenantIds from the store.
    // Fail closed when no real record exists.
    const actor = usersService.getByUsername(username);
    if (!actor) {
      return error(res, 'Authentication required', 401);
    }

    const isTenantPrivileged = effectiveRole === 'Owner' || effectiveRole === 'Admin';

    // Tenant-bound status of the persisted actor. A bound actor (has tenantIds
    // or tenantRoles keys) must be a member of the trusted tenant to receive any
    // tenant-scoped services — the Owner/Admin bypass never crosses a tenant
    // boundary. assertTenantAccess alone is insufficient: it grants
    // Owner/Admin before checking membership. When there is no trusted tenant
    // (undefined), existing behavior is preserved (no tenant invented).
    const actorHasBinding = actorHasTenantBinding(actor);
    const actorBoundToTenant = actorIsBoundToTenant(actor, tenantId);
    const tenantAccess = assertTenantAccess(actor, tenantId);

    // Cross-tenant membership boundary: tenant services are gated behind
    // membership in the trusted tenant when the actor is bound at all.
    // Unbound (legacy) accounts and platform-only identities keep prior behavior.
    const tenantServicesAllowed =
      tenantAccess.allowed &&
      (tenantId === undefined || !actorHasBinding || actorBoundToTenant);

    // Build the authorized service list.
    const authorized = [];

    // --- Tenant services (tenant scope only) ---
    if (tenantServicesAllowed) {
      for (const svc of catalogMetadata.getTenantServices()) {
        let allowed = false;
        if (isTenantPrivileged && (actorBoundToTenant || tenantId === undefined)) {
          // Owner/Admin tenant bypass — applies inside a tenant the actor is
          // actually a member of, or when there is no trusted tenant context
          // (legacy behavior preserved: no tenant invented, no tenant inferred).
          allowed = true;
        } else if (svc.permission) {
          allowed = authorization.hasPermission(actor, svc.permission, tenantId);
        }
        // Services with no permission (null) are withheld from non-privileged roles.
        if (allowed) {
          authorized.push({
            id: svc.id,
            name: svc.name,
            description: svc.description,
            category: svc.category,
            scope: 'tenant',
            status: svc.state,
            destination: svc.destination
          });
        }
      }
    }

    // --- Platform/Master services (platform scope only) ---
    // Revalidate the real user record before resolving platform membership,
    // mirroring platformAuth._platformActor. A disabled, removed, unknown, or
    // missing member receives zero platform services.
    const platformRole = platformAdmin.platformRoleFor(username);
    if (platformRole) {
      const entry = platformAdmin.memberFor(username);
      const overrides = entry && Array.isArray(entry.permissions) ? entry.permissions : [];
      for (const svc of catalogMetadata.getMasterServices()) {
        // Services without a verified platformPermission mapping are withheld.
        if (!svc.platformPermission) continue;
        if (platformRegistry.hasPlatformPermission(platformRole, svc.platformPermission, overrides)) {
          authorized.push({
            id: svc.id,
            name: svc.name,
            description: svc.description,
            category: svc.category,
            scope: 'master',
            status: svc.state,
            destination: svc.destination
          });
        }
      }
    }

    // --- Internal-only services: NEVER exposed to any role ---

    // Sort by scope (tenant first, then master) then by category.
    // Nullish-safe scope lookup: tenant (0) must not be replaced by 99.
    authorized.sort((a, b) => {
      const scopeOrder = { tenant: 0, master: 1, internal: 2 };
      const so = (scopeOrder[a.scope] ?? 99) - (scopeOrder[b.scope] ?? 99);
      if (so !== 0) return so;
      return (a.category || '').localeCompare(b.category || '');
    });

    // Minimal production response: only the effective display role. No user id,
    // username, raw tenantId, or source references are returned to the browser.
    return success(res, {
      user: {
        role: effectiveRole
      },
      services: authorized,
      total: authorized.length
    }, 'Authorized service catalog retrieved');
  } catch (err) {
    return error(res, 'Failed to retrieve service catalog', 500, { message: err.message });
  }
}

module.exports = {
  getCatalog
};
