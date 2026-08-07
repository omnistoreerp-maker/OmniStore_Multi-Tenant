(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  const CATEGORIES = Object.freeze(['licenseExpiration','storageLimits','planLimits','inactiveCustomer','failedProvision']);
  function normalize(value) {
    value = value || {};
    return Object.freeze({
      categories: Object.freeze(Object.fromEntries(CATEGORIES.map(key => [key, Object.freeze(value[key] || [])]))),
      total: CATEGORIES.reduce((sum, key) => sum + (value[key] || []).length, 0),
      notificationsSent: 0,
      previewOnly: true
    });
  }
  ns.NotificationPreviewEngine = Object.freeze({ version: '1.0.0', CATEGORIES, normalize });
})(typeof globalThis !== 'undefined' ? globalThis : window);
