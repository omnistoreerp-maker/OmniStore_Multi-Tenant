(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function preview(tenant, options) {
    options = options || {};
    return Object.freeze({
      workspaceId: `workspace-${tenant.id}`,
      tenantId: tenant.id,
      name: options.name || tenant.name,
      brandingMapping: Object.freeze({ key: tenant.branding, isolatedBy: 'tenant_id' }),
      configurationMapping: Object.freeze({ key: tenant.configuration, isolatedBy: 'tenant_id' }),
      authenticationMapping: Object.freeze({ profileTable: 'auth_profiles', claim: 'tenant_id' }),
      storageMapping: Object.freeze({ prefix: `tenants/${tenant.id}/`, policy: 'tenant-isolated' }),
      databaseMapping: Object.freeze({ strategy: 'shared-schema', discriminator: 'tenant_id' }),
      previewOnly: true,
      persisted: false
    });
  }
  ns.CustomerWorkspace = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
