(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function create(options) {
    const installer = ns.RealSupabaseInstaller.create(options);
    const deployment = root.OmniDeployment && root.OmniDeployment.DeploymentEngine;
    return Object.freeze({
      validateConnection: input => installer.validateConnection(input),
      install: confirmed => installer.install(confirmed),
      verify: () => installer.verify(),
      rollbackPreview: () => installer.rollbackPreview(),
      invokeProvisioning: (action, payload) => installer.invokeProvisioning(action, payload),
      status: () => Object.freeze({
        ...installer.status(),
        deploymentEngineAvailable: Boolean(deployment),
        deploymentArchitectureReady: Boolean(deployment && deployment.health().score === 100)
      }),
      prepareCustomerDeployment: (input, adminContext) => deployment ? deployment.prepare(input, adminContext) : null,
      clear: () => installer.clear()
    });
  }
  ns.DeploymentInstallerBridge = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
