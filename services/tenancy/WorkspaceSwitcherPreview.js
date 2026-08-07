(function (root) {
  'use strict';
  const ns = root.OmniTenancyPreview = root.OmniTenancyPreview || {};
  function preview(fromTenantId, toTenantId, role) {
    const target = ns.TenantManager.find(toTenantId);
    return Object.freeze({
      valid: Boolean(target),
      fromTenantId: fromTenantId || null,
      toTenantId: target ? target.id : null,
      nextContext: target ? Object.freeze({ tenantId: target.id, workspaceId: `workspace-${target.id}`, role: role || 'owner', previewOnly: true }) : null,
      switchedInReality: false,
      dataLoaded: false,
      persisted: false
    });
  }
  ns.WorkspaceSwitcherPreview = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
