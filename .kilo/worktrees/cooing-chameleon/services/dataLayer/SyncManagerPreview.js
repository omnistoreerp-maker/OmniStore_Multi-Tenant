(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  function preview(input = {}) {
    const collections = Array.isArray(input.collections) ? input.collections : [];
    return Object.freeze({
      sourceProvider: input.sourceProvider || 'memory-preview',
      targetProvider: input.targetProvider || 'disabled-provider',
      collections: Object.freeze([...collections]),
      direction: input.direction || 'one-way-preview',
      estimatedOperations: Number(input.estimatedOperations) || 0,
      status: 'preview_only',
      synced: false,
      uploaded: false,
      downloaded: false,
      conflictsApplied: false
    });
  }
  ns.SyncManagerPreview = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
