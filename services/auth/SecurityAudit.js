(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function preview(events = []) {
    const safeEvents = (Array.isArray(events) ? events : []).map((event, index) => Object.freeze({
      id: event.id || `AUDIT-PREVIEW-${index + 1}`,
      type: event.type || 'unknown',
      outcome: event.outcome || 'preview',
      actor: event.actor || 'mock-user',
      occurredAt: event.occurredAt || 'preview-time',
      mock: true
    }));
    const failed = safeEvents.filter(event => event.outcome === 'denied' || event.outcome === 'failed');
    return Object.freeze({
      events: Object.freeze(safeEvents),
      total: safeEvents.length,
      failed: failed.length,
      securityHealth: failed.length ? Math.max(0, 100 - failed.length * 10) : 100,
      persisted: false,
      exported: false,
      previewOnly: true
    });
  }
  ns.SecurityAudit = Object.freeze({ version: '1.0.0', preview, storage: 'none' });
})(typeof globalThis !== 'undefined' ? globalThis : window);
