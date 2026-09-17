(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function create() {
    return ns.StorageAdapter.create({ id: 'sqlite-preview', name: 'SQLite Provider Preview', kind: 'desktop-preview', supports: { read: false, write: false, transactions: false, sync: false } });
  }
  ns.SQLiteAdapterPreview = Object.freeze({ version: '1.0.0', create, connectionMode: 'disabled' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
