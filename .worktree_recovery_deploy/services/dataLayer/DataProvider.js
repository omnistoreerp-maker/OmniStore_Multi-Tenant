(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const freeze = value => Object.freeze(value);
  ns.DataLayerUtils = Object.freeze({ clone, freeze, list: value => Array.isArray(value) ? value : [] });
  function create(definition = {}) {
    if (!definition.id) throw new Error('Provider id is required.');
    return freeze({
      id: definition.id,
      name: definition.name || definition.id,
      type: definition.type || 'preview',
      adapter: definition.adapter || null,
      configured: definition.configured === true,
      connected: false,
      previewOnly: true,
      capabilities: freeze({ read: true, write: false, transactions: false, sync: false, ...(definition.capabilities || {}) }),
      metadata: freeze(clone(definition.metadata || {}))
    });
  }
  ns.DataProvider = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
