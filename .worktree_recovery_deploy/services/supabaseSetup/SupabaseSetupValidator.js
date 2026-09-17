(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function validate(schema, rls, edge) {
    const checks = Object.freeze({
      tenantIsolation: Boolean(schema && schema.tables.filter(table => table.tenantScoped).every(table => table.tenantColumn === 'tenant_id')),
      rlsCoverage: Boolean(rls && rls.policies.length === schema.tables.filter(table => table.tenantScoped).length),
      noExecutableSql: Boolean(schema && schema.executable === false && rls.executable === false),
      noExecution: Boolean(schema && !schema.executed && !rls.executed && edge && !edge.sqlExecuted),
      noFrontendSecret: Boolean(rls && rls.frontendSecretRequired === false && edge && edge.secretLocation === 'server-environment-only'),
      noApiCall: Boolean(edge && edge.apiCalled === false)
    });
    return Object.freeze({ valid: Object.values(checks).every(Boolean), score: Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100), checks });
  }
  ns.SupabaseSetupValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
