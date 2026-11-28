'use strict';

const { success, error } = require('../utils/apiResponse');
const catalogMetadata = require('../services/catalogMetadata.service');
const authorization = require('../services/authorization.service');
const tenantRole = require('../services/tenantRole.service');
const { isPrivilegedRole } = require('../services/authorization.service');

// Read-only, server-authoritative catalog of services the authenticated caller
// is allowed to discover. Visibility is decided entirely by existing source
// permissions (authorization.service + OmniModuleRegistry). This endpoint
// never trusts client-supplied roles, query parameters, or localStorage state.

function getCatalog(req, res) {
  try {
    if (!req.user) {
      return error(res, 'Authentication required', 401);
    }

    const user = req.user;
    const tenantId = user.tenantId || undefined;

    // Resolve effective role from server-side state only (per-tenant role or
    // global role fallback). Never from query/body/header/localStorage.
    const effectiveRole = tenantRole.resolveEffectiveRole(user, tenantId) || user.role;

    // Determine if caller is platform-authorized (Master scope).
    // Owner/Admin with platform context can see master services.
    const isPlatformAuthorized =
      effectiveRole === 'Owner' || effectiveRole === 'Admin';

    // Build the authorized service list.
    const authorized = [];

    // --- Tenant services ---
    for (const svc of catalogMetadata.getTenantServices()) {
      // Permission check: Owner/Admin bypass; others need the module permission.
      let allowed = false;
      if (effectiveRole === 'Owner' || effectiveRole === 'Admin') {
        allowed = true;
      } else if (svc.permission) {
        allowed = authorization.hasPermission(user, svc.permission, tenantId);
      }
      // Services with no permission requirement are not shown to tenant roles
      // unless explicitly authorized.
      if (allowed) {
        authorized.push({
          id: svc.id,
          name: svc.name,
          description: svc.description,
          category: svc.category,
          scope: svc.scope,
          status: svc.state,
          destination: svc.destination,
          source: svc.source
        });
      }
    }

    // --- Master/platform services (platform-authorized callers only) ---
    if (isPlatformAuthorized) {
      for (const svc of catalogMetadata.getMasterServices()) {
        authorized.push({
          id: svc.id,
          name: svc.name,
          description: svc.description,
          category: svc.category,
          scope: svc.scope,
          status: svc.state,
          destination: svc.destination,
          source: svc.source
        });
      }
    }

    // --- Internal-only services: NEVER exposed to ordinary users ---
    // Internal services have roles: [] in the source and are not visible to
    // any role, including Master, unless a specific existing internal
    // authorization mechanism explicitly permits access. No such mechanism
    // exists in the current source, so internal services are excluded.

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
