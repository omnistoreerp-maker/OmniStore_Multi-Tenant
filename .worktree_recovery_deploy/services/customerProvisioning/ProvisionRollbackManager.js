(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function validateDeletion(tenantId, confirmation) {
    const expected = `DELETE_CUSTOMER:${tenantId}`;
    return Object.freeze({ valid: Boolean(tenantId && confirmation === expected), expected, targetScope: 'single-tenant-only' });
  }
  ns.ProvisionRollbackManager = Object.freeze({ version: '1.0.0', validateDeletion });
})(typeof globalThis !== 'undefined' ? globalThis : window);
