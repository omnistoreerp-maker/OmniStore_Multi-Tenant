(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function resolve(input) {
    const requested = String((input && (input.tenantId || input.workspaceTenantId)) || '');
    const tenant = ns.TenantManager.find(requested);
    return Object.freeze({
      resolved: Boolean(tenant),
      tenantId: tenant ? tenant.id : null,
      source: requested ? 'explicit-preview-input' : 'none',
      fallbackUsed: false,
      backendContacted: false,
      persisted: false
    });
  }
  ns.TenantResolver = Object.freeze({ version: '1.0.0', resolve });
})(typeof globalThis !== 'undefined' ? globalThis : window);
