(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  const ENTITIES = Object.freeze(['auth_profiles','customer_workspaces','tenant_branding','tenant_settings','products','customers','suppliers','sales_invoices','purchase_invoices','inventory_transactions','journal_vouchers','reports']);
  function plan() {
    return Object.freeze({
      strategy: 'shared-supabase-project',
      discriminator: 'tenant_id',
      entities: Object.freeze(ENTITIES.map(name => Object.freeze({ name, tenantColumn: 'tenant_id', required: true }))),
      foreignKeyRule: 'all tenant-owned relationships include tenant_id',
      sqlExecuted: false,
      previewOnly: true
    });
  }
  ns.TenantSchemaPlanner = Object.freeze({ version: '1.0.0', ENTITIES, plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
