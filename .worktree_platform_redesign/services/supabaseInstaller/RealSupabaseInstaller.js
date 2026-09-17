(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function create(options) {
    options = options || {};
    let config = null;
    let session = null;
    let connection = null;
    let health = null;
    let lastInstallation = null;
    let lastVerification = null;
    async function resolveSession() {
      const value = typeof options.sessionProvider === 'function' ? await options.sessionProvider() : null;
      return value && value.accessToken ? Object.freeze({ accessToken: value.accessToken, role: value.role, userId: value.userId || null }) : null;
    }
    async function validateConnection(input) {
      const validation = ns.InstallerConfiguration.validate(input);
      if (!validation.valid) return Object.freeze({ valid: false, errors: validation.errors, health: null });
      session = await resolveSession();
      const tested = await ns.SupabaseConnectionTester.test(validation.config, session, options.fetchImpl);
      const builtHealth = ns.SupabaseHealthChecker.build(tested);
      if (tested.valid) { config = validation.config; connection = tested; health = builtHealth; }
      return Object.freeze({ valid: tested.valid, errors: tested.errors, health: builtHealth, config: ns.InstallerConfiguration.publicView(validation.config) });
    }
    async function install(confirmed) {
      if (!confirmed) throw new Error('INSTALL_CONFIRMATION_REQUIRED');
      if (!config || !connection || !connection.valid || !session) throw new Error('VALID_CONNECTION_REQUIRED');
      lastInstallation = await ns.EdgeFunctionInstallerClient.invoke(config, session, 'install', { confirmation: 'INSTALL_DATABASE', migrationVersion: ns.MigrationManifest.VERSION, migrationIds: ns.MigrationManifest.MIGRATIONS.map(item => item.id) }, options.fetchImpl);
      const verificationResponse = await ns.EdgeFunctionInstallerClient.invoke(config, session, 'verify', { migrationVersion: ns.MigrationManifest.VERSION }, options.fetchImpl);
      lastVerification = ns.InstallationVerifier.summarize(verificationResponse);
      return Object.freeze({
        installation: lastInstallation,
        progress: ns.MigrationProgressTracker.fromResponse(lastInstallation),
        verification: lastVerification,
        report: ns.InstallationReportBuilder.build(lastInstallation, lastVerification)
      });
    }
    async function verify() {
      if (!config || !session) throw new Error('VALID_CONNECTION_REQUIRED');
      const response = await ns.EdgeFunctionInstallerClient.invoke(config, session, 'verify', { migrationVersion: ns.MigrationManifest.VERSION }, options.fetchImpl);
      lastVerification = ns.InstallationVerifier.summarize(response);
      return lastVerification;
    }
    async function rollbackPreview() {
      if (!config || !session) return ns.InstallerRollbackPlanner.preview({ verified: false }, ns.MigrationManifest.VERSION);
      const response = await ns.EdgeFunctionInstallerClient.invoke(config, session, 'rollback-preview', { migrationVersion: ns.MigrationManifest.VERSION }, options.fetchImpl);
      return Object.freeze({ ...ns.InstallerRollbackPlanner.preview(response.body && response.body.snapshot, ns.MigrationManifest.VERSION), serverPlan: response.body });
    }
    async function invokeProvisioning(action, payload) {
      if (!config || !connection || !connection.valid || !session) throw new Error('VALID_CONNECTION_REQUIRED');
      return ns.EdgeFunctionInstallerClient.invoke(config, session, action, payload || {}, options.fetchImpl);
    }
    function status() {
      return Object.freeze({
        configured: Boolean(config),
        connectionValidated: Boolean(connection && connection.valid),
        installEnabled: Boolean(config && connection && connection.valid && session),
        health,
        lastInstallation,
        lastVerification,
        secretsPersisted: false
      });
    }
    function clear() { config = session = connection = health = lastInstallation = lastVerification = null; return status(); }
    return Object.freeze({ validateConnection, install, verify, rollbackPreview, invokeProvisioning, status, clear });
  }
  ns.RealSupabaseInstaller = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
