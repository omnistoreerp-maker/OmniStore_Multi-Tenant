(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function previewOperation(providerId, operation, collection, payload) {
    return Object.freeze({
      providerId,
      operation,
      collection: String(collection || ''),
      payload: ns.DataLayerUtils.freeze(ns.DataLayerUtils.clone(payload)),
      previewOnly: true,
      executed: false,
      persisted: false
    });
  }
  function create(definition = {}) {
    if (!definition.id) throw new Error('Adapter id is required.');
    return Object.freeze({
      id: definition.id,
      name: definition.name || definition.id,
      kind: definition.kind || 'preview',
      connected: false,
      previewOnly: true,
      supports: Object.freeze({ read: false, write: false, transactions: false, sync: false, ...(definition.supports || {}) }),
      list: definition.list || (() => []),
      get: definition.get || (() => null),
      query: definition.query || (() => []),
      previewCreate: (collection, payload) => previewOperation(definition.id, 'create', collection, payload),
      previewUpdate: (collection, payload) => previewOperation(definition.id, 'update', collection, payload),
      previewDelete: (collection, payload) => previewOperation(definition.id, 'delete', collection, payload),
      previewTransaction: operations => Object.freeze({ adapterId: definition.id, operations: Object.freeze(ns.DataLayerUtils.clone(operations || [])), previewOnly: true, committed: false })
    });
  }
  ns.StorageAdapter = Object.freeze({ version: '1.0.0', create, previewOperation });
})(typeof globalThis !== 'undefined' ? globalThis : window);
