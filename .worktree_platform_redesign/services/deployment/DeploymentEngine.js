(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  function prepare(input, adminContext) {
    const customer = ns.CustomerProvisionEngine.plan(input || {});
    const admin = ns.DeploymentValidator.validateAdmin(adminContext);
    const packagePreview = ns.SupabaseInstaller.generatePackage(customer);
    const request = ns.EdgeFunctionClient.buildRequest(packagePreview, adminContext);
    const valid = customer.valid && admin.valid && request.valid;
    return Object.freeze({
      valid,
      errors: Object.freeze([].concat(customer.errors, admin.errors)),
      customer,
      packagePreview,
      request,
      mode: 'simulation-only',
      realDeploymentEnabled: false
    });
  }
  function simulate(input, adminContext) {
    const prepared = prepare(input, adminContext);
    const simulation = ns.EdgeFunctionClient.simulate(prepared.request);
    const result = Object.freeze({ ...prepared, simulation });
    return Object.freeze({ ...result, report: ns.DeploymentReportBuilder.build(result), rollback: ns.DeploymentRollbackPlanner.plan() });
  }
  function health() {
    const checks = Object.freeze({
      customerValidation: Boolean(ns.DeploymentValidator),
      installerGeneration: Boolean(ns.SupabaseInstaller),
      edgeFunctionBoundary: ns.EdgeFunctionClient.readiness({}).realInvocationEnabled === false,
      schemaPlan: ns.SchemaDeploymentEngine.plan().sqlExecuted === false,
      rlsPlan: ns.RLSPolicyInstaller.plan().installed === false,
      seedPlan: ns.DefaultDataSeeder.plan().seeded === false,
      rollbackPlan: ns.DeploymentRollbackPlanner.plan().rollbackExecuted === false,
      noAutomaticConnection: true
    });
    return Object.freeze({ score: Math.round(Object.values(checks).filter(Boolean).length / Object.keys(checks).length * 100), checks, realDeploymentEnabled: false });
  }
  ns.DeploymentEngine = Object.freeze({ version: '1.0.0', prepare, simulate, health });
})(typeof globalThis !== 'undefined' ? globalThis : window);
