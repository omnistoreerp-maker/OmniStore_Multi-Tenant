(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function preview(snapshot, migrationVersion) {
    return Object.freeze({
      action: 'rollback-preview',
      snapshotVerified: Boolean(snapshot && snapshot.verified),
      migrationVersion: migrationVersion || ns.MigrationManifest.VERSION,
      steps: Object.freeze(['authenticate-admin','verify-database-snapshot','compare-migration-history','identify-created-objects','generate-transactional-rollback','require-second-confirmation','execute-server-side-only','verify-restored-state']),
      executionEnabled: false,
      rollbackExecuted: false
    });
  }
  ns.InstallerRollbackPlanner = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
