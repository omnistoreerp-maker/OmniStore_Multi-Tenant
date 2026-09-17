(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  const ROUTES = Object.freeze({
    dashboard: 'dashboard.view',
    products: 'products.read',
    pos: 'sales.create',
    invoices: 'sales.read',
    purchases: 'purchases.read',
    stockmovement: 'inventory.read',
    reports: 'reports.view',
    'accounting-audit': 'accounting.preview',
    'configuration-center': 'settings.preview',
    'auth-preview-users': 'users.preview'
  });
  function preview(route, user, session, checkedAt) {
    const permission = ROUTES[route];
    if (!permission) return Object.freeze({ route, known: false, allowed: false, previewOnly: true, reason: 'ROUTE_NOT_REGISTERED' });
    const result = ns.AccessValidator.validate({ user, session, checkedAt, permission });
    return Object.freeze({ route, permission, known: true, allowed: result.allowed, errors: result.errors, previewOnly: true, navigationPerformed: false });
  }
  ns.RouteGuard = Object.freeze({ version: '1.0.0', ROUTES, preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
