(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function preview(input) {
    const tenant = { id: String(input && input.id || ''), name: String(input && input.name || ''), branding: 'default', configuration: 'default' };
    const validation = ns.TenantValidator.validate(tenant);
    return Object.freeze({
      valid: validation.valid,
      errors: validation.errors,
      tenant,
      plannedSteps: Object.freeze(['validate-admin', 'create-tenant-row', 'create-workspace', 'assign-owner-role', 'apply-rls', 'verify-isolation']),
      tenantCreated: false,
      workspaceCreated: false,
      sqlExecuted: false,
      backendContacted: false,
      previewOnly: true
    });
  }
  ns.TenantProvisionPreview = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
