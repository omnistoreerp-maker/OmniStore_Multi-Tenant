(function (root) {
  'use strict';

  const groups = {
    main: { title: '📊 الرئيسية' },
    sales: { title: '🛒 الفواتير والمبيعات' },
    inventory: { title: '📦 المخزون' },
    reports: { title: '📈 التقارير والمالية' },
    customers: { title: '👥 العملاء والموردون' },
    admin: { title: '⚙️ الإدارة' },
    maintenance: { title: '🔧 الصيانة والضمان' },
    analytics: { title: '💡 التحليلات' },
    employees: { title: '👨‍💼 الموظفون' }
  };

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function canShow(route) {
    if (typeof root.canAccessPage !== 'function') return true;
    try { return root.canAccessPage(route); } catch (e) { return true; }
  }

  function build() {
    const loader = root.OmniModuleLoader;
    if (!loader || !root.document) return {};
    const enabled = loader.getActiveModules();
    const pluginNavigation = root.OmniPluginSDK?.getActivePlugins?.().flatMap(plugin =>
      (plugin.navigation || []).map(item => ({ ...item, moduleId: `plugin:${plugin.metadata.id}` }))
    ) || [];
    const result = {};
    Object.entries(groups).forEach(([groupId, meta]) => {
      const dropdown = root.document.getElementById(`dropdown-${groupId}`);
      if (!dropdown) return;
      const moduleRoutes = enabled.flatMap(module =>
        (module.navigation || []).filter(item => item.group === groupId && canShow(item.route))
          .map(item => ({ ...item, moduleId: module.id }))
      );
      const combined = [...moduleRoutes, ...pluginNavigation.filter(item => item.group === groupId && canShow(item.route))
        .map(item => ({
          ...item,
          name: root.OmniPluginSDK.translate(item.moduleId.replace('plugin:', ''), item.labelKey || item.name || 'settings')
        }))];
      const routes = combined.filter((item, index, rows) => rows.findIndex(row => row.route === item.route) === index);
      dropdown.innerHTML = `<div class="nav-dropdown-header">${meta.title}</div>` + routes.map(item =>
        `<div class="nav-dropdown-item" data-page="${escapeHtml(item.route)}" data-module-id="${escapeHtml(item.moduleId)}" onclick="showPage('${escapeHtml(item.route)}');closeAllNavDropdowns()"><span class="icon">${escapeHtml(item.icon)}</span> ${escapeHtml(item.name)}</div>`
      ).join('');
      const button = root.document.querySelector(`.nav-icon-btn[onclick*="'${groupId}'"]`);
      if (button) button.style.display = routes.length ? '' : 'none';
      result[groupId] = routes.map(item => item.route);
    });
    const alertButton = root.document.getElementById('alertsBellBtn');
    if (alertButton) alertButton.style.display = loader.isRouteEnabled('alerts-center') ? '' : 'none';
    const catchButton = root.document.getElementById('catchNumberModuleBtn');
    if (catchButton) catchButton.style.display = loader.isRouteEnabled('cathnumber') ? '' : 'none';
    root.document.querySelectorAll('#pwaBottomNav button[onclick*="pwaNavigate"]').forEach(button => {
      const match = String(button.getAttribute('onclick') || '').match(/pwaNavigate\(['"]([^'"]+)/);
      if (match) button.style.display = loader.isRouteEnabled(match[1]) ? '' : 'none';
    });
    return result;
  }

  root.OmniNavigationBuilder = Object.freeze({ build, groups: Object.keys(groups) });
})(typeof globalThis !== 'undefined' ? globalThis : window);
