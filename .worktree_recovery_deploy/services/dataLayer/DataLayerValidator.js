(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  const REQUIRED_ADAPTER_METHODS = Object.freeze(['list','get','query','previewCreate','previewUpdate','previewDelete','previewTransaction']);
  function validateAdapter(adapter) {
    const errors = [];
    if (!adapter || !adapter.id) errors.push({ code: 'ADAPTER_ID_MISSING', message: 'Adapter id is required.' });
    REQUIRED_ADAPTER_METHODS.forEach(method => {
      if (!adapter || typeof adapter[method] !== 'function') errors.push({ code: 'ADAPTER_METHOD_MISSING', reference: method, message: `Adapter method is missing: ${method}` });
    });
    if (adapter && adapter.previewOnly !== true) errors.push({ code: 'ADAPTER_NOT_PREVIEW_ONLY', message: 'Adapter must be preview-only.' });
    if (adapter && adapter.connected !== false) errors.push({ code: 'ADAPTER_CONNECTION_NOT_DISABLED', message: 'Adapter connection must remain disabled.' });
    if (adapter && adapter.supports && adapter.supports.write !== false) errors.push({ code: 'ADAPTER_WRITE_NOT_DISABLED', message: 'Adapter writes must remain disabled.' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }
  function validateRepository(input = {}) {
    const adapterValidation = validateAdapter(input.adapter);
    const errors = [...adapterValidation.errors];
    if (!input.collection) errors.push({ code: 'REPOSITORY_COLLECTION_MISSING', message: 'Repository collection is required.' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), readOnly: true });
  }
  function validateLayer(input = {}) {
    const providers = Array.isArray(input.providers) ? input.providers : [];
    const validations = providers.map(provider => validateAdapter(provider.adapter));
    const errors = validations.flatMap(result => result.errors);
    if (!providers.length) errors.push({ code: 'PROVIDERS_MISSING', message: 'At least one provider is required.' });
    const readinessScore = providers.length ? Math.max(0, 100 - errors.length * 10) : 0;
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), providerCount: providers.length, readinessScore, previewOnly: true });
  }
  ns.DataLayerValidator = Object.freeze({ version: '1.0.0', REQUIRED_ADAPTER_METHODS, validateAdapter, validateRepository, validateLayer });
})(typeof globalThis !== 'undefined' ? globalThis : window);
