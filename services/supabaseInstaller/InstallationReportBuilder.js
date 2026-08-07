(function (root) {
  'use strict';
  const ns = root.OmniSupabaseInstaller = root.OmniSupabaseInstaller || {};
  function build(installation, verification) {
    return Object.freeze({
      installationId: installation && installation.body && installation.body.installationId || null,
      success: Boolean(installation && installation.ok && verification && verification.valid),
      migrationVersion: installation && installation.body && installation.body.migrationVersion || 'unknown',
      verification,
      accountingPostingPerformed: false,
      inventoryPostingPerformed: false,
      customerBusinessDataChanged: false,
      generatedAt: new Date().toISOString()
    });
  }
  ns.InstallationReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
