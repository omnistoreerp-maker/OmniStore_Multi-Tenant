(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function build(items = []) {
    return Object.freeze({
      items: Object.freeze(ns.DataLayerUtils.clone(items)),
      count: Array.isArray(items) ? items.length : 0,
      previewOnly: true,
      persisted: false,
      processing: false
    });
  }
  function previewEnqueue(queue, operation) {
    const current = queue && Array.isArray(queue.items) ? queue.items : [];
    return Object.freeze({
      candidateQueue: build([...current, { ...ns.DataLayerUtils.clone(operation), queued: false, previewOnly: true }]),
      originalCount: current.length,
      enqueued: false,
      persisted: false
    });
  }
  ns.OfflineQueuePreview = Object.freeze({ version: '1.0.0', build, previewEnqueue });
})(typeof globalThis !== 'undefined' ? globalThis : window);
