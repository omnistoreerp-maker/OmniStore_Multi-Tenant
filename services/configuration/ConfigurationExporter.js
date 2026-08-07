(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  function build(config = {}, options = {}) {
    return Object.freeze({
      _meta: Object.freeze({
        product: 'OmniStore ERP',
        format: 'omnistore-configuration-preview',
        version: '1.0.0',
        previewOnly: true,
        generatedAt: options.generatedAt || new Date().toISOString(),
        permanentSave: false
      }),
      ...JSON.parse(JSON.stringify(config))
    });
  }
  function stringify(config, options) {
    return JSON.stringify(build(config, options), null, 2);
  }
  ns.ConfigurationExporter = Object.freeze({ version: '1.0.0', build, stringify });
})(typeof globalThis !== 'undefined' ? globalThis : window);
