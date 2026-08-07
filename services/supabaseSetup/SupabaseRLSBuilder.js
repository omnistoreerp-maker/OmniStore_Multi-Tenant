(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function build(tables) {
    const scoped = (tables || []).filter(table => table.tenantScoped);
    return Object.freeze({
      policies: Object.freeze(scoped.map(table => Object.freeze({ table: table.name, tenantColumn: 'tenant_id', claim: 'tenant_id', operations: Object.freeze(['select','insert','update','delete']) }))),
      ownerAdminSetupOnly: true,
      frontendSecretRequired: false,
      generatedSqlPreview: scoped.map(table => `-- PREVIEW RLS: ${table.name}.tenant_id must equal authenticated tenant claim`).join('\n'),
      executable: false,
      executed: false
    });
  }
  ns.SupabaseRLSBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
