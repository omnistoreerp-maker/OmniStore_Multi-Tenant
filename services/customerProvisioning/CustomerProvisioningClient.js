(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function create(installerEngine) {
    if (!installerEngine || typeof installerEngine.invokeProvisioning !== 'function') throw new Error('REAL_SUPABASE_INSTALLER_REQUIRED');
    const invoke = async (action, payload) => {
      const response = await installerEngine.invokeProvisioning(action, payload || {});
      return response.body;
    };
    return Object.freeze({
      provision: payload => invoke('provision-customer', payload),
      list: () => invoke('list-customers'),
      details: tenantId => invoke('customer-details', { tenantId }),
      health: tenantId => invoke('workspace-health', { tenantId }),
      history: tenantId => invoke('provision-history', tenantId ? { tenantId } : {}),
      audit: tenantId => invoke('workspace-audit', tenantId ? { tenantId } : {}),
      rollbackPreview: tenantId => invoke('customer-rollback-preview', { tenantId }),
      deleteCustomer: (tenantId, confirmation) => invoke('delete-customer', { tenantId, confirmation })
    });
  }
  ns.CustomerProvisioningClient = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
