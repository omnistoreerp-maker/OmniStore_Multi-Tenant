(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  const TABLES = Object.freeze(['tenants','auth_profiles','customer_workspaces','tenant_branding','tenant_settings','products','customers','suppliers','sales_invoices','purchase_invoices','inventory_transactions','journal_vouchers']);
  function build() {
    return Object.freeze({
      tables: Object.freeze(TABLES.map(name => Object.freeze({ name, tenantScoped: name !== 'tenants', tenantColumn: name === 'tenants' ? 'id' : 'tenant_id' }))),
      strategy: 'one-shared-project-many-tenants',
      generatedSqlPreview: TABLES.map(name => `-- PREVIEW: ${name} isolated by ${name === 'tenants' ? 'id' : 'tenant_id'}`).join('\n'),
      executable: false,
      executed: false
    });
  }
  ns.SupabaseSchemaBuilder = Object.freeze({ version: '1.0.0', TABLES, build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
