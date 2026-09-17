(function (root) {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function updateVisibility() {
    const loader = root.OmniModuleLoader;
    if (!loader) return;
    root.document.querySelectorAll('#page-dashboard .stat-card[onclick*="showPage"]').forEach(function(card) {
      var match = String(card.getAttribute('onclick') || '').match(/showPage\(['"]([^'"]+)/);
      if (match) card.style.display = loader.isRouteEnabled(match[1]) ? '' : 'none';
    });
  }

  // Widgets declared by enabled modules (OmniModuleRegistry definitions).
  function moduleWidgets() {
    const loader = root.OmniModuleLoader;
    if (!loader || typeof loader.getActiveModules !== 'function') return [];
    const widgets = [];
    loader.getActiveModules().forEach(module => {
      (module.widgets || []).forEach(widget => {
        widgets.push(Object.assign({}, widget, { moduleId: module.id }));
      });
    });
    return widgets;
  }

  // Cards contributed by active business plugins (dashboardCards contract).
  function pluginWidgets() {
    const sdk = root.OmniPluginSDK;
    if (!sdk || typeof sdk.getActivePlugins !== 'function') return [];
    const widgets = [];
    sdk.getActivePlugins().forEach(plugin => {
      const id = plugin && plugin.metadata ? plugin.metadata.id : null;
      if (!id) return;
      (plugin.dashboardCards || []).forEach(card => {
        widgets.push(Object.assign({}, card, { moduleId: 'plugin:' + id, pluginId: id }));
      });
    });
    return widgets;
  }

  function render(host, widgets) {
    if (!host) return;
    host.innerHTML = widgets.map(widget => {
      const moduleId = escapeHtml(widget.moduleId || '');
      const label = escapeHtml(widget.label || widget.labelKey || widget.id || moduleId);
      const icon = escapeHtml(widget.icon || '📊');
      const route = widget.route ? escapeHtml(widget.route) : '';
      const onclick = route ? ` onclick="showPage('${route}')"` : '';
      return `<div class="stat-card omni-dashboard-widget" data-module-widget="${moduleId}"${onclick}>` +
             `<div class="stat-label">${icon} ${label}</div></div>`;
    }).join('');
  }

  function build() {
    const widgets = moduleWidgets().concat(pluginWidgets());
    const host = root.document && root.document.getElementById
      ? root.document.getElementById('omniDynamicDashboardWidgets')
      : null;
    render(host, widgets);
    updateVisibility();
    return widgets;
  }

  root.OmniDashboardBuilder = Object.freeze({ build, updateVisibility });
})(typeof globalThis !== 'undefined' ? globalThis : window);
