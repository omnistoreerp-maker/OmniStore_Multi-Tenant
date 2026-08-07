(function (root) {
  'use strict';
  const ns = root.OmniDeployment = root.OmniDeployment || {};
  function plan() {
    return Object.freeze({
      sourceDraft: '010_rls_policies_multi_tenant.sql',
      operations: Object.freeze(['select','insert','update','delete']),
      isolationColumn: 'tenant_id',
      claimSource: 'verified-auth-context',
      installer: 'edge-function',
      installed: false,
      sqlExecuted: false
    });
  }
  ns.RLSPolicyInstaller = Object.freeze({ version: '1.0.0', plan });
})(typeof globalThis !== 'undefined' ? globalThis : window);
