(function (root) {
  'use strict';
  function updateVisibility() {
    const loader = root.OmniModuleLoader;
    if (!loader) return;
    root.document.querySelectorAll('#page-dashboard .stat-card[onclick*="showPage"]').forEach(function(card) {
      var match = String(card.getAttribute('onclick') || '').match(/showPage\(['"]([^'"]+)/);
      if (match) card.style.display = loader.isRouteEnabled(match[1]) ? '' : 'none';
    });
  }
  function build() { updateVisibility(); return []; }
  root.OmniDashboardBuilder = Object.freeze({ build, updateVisibility });
})(typeof globalThis !== 'undefined' ? globalThis : window);
