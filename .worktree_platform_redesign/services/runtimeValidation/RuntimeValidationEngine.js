(function (root) {
  'use strict';
  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const VALIDATORS = Object.freeze([
    'BusinessRuleValidator',
    'WarehouseRuntimeValidator',
    'InventoryRuntimeValidator',
    'AccountingRuntimeValidator',
    'CurrencyRuntimeValidator',
    'TaxRuntimeValidator',
    'DocumentRuntimeValidator',
    'PermissionRuntimeValidator',
    'PostingRuntimeValidator'
  ]);

  function validate(context = {}) {
    const safeContext = { ...context };
    const results = VALIDATORS.map(name => {
      if (!ns[name] || typeof ns[name].validate !== 'function') throw new Error(`${name} is not loaded.`);
      return ns[name].validate(safeContext);
    });
    const report = ns.RuntimeValidationReportBuilder.build(results);
    return Object.freeze({
      readOnly: true,
      persisted: false,
      posted: false,
      inventoryUpdated: false,
      databaseTouched: false,
      results: Object.freeze(results),
      report
    });
  }

  function createEngine(baseContext = {}) {
    const initial = Object.freeze({ ...baseContext });
    return Object.freeze({ validate: extra => validate({ ...initial, ...(extra || {}) }) });
  }

  ns.RuntimeValidationEngine = Object.freeze({ version: '1.0.0', VALIDATORS, validate, createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
