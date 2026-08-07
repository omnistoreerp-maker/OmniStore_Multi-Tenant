(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function plan() {
    return Object.freeze({
      enabledForEveryTenantTable: true,
      claim: 'tenant_id',
      policies: Object.freeze(['tenant-select-isolation','tenant-insert-isolation','tenant-update-isolation','tenant-delete-isolation']),
      roleChecks: Object.freeze(['owner','admin','manager','accountant','cashier']),
      bypassAllowedFromFrontend: false,
      executed: false,
      previewOnly: true
    });
  }
  ns.TenantRLSPlanner = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
