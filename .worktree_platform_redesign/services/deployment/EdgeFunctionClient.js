(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  const CONFIGURATION_KEYS = Object.freeze(['SUPABASE_URL','SUPABASE_ANON_KEY','EDGE_FUNCTION_URL']);
  function readiness(configuration) {
    configuration = configuration || {};
    const configured = CONFIGURATION_KEYS.every(key => Boolean(configuration[key]));
    return Object.freeze({ configured, keys: CONFIGURATION_KEYS.slice(), realInvocationEnabled: false, secretInBrowser: false });
  }
  function buildRequest(packagePreview, adminContext) {
    const admin = ns.DeploymentValidator.validateAdmin(adminContext);
    return Object.freeze({
      valid: admin.valid,
      errors: admin.errors,
      method: 'POST',
      destination: 'EDGE_FUNCTION_URL',
      payload: packagePreview,
      authenticatedAdminRequired: true,
      privilegedCredentialLocation: 'edge-function-server-secret',
      browserReceivesPrivilegedCredential: false,
      sent: false
    });
  }
  function simulate(request) {
    return Object.freeze({
      acceptedForSimulation: Boolean(request && request.valid),
      edgeFunctionCalled: false,
      apiCalled: false,
      sqlExecuted: false,
      databaseModified: false,
      customerCreated: false,
      simulationOnly: true
    });
  }
  ns.EdgeFunctionClient = Object.freeze({ version: '1.0.0', CONFIGURATION_KEYS, readiness, buildRequest, simulate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
