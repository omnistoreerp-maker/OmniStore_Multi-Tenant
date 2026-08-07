(function (root) {
  'use strict';
  const ns = root.OmniAuthPreview = root.OmniAuthPreview || {};
  function preview(session) {
    return Object.freeze({
      sessionId: session ? session.id : null,
      wouldEndSession: Boolean(session),
      realSessionEnded: false,
      storageCleared: false,
      backendContacted: false,
      previewOnly: true
    });
  }
  ns.LogoutPreview = Object.freeze({ version: '1.0.0', preview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
