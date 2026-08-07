(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  let current = null;
  const normalize = value => value ? Object.freeze({
    tenantId: String(value.tenantId || value.id || ''),
    workspaceId: String(value.workspaceId || ''),
    role: String(value.role || 'viewer'),
    previewOnly: true,
    persisted: false
  }) : null;
  function setPreview(value) { current = normalize(value); return current; }
  function clearPreview() { const previous = current; current = null; return Object.freeze({ previous, persisted: false }); }
  ns.TenantContext = Object.freeze({ version: '1.0.0', setPreview, getCurrent: () => current, clearPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
