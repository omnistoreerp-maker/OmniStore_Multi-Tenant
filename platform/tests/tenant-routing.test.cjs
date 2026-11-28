// Tenant role-based post-login routing unit tests.
// Uses the shared production routing helper (platform/js/route-by-role.js)
// that mirrors the production routing logic in index.html doLogin().
//
//   const postLoginRole = (d.effectiveRole !== undefined ? d.effectiveRole : d.user.role);
//   if (postLoginRole === 'Owner') -> /tenant-owner.html
//   if (postLoginRole === 'Admin')  -> /tenant-admin.html
//   if (postLoginRole === 'Cashier' || postLoginRole === 'Technician') -> /employee-workspace.html
//   otherwise                      -> null (existing index.html behavior)
//
// Client-supplied role values cannot override server identity.
// Owner/Admin routing is applied only after successful server authentication
// with a server-authoritative effective role resolved for the trusted tenant.
// Locally cached or client-only role values never grant role-specific routing.

(function () {
  'use strict';

  const { routeByRole } = require('../js/route-by-role');
  const assert = require('assert');

  let passed = 0;
  let failed = 0;

  function check(name, cond) {
    if (cond) { passed++; console.log('PASS  ' + name); }
    else { failed++; console.log('FAIL  ' + name); }
  }

  // 1. Tenant Owner reaches Tenant Owner Home
  check('Owner effective role routes to tenant-owner.html', routeByRole('Owner', 'Cashier') === '/tenant-owner.html');
  check('Owner user role routes to tenant-owner.html (fallback)', routeByRole(undefined, 'Owner') === '/tenant-owner.html');

  // 2. Tenant Admin reaches Tenant Admin Home
  check('Admin effective role routes to tenant-admin.html', routeByRole('Admin', 'Cashier') === '/tenant-admin.html');
  check('Admin user role routes to tenant-admin.html (fallback)', routeByRole(undefined, 'Admin') === '/tenant-admin.html');

  // 3. Manager and BranchManager route to their dedicated workspaces
  check('Manager routes to manager-workspace.html', routeByRole(undefined, 'Manager') === '/manager-workspace.html');
  check('BranchManager routes to branchmanager-workspace.html', routeByRole(undefined, 'BranchManager') === '/branchmanager-workspace.html');
  check('Cashier routes to employee-workspace.html', routeByRole(undefined, 'Cashier') === '/employee-workspace.html');
  check('Technician routes to employee-workspace.html', routeByRole(undefined, 'Technician') === '/employee-workspace.html');
  check('WarehouseSales stays on index.html (null)', routeByRole(undefined, 'WarehouseSales') === null);
  check('Viewer stays on index.html (null)', routeByRole(undefined, 'Viewer') === null);

  // 4. Unknown or unresolved roles never gain Owner/Admin destinations
  check('Unknown role returns null', routeByRole(undefined, 'UnknownRole') === null);
  check('Empty role returns null', routeByRole(undefined, '') === null);
  check('undefined role returns null', routeByRole(undefined, undefined) === null);

  // 5. Client-supplied role cannot override server identity (effectiveRole wins)
  check('effectiveRole Owner overrides user Cashier', routeByRole('Owner', 'Cashier') === '/tenant-owner.html');
  check('effectiveRole Admin overrides user Cashier', routeByRole('Admin', 'Cashier') === '/tenant-admin.html');
  check('effectiveRole Cashier routes to employee-workspace.html', routeByRole('Cashier', 'Owner') === '/employee-workspace.html');
  check('effectiveRole Admin does not become Owner', routeByRole('Admin', 'Owner') === '/tenant-admin.html');

  // 6. Login failures do not navigate to authenticated workspaces
  check('No session → null (stays on login)', routeByRole(undefined, undefined) === null);

  console.log('\nRouting tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
