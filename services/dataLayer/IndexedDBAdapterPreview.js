(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function create() {
    return ns.StorageAdapter.create({ id: 'indexeddb-preview', name: 'IndexedDB Provider Preview', kind: 'offline-preview', supports: { read: false, write: false, transactions: false, sync: false } });
  }
  ns.IndexedDBAdapterPreview = Object.freeze({ version: '1.0.0', create, connectionMode: 'disabled' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
