(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  const ITEMS = Object.freeze([
    ['business_identity', 'Company identity and business profile reviewed'],
    ['core_workflows', 'Core workflows demonstrated'],
    ['permissions', 'Role scenarios accepted'],
    ['printing', 'Print preview accepted'],
    ['exports', 'Export preview accepted'],
    ['responsive', 'Responsive layout accepted'],
    ['offline', 'Offline expectations reviewed'],
    ['limitations', 'Known limitations reviewed'],
    ['training', 'Customer training completed'],
    ['sign_off', 'Authorized customer sign-off collected']
  ]);
  function build(results = []) {
    const failedAreas = new Set(results.filter(result => !result.ready).map(result => result.id));
    return Object.freeze(ITEMS.map(([id, label]) => Object.freeze({
      id, label,
      status: id === 'sign_off' || id === 'training' ? 'customer_action' : (
        (id === 'core_workflows' && failedAreas.has('workflows')) ||
        (id === 'permissions' && failedAreas.has('permissions')) ||
        (id === 'responsive' && failedAreas.has('performance')) ||
        (id === 'offline' && failedAreas.has('smoke')) ? 'review_required' : 'ready'
      )
    })));
  }
  ns.CustomerAcceptanceChecklist = Object.freeze({ version: '1.0.0', ITEMS, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
