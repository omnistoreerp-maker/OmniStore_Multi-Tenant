(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function verify(health) {
    health = health || {};
    const isolation = health.isolation || {};
    const checks = Object.freeze({
      workspaceActive: health.status === 'active',
      tenantColumnsPresent: Number(isolation.tenantColumns || 0) >= 34,
      rlsTablesPresent: Number(isolation.rlsTables || 0) >= 35,
      policiesPresent: Number(isolation.policies || 0) >= 140,
      ownerUserPresent: Number(health.counts && health.counts.users || 0) >= 1,
      rolesPresent: Number(health.counts && health.counts.roles || 0) >= 5,
      warehousePresent: Number(health.counts && health.counts.warehouses || 0) >= 1,
      accountsPresent: Number(health.counts && health.counts.accounts || 0) >= 9,
      crossTenantAccessBlocked: isolation.crossTenantAccessAllowed === false
    });
    return Object.freeze({ valid: Object.values(checks).every(Boolean), score: Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100), checks });
  }
  ns.WorkspaceIsolationVerifier = Object.freeze({ version: '1.0.0', verify });
})(typeof globalThis !== 'undefined' ? globalThis : window);
