(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  const DRAFTS = Object.freeze([
    '001_core_tenants.sql','002_auth_profiles.sql','003_customer_workspaces.sql','004_products_multi_tenant.sql',
    '005_sales_multi_tenant.sql','006_purchases_multi_tenant.sql','007_inventory_multi_tenant.sql',
    '008_accounting_multi_tenant.sql','009_reports_multi_tenant.sql','010_rls_policies_multi_tenant.sql',
    '011_indexes_multi_tenant.sql','012_seed_demo_tenant.sql'
  ]);
  function plan() {
    return Object.freeze({
      source: 'database/supabasePreview',
      drafts: DRAFTS.slice(),
      executionBoundary: 'edge-function-only',
      browserSqlAvailable: false,
      executableNow: false,
      sqlExecuted: false
    });
  }
  ns.SchemaDeploymentEngine = Object.freeze({ version: '1.0.0', DRAFTS, plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
