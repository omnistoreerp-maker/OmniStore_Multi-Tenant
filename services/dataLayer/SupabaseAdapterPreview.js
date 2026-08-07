(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function create() {
    return ns.StorageAdapter.create({ id: 'supabase-preview', name: 'Supabase Provider Preview', kind: 'cloud-preview', supports: { read: false, write: false, transactions: false, sync: false } });
  }
  ns.SupabaseAdapterPreview = Object.freeze({ version: '1.0.0', create, connectionMode: 'disabled' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
