(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function check(providers = []) {
    const results = providers.map(provider => Object.freeze({
      id: provider.id,
      name: provider.name,
      availableForPreview: Boolean(provider.adapter),
      connected: false,
      status: provider.adapter ? 'preview_ready' : 'adapter_missing',
      message: provider.adapter ? 'Adapter interface available; connection disabled by design.' : 'Adapter interface is missing.'
    }));
    const score = results.length ? Math.round((results.filter(item => item.availableForPreview).length / results.length) * 100) : 0;
    return Object.freeze({ score, healthy: score === 100, currentProvider: providers[0] ? providers[0].id : null, providers: Object.freeze(results), actualConnections: 0 });
  }
  ns.ConnectionHealthChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
