(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function createPlan() {
    const schema = ns.SupabaseSchemaBuilder.build();
    const rls = ns.SupabaseRLSBuilder.build(schema.tables);
    const tenantTables = ns.SupabaseTenantTablePlanner.plan();
    const edgeFunction = ns.SupabaseEdgeFunctionPlanner.plan();
    const validation = ns.SupabaseSetupValidator.validate(schema, rls, edgeFunction);
    return Object.freeze({
      mode: 'preview-only',
      providerConnected: false,
      apiCalled: false,
      sqlExecuted: false,
      databaseWritten: false,
      schema, rls, tenantTables, edgeFunction, validation
    });
  }
  ns.SupabaseSetupPlanner = Object.freeze({ version: '1.0.0', createPlan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
