(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const ROLES = Object.freeze([
    { id: 'owner', name: 'Owner', permissions: ['*'] },
    { id: 'admin', name: 'Admin', permissions: ['dashboard.view','products.read','products.write','sales.read','sales.create','purchases.read','purchases.create','inventory.read','inventory.adjust','reports.view','accounting.preview','settings.preview','users.preview'] },
    { id: 'manager', name: 'Manager', permissions: ['dashboard.view','products.read','sales.read','purchases.read','inventory.read','reports.view','accounting.preview'] },
    { id: 'accountant', name: 'Accountant', permissions: ['dashboard.view','sales.read','purchases.read','inventory.read','reports.view','accounting.preview'] },
    { id: 'auditor', name: 'Auditor', permissions: ['dashboard.view','sales.read','purchases.read','inventory.read','reports.view','accounting.preview'] },
    { id: 'cashier', name: 'Cashier', permissions: ['dashboard.view','products.read','sales.read','sales.create'] }
  ].map(role => Object.freeze({ ...role, permissions: Object.freeze(role.permissions) })));
  const find = id => ROLES.find(role => role.id === id || role.name === id) || null;
  ns.RoleManager = Object.freeze({ version: '1.0.0', ROLES, find, list: () => ROLES.slice() });
})(typeof globalThis !== 'undefined' ? globalThis : window);
