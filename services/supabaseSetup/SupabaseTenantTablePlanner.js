(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function plan() {
    return Object.freeze({
      tenantRoot: 'tenants',
      profileTable: 'auth_profiles',
      workspaceTable: 'customer_workspaces',
      requiredColumns: Object.freeze(['tenant_id','created_at','updated_at']),
      domainTables: Object.freeze(['products','customers','suppliers','sales_invoices','purchase_invoices','inventory_transactions','journal_vouchers']),
      crossTenantForeignKeysForbidden: true,
      previewOnly: true
    });
  }
  ns.SupabaseTenantTablePlanner = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
