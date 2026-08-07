(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  const TENANTS = Object.freeze([
    Object.freeze({ id: 'tenant-demo-cairo', name: 'متجر القاهرة التجريبي', status: 'preview', branding: 'cairo-demo', configuration: 'retail-ar' }),
    Object.freeze({ id: 'tenant-demo-alex', name: 'متجر الإسكندرية التجريبي', status: 'preview', branding: 'alex-demo', configuration: 'retail-ar' }),
    Object.freeze({ id: 'tenant-demo-lab', name: 'OmniStore Lab', status: 'preview', branding: 'lab', configuration: 'sandbox' })
  ]);
  ns.TenantManager = Object.freeze({
    version: '1.0.0',
    list: () => TENANTS.slice(),
    find: id => TENANTS.find(tenant => tenant.id === id) || null,
    previewContext: (id, role) => {
      const tenant = TENANTS.find(item => item.id === id);
      return tenant ? ns.TenantContext.setPreview({ tenantId: tenant.id, workspaceId: `workspace-${tenant.id}`, role: role || 'owner' }) : null;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
