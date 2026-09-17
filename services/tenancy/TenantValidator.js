(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  const ID_PATTERN = /^tenant-[a-z0-9-]{3,80}$/;
  function validate(tenant) {
    const errors = [];
    if (!tenant || !ID_PATTERN.test(String(tenant.id || tenant.tenantId || ''))) errors.push({ code: 'INVALID_TENANT_ID', field: 'tenant_id' });
    if (!tenant || !String(tenant.name || '').trim()) errors.push({ code: 'TENANT_NAME_REQUIRED', field: 'name' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), writesPerformed: false });
  }
  ns.TenantValidator = Object.freeze({ version: '1.0.0', validate, ID_PATTERN });
})(typeof globalThis !== 'undefined' ? globalThis : window);
