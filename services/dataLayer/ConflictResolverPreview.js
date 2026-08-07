(function (root) {
  'use strict';
  const ns = root.OmniDataLayer = root.OmniDataLayer || {};
  const STRATEGIES = Object.freeze(['source_wins', 'target_wins', 'latest_timestamp', 'manual_review']);
  function preview(conflict = {}, strategy = 'manual_review') {
    if (!STRATEGIES.includes(strategy)) throw new Error('Unsupported conflict strategy.');
    const candidate = strategy === 'source_wins' ? conflict.source : strategy === 'target_wins' ? conflict.target : null;
    return Object.freeze({
      conflictId: conflict.id || 'CONFLICT-PREVIEW',
      strategy,
      source: ns.DataLayerUtils.freeze(ns.DataLayerUtils.clone(conflict.source)),
      target: ns.DataLayerUtils.freeze(ns.DataLayerUtils.clone(conflict.target)),
      candidate: ns.DataLayerUtils.freeze(ns.DataLayerUtils.clone(candidate)),
      requiresManualReview: candidate == null,
      applied: false,
      previewOnly: true
    });
  }
  ns.ConflictResolverPreview = Object.freeze({ version: '1.0.0', STRATEGIES, preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
