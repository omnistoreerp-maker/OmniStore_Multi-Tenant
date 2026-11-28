'use strict';

const { success, error } = require('../utils/apiResponse');
const catalogMetadata = require('../services/catalogMetadata.service');
const authorization = require('../services/authorization.service');
const tenantRole = require('../services/tenantRole.service');
const platformAdmin = require('../services/platformAdmin.service');
const platformRegistry = require('../permissions/platformRegistry');

// Read-only, server-authoritative catalog of services the authenticated caller
// is allowed to discover.
//
// Authorization boundary (strict separation of tenant vs platform scope):
//
//   TENANT scope:
//     - Tenant services are visible only when authorized by the existing
//       tenant permission engine (authorization.service + tenant permission
//       registry) for the caller's trusted tenant context.
//     - Owner/Admin tenant bypass applies within tenant scope only — it never
//       grants platform visibility.
//     - A tenant Owner/Admin is NOT automatically a platform member.
//
//   PLATFORM/MASTER scope:
//     - Active platform membership is resolved server-side from the platform
//       admin store (platformAdmin.platformRoleFor / memberFor), using the
//       authenticated username from the token — never from query params,
//       headers, localStorage, or req.user.role.
//     - Each master service is gated by its verified platformPermission via
//       platformRegistry.hasPlatformPermission(role, permission, overrides).
//     - Services without a verified platformPermission mapping are withheld.
//     - Platform membership never grants tenant capabilities.
//
//   INTERNAL scope:
//     - Internal services are never exposed to any role.

function getCatalog(req, res) {
  try {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    const user = req.user;
    const tenantId = user.tenantId || undefined;

    // Resolve effective role from server-side tenant state only — never from
    // client-controlled input.
    const effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId) || user.role;

    const isTenantPrivileged = effectiveRole === 'Owner' || effectiveRole === 'Admin';

    // Build the authorized service list.
    const authorized = [];

    // --- Tenant services (tenant scope only) ---
    for (const svc of catalogMetadata.getTenantServices()) {
      let allowed = false;
      if (isTenantPrivileged) {
        // Owner/Admin tenant bypass — tenant scope only.
        allowed = true;
      } else if (svc.permission) {
        allowed = authorization.hasPermission(user, svc.permission, tenantId);
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
          destination: svc.destination,
          source: svc.source
        });
      }
    }

    // --- Platform/Master services (platform scope only) ---
    // Resolve active platform membership server-side only. A disabled, removed,
    // or unknown platform member resolves to null (fail-closed).
    const platformRole = platformAdmin.platformRoleFor(user.username);
    if (platformRole) {
      const entry = platformAdmin.memberFor(user.username);
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
            destination: svc.destination,
            source: svc.source
          });
        }
      }
    }

    // --- Internal-only services: NEVER exposed to any role ---

    // Sort by scope (tenant first, then master) then by category.
    authorized.sort((a, b) => {
      const scopeOrder = { tenant: 0, master: 1, internal: 2 };
      const so = (scopeOrder[a.scope] || 99) - (scopeOrder[b.scope] || 99);
      if (so !== 0) return so;
      return (a.category || '').localeCompare(b.category || '');
    });

    return success(res, {
      user: {
        id: user.id,
        username: user.username,
        role: effectiveRole,
        tenantId
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
