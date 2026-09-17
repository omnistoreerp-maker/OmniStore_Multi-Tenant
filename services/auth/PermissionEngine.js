(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const PERMISSIONS = Object.freeze([
    'dashboard.view','products.read','products.write','sales.read','sales.create',
    'purchases.read','purchases.create','inventory.read','inventory.adjust',
    'reports.view','accounting.preview','settings.preview','users.preview'
  ]);
  function can(roleId, permission) {
    const role = ns.RoleManager.find(roleId);
    return Boolean(role && (role.permissions.includes('*') || role.permissions.includes(permission)));
  }
  function matrix() {
    return Object.freeze(ns.RoleManager.list().map(role => Object.freeze({
      role: role.id,
      permissions: Object.freeze(Object.fromEntries(PERMISSIONS.map(permission => [permission, can(role.id, permission)])))
    })));
  }
  ns.PermissionEngine = Object.freeze({ version: '1.0.0', PERMISSIONS, can, matrix });
})(typeof globalThis !== 'undefined' ? globalThis : window);
