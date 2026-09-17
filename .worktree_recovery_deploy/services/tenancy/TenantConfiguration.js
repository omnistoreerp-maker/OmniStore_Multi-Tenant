(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  const DEFAULTS = Object.freeze({
    mode: 'preview-only',
    isolation: 'tenant_id',
    sharedProject: true,
    persistence: false,
    backend: 'none',
    supportedRoles: Object.freeze(['owner', 'admin', 'manager', 'accountant', 'cashier'])
  });
  ns.TenantConfiguration = Object.freeze({ version: '1.0.0', defaults: () => ({ ...DEFAULTS, supportedRoles: DEFAULTS.supportedRoles.slice() }) });
})(typeof globalThis !== 'undefined' ? globalThis : window);
