(function (root) {
  'use strict';
  const ns = root.OmniSaaSAdmin = root.OmniSaaSAdmin || {};
  const KEYS = Object.freeze(['users','branches','warehouses','posDevices','products','customers','suppliers','invoices','storageBytes']);
  function validate(limits) {
    limits = limits || {};
    const errors = KEYS.filter(key => !Number.isFinite(Number(limits[key])) || Number(limits[key]) < 0).map(key => ({ field: key, code: 'NON_NEGATIVE_NUMBER_REQUIRED' }));
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), limits: Object.freeze(Object.fromEntries(KEYS.map(key => [key, Number(limits[key] || 0)]))) });
  }
  function usage(metrics, limits) {
    return Object.freeze(Object.fromEntries(KEYS.map(key => {
      const current = Number(metrics && metrics[key] || 0);
      const maximum = Number(limits && limits[key] || 0);
      return [key, Object.freeze({ current, maximum, percent: maximum ? Math.round(current / maximum * 100) : 0, exceeded: maximum > 0 && current > maximum })];
    })));
  }
  ns.PlanLimitValidator = Object.freeze({ version: '1.0.0', KEYS, validate, usage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
