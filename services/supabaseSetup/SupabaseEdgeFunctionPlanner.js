(function (root) {
  'use strict';
  const ns = root.OmniSupabaseSetupPreview = root.OmniSupabaseSetupPreview || {};
  function plan() {
    return Object.freeze({
      name: 'install-multi-tenant-schema',
      steps: Object.freeze(['authenticate-admin','validate-admin-permission','load-server-secret','verify-migration-checksums','execute-reviewed-transaction','write-setup-log','return-redacted-status']),
      frontendResponsibilities: Object.freeze(['admin-authentication','request-preview','show-confirmation']),
      secretLocation: 'server-environment-only',
      rollbackRequired: true,
      callableNow: false,
      apiCalled: false,
      sqlExecuted: false
    });
  }
  ns.SupabaseEdgeFunctionPlanner = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
