(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function create(adapter, collection) {
    if (!adapter || adapter.previewOnly !== true) throw new Error('A preview-only adapter is required.');
    if (!collection) throw new Error('Repository collection is required.');
    return Object.freeze({
      collection,
      adapterId: adapter.id,
      readOnly: true,
      list: () => adapter.list(collection),
      get: id => adapter.get(collection, id),
      query: predicate => adapter.query(collection, predicate),
      previewCreate: payload => adapter.previewCreate(collection, payload),
      previewUpdate: payload => adapter.previewUpdate(collection, payload),
      previewDelete: payload => adapter.previewDelete(collection, payload),
      validate: () => ns.DataLayerValidator.validateRepository({ adapter, collection })
    });
  }
  ns.DataRepository = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
