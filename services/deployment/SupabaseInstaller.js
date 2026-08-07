(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  function generatePackage(customerPlan) {
    return Object.freeze({
      version: 'phase25-preview-1',
      customer: customerPlan.customer,
      schema: ns.SchemaDeploymentEngine.plan(),
      rls: ns.RLSPolicyInstaller.plan(),
      bootstrap: ns.TenantBootstrapper.plan(customerPlan),
      seed: ns.DefaultDataSeeder.plan(),
      executionTarget: 'authenticated-admin-edge-function',
      generated: customerPlan.valid,
      executableInBrowser: false,
      packagePersisted: false
    });
  }
  ns.SupabaseInstaller = Object.freeze({ version: '1.0.0', generatePackage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
