(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  function plan(deploymentId) {
    return Object.freeze({
      deploymentId: deploymentId || 'simulation-not-created',
      steps: Object.freeze(['authenticate-owner-admin','load-deployment-log','verify-tenant-scope','disable-access','reverse-seed-data','remove-tenant-owned-rows','verify-no-cross-tenant-impact','record-rollback-result']),
      sourceDraft: 'database/supabasePreview/rollback_multi_tenant_preview.sql',
      automaticNow: false,
      rollbackExecuted: false,
      databaseModified: false
    });
  }
  ns.DeploymentRollbackPlanner = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
