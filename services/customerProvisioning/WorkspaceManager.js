(function (root) {
  'use strict';
  const ns = root.OmniCustomerProvisioning = root.OmniCustomerProvisioning || {};
  function normalizeList(response) {
    const customers = response && Array.isArray(response.customers) ? response.customers : [];
    return Object.freeze(customers.map(customer => Object.freeze({
      tenantId: customer.tenantId,
      workspaceId: customer.workspaceId,
      businessName: customer.businessName,
      status: customer.status,
      workspaceStatus: customer.status,
      subscriptionPlan: customer.subscriptionPlan,
      subscriptionStatus: customer.subscriptionStatus,
      databaseVersion: customer.databaseVersion,
      migrationVersion: customer.migrationVersion,
      storageBytes: Number(customer.storageBytes || 0),
      storageObjects: Number(customer.storageObjects || 0),
      loginUrl: customer.loginUrl,
      createdAt: customer.createdAt
    })));
  }
  ns.WorkspaceManager = Object.freeze({ version: '1.0.0', normalizeList });
})(typeof globalThis !== 'undefined' ? globalThis : window);
