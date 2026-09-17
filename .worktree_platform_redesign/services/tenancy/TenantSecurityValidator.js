(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function validate(schemaPlan, rlsPlan) {
    const checks = {
      tenantIdEverywhere: Boolean(schemaPlan && schemaPlan.entities.every(entity => entity.tenantColumn === 'tenant_id' && entity.required)),
      rlsPlanned: Boolean(rlsPlan && rlsPlan.enabledForEveryTenantTable),
      frontendBypassDisabled: Boolean(rlsPlan && !rlsPlan.bypassAllowedFromFrontend),
      sharedProject: Boolean(schemaPlan && schemaPlan.strategy === 'shared-supabase-project')
    };
    return Object.freeze({ valid: Object.values(checks).every(Boolean), checks: Object.freeze(checks), secretsInspected: false, connectionAttempted: false });
  }
  ns.TenantSecurityValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
