(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function create(seed = {}) {
    const snapshot = Object.freeze(ns.DataLayerUtils.clone(seed));
    const base = ns.StorageAdapter.create({
      id: 'memory-preview',
      name: 'Memory Snapshot Provider',
      kind: 'memory-preview',
      supports: { read: true, write: false, transactions: false, sync: false },
      list(collection) { return ns.DataLayerUtils.clone(Array.isArray(snapshot[collection]) ? snapshot[collection] : []); },
      get(collection, id) {
        const item = (Array.isArray(snapshot[collection]) ? snapshot[collection] : []).find(entry => String(entry.id) === String(id));
        return ns.DataLayerUtils.clone(item || null);
      },
      query(collection, predicate) {
        const items = Array.isArray(snapshot[collection]) ? snapshot[collection] : [];
        return ns.DataLayerUtils.clone(typeof predicate === 'function' ? items.filter(predicate) : items);
      }
    });
    return Object.freeze({ ...base, snapshot: () => ns.DataLayerUtils.clone(snapshot), recordCount: () => Object.values(snapshot).reduce((sum, values) => sum + (Array.isArray(values) ? values.length : 0), 0) });
  }
  ns.MemoryAdapter = Object.freeze({ version: '1.0.0', create });
})(typeof globalThis !== 'undefined' ? globalThis : window);
