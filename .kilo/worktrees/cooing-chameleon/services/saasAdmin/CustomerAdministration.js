(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function normalize(customer) {
    if (!customer) return null;
    const limits = customer.planLimits || {};
    const metrics = {
      users: customer.users, branches: customer.branches, warehouses: customer.warehouses,
      posDevices: customer.posDevices, products: customer.products, customers: customer.customers,
      suppliers: customer.suppliers, invoices: customer.invoices, storageBytes: customer.storageUsage
    };
    return Object.freeze({ ...customer, limitUsage: ns.PlanLimitValidator.usage(metrics, limits) });
  }
  ns.CustomerAdministration = Object.freeze({ version: '1.0.0', normalize, normalizeList: values => Object.freeze((values || []).map(normalize)) });
})(typeof globalThis !== 'undefined' ? globalThis : window);
