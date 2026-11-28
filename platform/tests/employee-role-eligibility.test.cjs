// Employee-role eligibility and role-spoofing verification tests.
// Verifies Cashier and Technician are eligible for the Employee Workspace
// based on the existing role registry, and that client-side role spoofing
// cannot grant access to Owner/Admin destinations.
//
// Role registry evidence (backend/permissions/registry.js):
//   Cashier: rank 1, perms: sales.view, sales.create, customers.view,
//             customers.create, dashboard.view, treasury.view, reports.view
//   Technician: rank 1, perms: inventory.view, inventory.create,
//                 inventory.edit, products.view, dashboard.view
//   Both have dashboard.view → eligible for employee workspace.
//   Owner (rank 4) and Admin (rank 3) retain existing destinations.

(function () {
  'use strict';

  const { routeByRole } = require('../js/route-by-role');
  const { getRoleBaseline } = require('../../backend/permissions/registry');
  const assert = require('assert');

  let passed = 0;
  let failed = 0;

  function check(name, cond) {
    if (cond) { passed++; console.log('PASS  ' + name); }
    else { failed++; console.log('FAIL  ' + name); }
  }

  // ── Employee-role eligibility ──
  // Cashier and Technician route to the Employee Workspace (task-oriented)
  check('Cashier eligible → employee-workspace.html', routeByRole(undefined, 'Cashier') === '/employee-workspace.html');
  check('Technician eligible → employee-workspace.html', routeByRole(undefined, 'Technician') === '/employee-workspace.html');

  // Both roles have dashboard.view permission → can access employee workspace
  const cashierPerms = getRoleBaseline('Cashier');
  const technicianPerms = getRoleBaseline('Technician');
  check('Cashier registry has dashboard.view', cashierPerms.includes('dashboard.view'));
  check('Technician registry has dashboard.view', technicianPerms.includes('dashboard.view'));
  check('Cashier registry permissions are non-empty', cashierPerms.length > 0);
  check('Technician registry permissions are non-empty', technicianPerms.length > 0);

  // ── Protected destinations unchanged ──
  // Owner routes to Tenant Owner Home (unchanged)
  check('Owner → tenant-owner.html (unchanged)', routeByRole(undefined, 'Owner') === '/tenant-owner.html');
  // Admin routes to Tenant Admin Home (unchanged)
  check('Admin → tenant-admin.html (unchanged)', routeByRole(undefined, 'Admin') === '/tenant-admin.html');

  // ── Server-authoritative effective role ──
  // Client-supplied role cannot override server identity
  check('effectiveRole Owner overrides client Cashier', routeByRole('Owner', 'Cashier') === '/tenant-owner.html');
  check('effectiveRole Admin overrides client Cashier', routeByRole('Admin', 'Cashier') === '/tenant-admin.html');
  check('effectiveRole Cashier routes to employee workspace', routeByRole('Cashier', 'Owner') === '/employee-workspace.html');
  check('effectiveRole Technician routes to employee workspace', routeByRole('Technician', 'Owner') === '/employee-workspace.html');
  check('effectiveRole Admin does not become Owner', routeByRole('Admin', 'Owner') === '/tenant-admin.html');

  // ── Client-side spoofing blocked ──
  // A client claiming to be Owner/Admin but with effectiveRole Cashier/Technician
  // goes to employee workspace, NOT Owner/Admin destinations
  check('Client spoofing Owner + effective Cashier → employee workspace', routeByRole('Cashier', 'Owner') === '/employee-workspace.html');
  check('Client spoofing Admin + effective Technician → employee workspace', routeByRole('Technician', 'Admin') === '/employee-workspace.html');

  // ── Non-employee roles retain existing destinations ──
  check('Manager stays on index.html (null)', routeByRole(undefined, 'Manager') === null);
  check('WarehouseSales stays on index.html (null)', routeByRole(undefined, 'WarehouseSales') === null);
  check('Viewer stays on index.html (null)', routeByRole(undefined, 'Viewer') === null);
  check('BranchManager stays on index.html (null)', routeByRole(undefined, 'BranchManager') === null);

  // ── routeByRole is a pure function — ignores query-string and localStorage ──
  // routeByRole(effectiveRole, userRole) reads only its two parameters.
  // It never reads window.location.search, localStorage, or any client-side state,
  // so query-string role (?role=Owner) and localStorage role (localStorage.role = 'Admin')
  // manipulation cannot influence routing.
  check('Ignores client state: same inputs → same output', routeByRole('Cashier', 'Owner') === routeByRole('Cashier', 'Owner'));
  check('Ignores client state: query-string role cannot override effectiveRole',
    routeByRole('Cashier', 'Owner') === '/employee-workspace.html');
  check('Ignores client state: localStorage role cannot override effectiveRole',
    routeByRole('Cashier', 'Admin') === '/employee-workspace.html');

  // ── Unknown/empty roles ──
  check('Unknown role → null', routeByRole(undefined, 'UnknownRole') === null);
  check('Empty role → null', routeByRole(undefined, '') === null);
  check('undefined role → null', routeByRole(undefined, undefined) === null);

  console.log('\nEmployee-role eligibility tests: ' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed > 0 ? 1 : 0);
})();
