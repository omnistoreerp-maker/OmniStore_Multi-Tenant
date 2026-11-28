'use strict';

// Shared post-login routing helper used by both production code and unit tests.
// Mirrors the server-authoritative routing decision in index.html doLogin():
//   const postLoginRole = (d.effectiveRole !== undefined ? d.effectiveRole : d.user.role);
//   if (postLoginRole === 'Owner') -> /tenant-owner.html
//   if (postLoginRole === 'Admin')  -> /tenant-admin.html
//   if (postLoginRole === 'Cashier' || postLoginRole === 'Technician') -> /employee-workspace.html
//   otherwise                      -> null (existing index.html behavior)
// Client-supplied role values cannot override server identity.
// Owner/Admin routing is applied only after successful server authentication
// with a server-authoritative effective role resolved for the trusted tenant.
// Locally cached or client-only role values never grant role-specific routing.

function routeByRole(effectiveRole, userRole) {
  const role = effectiveRole !== undefined ? effectiveRole : userRole;
  if (role === 'Owner') return '/tenant-owner.html';
  if (role === 'Admin') return '/tenant-admin.html';
  if (role === 'Cashier' || role === 'Technician') return '/employee-workspace.html';
  return null;
}

// Dual export: CommonJS for Node tests, global for browser production pages.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { routeByRole };
}
if (typeof window !== 'undefined' && typeof window.routeByRole === 'undefined') {
  window.routeByRole = routeByRole;
}
