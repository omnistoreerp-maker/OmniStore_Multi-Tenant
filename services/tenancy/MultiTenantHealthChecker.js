(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function check() {
    const schema = ns.TenantSchemaPlanner.plan();
    const rls = ns.TenantRLSPlanner.plan();
    const security = ns.TenantSecurityValidator.validate(schema, rls);
    const checks = Object.freeze({
      previewMode: ns.TenantConfiguration.defaults().mode === 'preview-only',
      tenantContext: typeof ns.TenantContext.getCurrent === 'function',
      sharedProjectPlan: schema.strategy === 'shared-supabase-project',
      tenantIsolation: security.checks.tenantIdEverywhere,
      rlsIsolation: security.checks.rlsPlanned,
      noPersistence: ns.TenantConfiguration.defaults().persistence === false,
      noBackend: ns.TenantConfiguration.defaults().backend === 'none'
    });
    const passed = Object.values(checks).filter(Boolean).length;
    return Object.freeze({ score: Math.round(passed / Object.keys(checks).length * 100), ready: passed === Object.keys(checks).length, checks, warnings: Object.freeze(['Preview architecture only; no tenant exists in a live backend.']) });
  }
  ns.MultiTenantHealthChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
