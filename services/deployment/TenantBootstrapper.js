(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  const COMPONENTS = Object.freeze([
    'Tenant','Business Profile','Default Roles','Owner User','Default Permissions','Chart Of Accounts',
    'Taxes','Currencies','Branches','POS Settings','Inventory Settings','Accounting Settings',
    'Printing Settings','System Settings','Default Categories','Default Warehouse','Default Cashbox','Default Theme'
  ]);
  function plan(customer) {
    return Object.freeze({
      tenantCode: customer.tenantCodePreview,
      components: Object.freeze(COMPONENTS.map((name, index) => Object.freeze({ order: index + 1, name, status: 'planned' }))),
      bootstrapped: false,
      writesPerformed: false
    });
  }
  ns.TenantBootstrapper = Object.freeze({ version: '1.0.0', COMPONENTS, plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
