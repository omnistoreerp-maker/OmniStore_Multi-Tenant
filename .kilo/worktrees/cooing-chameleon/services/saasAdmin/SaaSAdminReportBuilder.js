(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  function dashboard(value) {
    value = value || {};
    return Object.freeze({
      customers: Number(value.customers || 0),
      activeCustomers: Number(value.activeCustomers || 0),
      suspendedCustomers: Number(value.suspendedCustomers || 0),
      activeLicenses: Number(value.licenses && value.licenses.active || 0),
      expiringLicenses: Number(value.licenses && value.licenses.expiring || 0),
      revenuePreview: Number(value.revenuePreview || 0),
      currency: value.currency || 'USD',
      version: value.version || null
    });
  }
  ns.SaaSAdminReportBuilder = Object.freeze({ version: '1.0.0', dashboard });
})(typeof globalThis !== 'undefined' ? globalThis : window);
