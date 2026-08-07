(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  const VERSION = '20260701.002';
  const MIGRATIONS = Object.freeze([
    Object.freeze({ id: '20260701_001_core', name: 'Core tenancy, profiles, roles, permissions' }),
    Object.freeze({ id: '20260701_002_erp', name: 'Business, sales, purchases, products, inventory, POS, accounting, settings' }),
    Object.freeze({ id: '20260701_003_security', name: 'Indexes, functions, triggers, RLS policies' }),
    Object.freeze({ id: '20260701_004_defaults', name: 'Default roles, permissions, currencies, and settings' }),
    Object.freeze({ id: '20260701_005_workspaces', name: 'Customer workspaces, subscriptions, API credentials, usage and provisioning audit' })
  ]);
  const REQUIRED = Object.freeze({
    tables: Object.freeze(['tenants','business_profiles','user_profiles','role_templates','permission_templates','roles','permissions','role_permissions','currencies','taxes','branches','customers','suppliers','categories','products','warehouses','inventory_transactions','sales_invoices','sales_invoice_lines','purchase_invoices','purchase_invoice_lines','pos_transactions','pos_settings','chart_of_accounts','journal_vouchers','journal_lines','accounting_settings','printing_settings','system_settings','audit_logs','workspaces','subscriptions','tenant_api_credentials','cashboxes','report_settings','tenant_storage_usage','provision_history','workspace_audit','schema_migrations','installer_admins']),
    indexes: Object.freeze(['idx_user_profiles_tenant','idx_products_tenant_sku','idx_inventory_tenant_product','idx_sales_tenant_date','idx_purchases_tenant_date','idx_journal_tenant_date','idx_audit_tenant_created','idx_workspaces_tenant','idx_provision_history_tenant','idx_workspace_audit_tenant']),
    functions: Object.freeze(['current_tenant_id','is_tenant_admin','set_updated_at']),
    triggers: Object.freeze(['trg_business_profiles_updated','trg_products_updated','trg_system_settings_updated','trg_workspaces_updated']),
    policies: Object.freeze(['tenant_select','tenant_insert','tenant_update','tenant_delete']),
    defaultRoles: Object.freeze(['owner','admin','manager','accountant','cashier'])
  });
  ns.MigrationManifest = Object.freeze({ version: '1.0.0', VERSION, MIGRATIONS, REQUIRED });
})(typeof globalThis !== 'undefined' ? globalThis : window);
