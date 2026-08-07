(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function build(result, summary) {
    return Object.freeze({
      success: Boolean(result && result.status === 'active'),
      tenantId: result && result.tenantId || null,
      workspaceId: result && result.workspaceId || null,
      ownerUserId: result && result.ownerUserId || null,
      businessName: summary.businessName,
      loginUrl: result && result.loginUrl || null,
      migrationVersion: result && result.migrationVersion || null,
      dataSchema: result && result.dataSchema || 'omnistore',
      isolationKey: result && result.isolationKey || 'tenant_id',
      apiKeyGenerated: Boolean(result && result.apiKeyShownOnce),
      apiKeyPersistedInBrowser: false,
      passwordRetained: false,
      accountingPostingPerformed: false,
      inventoryPostingPerformed: false,
      setupReport: result && result.setupReport || null
    });
  }
  ns.ProvisioningReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
