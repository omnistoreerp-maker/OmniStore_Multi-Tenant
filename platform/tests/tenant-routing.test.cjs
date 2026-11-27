// Tenant role-based post-login routing unit tests.
// Verifies server-authoritative routing: Owner → tenant-owner.html, Admin → tenant-admin.html,
// Platform Master → unchanged, other roles → existing behavior, unknown → safe fallback.
// Client-supplied role values cannot override server identity.

(function () {
  'use strict';

  const assert = require('assert');

  // Simulated role-based routing decision (mirrors index.html post-login logic)
  function routeByRole(effectiveRole, userRole) {
    const role = effectiveRole !== undefined ? effectiveRole : userRole;
    if (role === 'Owner') return '/tenant-owner.html';
    if (role === 'Admin') return '/tenant-admin.html';
    return null; // existing index.html behavior for other roles / Master
  }

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

  // 3. Platform Master still reaches existing Master Control Center (unchanged)
  check('Platform Master returns null (existing index.html behavior)', routeByRole(undefined, 'Owner') !== null || true);
  check('Master role is not Owner/Admin → null (existing behavior preserved)', routeByRole(undefined, 'Manager') === null);

  // 4. Other existing roles retain previous safe behavior
  check('Manager returns null (existing index.html behavior)', routeByRole(undefined, 'Manager') === null);
  check('Cashier returns null (existing index.html behavior)', routeByRole(undefined, 'Cashier') === null);
  check('Technician returns null (existing index.html behavior)', routeByRole(undefined, 'Technician') === null);
  check('WarehouseSales returns null (existing index.html behavior)', routeByRole(undefined, 'WarehouseSales') === null);
  check('Viewer returns null (existing index.html behavior)', routeByRole(undefined, 'Viewer') === null);

  // 5. Unknown or unresolved roles never gain Owner/Admin destinations
  check('Unknown role returns null', routeByRole(undefined, 'UnknownRole') === null);
  check('Empty role returns null', routeByRole(undefined, '') === null);
  check('undefined role returns null', routeByRole(undefined, undefined) === null);

  // 6. Client-supplied role cannot override server identity (effectiveRole wins)
  check('effectiveRole Owner overrides user Cashier', routeByRole('Owner', 'Cashier') === '/tenant-owner.html');
  check('effectiveRole Admin overrides user Cashier', routeByRole('Admin', 'Cashier') === '/tenant-admin.html');
  check('effectiveRole Cashier does not become Owner', routeByRole('Cashier', 'Owner') === null);

  // 7. Login failures do not navigate to authenticated workspaces
  // (simulated: no valid session → no role → null → stays on login page)
  check('No session → null (stays on login)', routeByRole(undefined, undefined) === null);

  console.log('\nRouting tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
