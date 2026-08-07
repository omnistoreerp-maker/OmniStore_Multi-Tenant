(function (root) {
  'use strict';

  let selectedPluginId = '';

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function metricValue(metric) {
    const snapshot = root.getOmniPluginRuntimeSnapshot?.() || {};
    if (metric === 'product_count') return snapshot.productCount || 0;
    if (metric === 'sales_count') return snapshot.salesCount || 0;
    if (metric === 'sales_total') return root.formatMoney?.(snapshot.salesTotal || 0) || snapshot.salesTotal || 0;
    if (metric === 'stock_value') return root.formatMoney?.(snapshot.stockValue || 0) || snapshot.stockValue || 0;
    return snapshot[metric] ?? 0;
  }

  function renderMarketplace() {
    const host = root.document?.getElementById('businessPluginMarketplaceGrid');
    if (!host || !root.OmniPluginSDK) return;
    const currentType = root.OmniPluginSDK.getCurrentBusinessType();
    host.innerHTML = root.OmniPluginSDK.listPlugins().map(plugin => {
      const id = plugin.metadata.id;
      const state = root.OmniPluginSDK.getPluginState(id);
      const compatible = root.OmniPluginSDK.isCompatible(plugin);
      const active = root.OmniPluginSDK.getActivePlugins().some(item => item.metadata.id === id);
      const matches = root.OmniPluginSDK.matchesBusinessType(plugin, currentType);
      return `<div class="table-container" style="padding:14px;margin:0;border:${active ? '2px solid var(--green)' : '1px solid var(--border)'}">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <div><div style="font-size:1.05rem;font-weight:900">${escapeHtml(plugin.icons.primary)} ${escapeHtml(plugin.metadata.name)}</div>
          <div style="font-size:.68rem;color:var(--text2)">${escapeHtml(id)} • v${escapeHtml(plugin.metadata.version)}</div></div>
          <span class="badge ${active ? 'badge-green' : state.installed ? 'badge-blue' : 'badge-yellow'}">${active ? 'Active' : state.installed ? state.enabled ? 'Enabled' : 'Disabled' : 'Not Installed'}</span>
        </div>
        <p style="font-size:.75rem;color:var(--text2);min-height:34px">${escapeHtml(plugin.metadata.description)}</p>
        <div style="font-size:.7rem">Business: <strong>${escapeHtml(plugin.metadata.businessType)}</strong>${matches ? ' ✓' : ''}</div>
        <div style="font-size:.7rem">Dependencies: ${escapeHtml(plugin.metadata.dependencies.join(', ') || 'None')}</div>
        <div style="font-size:.7rem">Compatibility: ${compatible ? 'Compatible' : 'Unavailable'}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:10px">
          ${!state.installed ? `<button class="btn btn-green btn-sm" onclick="installBusinessPlugin('${escapeHtml(id)}')">Install</button>` : ''}
          ${state.installed && !state.enabled ? `<button class="btn btn-green btn-sm" onclick="enableBusinessPlugin('${escapeHtml(id)}')">Enable</button>` : ''}
          ${state.installed && state.enabled ? `<button class="btn btn-yellow btn-sm" onclick="disableBusinessPlugin('${escapeHtml(id)}')">Disable</button>` : ''}
          ${state.installed ? `<button class="btn btn-danger btn-sm" onclick="uninstallBusinessPlugin('${escapeHtml(id)}')">Uninstall</button>` : ''}
          <button class="btn btn-outline btn-sm" onclick="openBusinessPluginSettings('${escapeHtml(id)}')">Settings</button>
        </div>
      </div>`;
    }).join('');
    const summary = root.document.getElementById('businessPluginMarketplaceSummary');
    if (summary) {
      const all = root.OmniPluginSDK.listPlugins();
      const installed = all.filter(p => root.OmniPluginSDK.getPluginState(p.metadata.id).installed).length;
      summary.textContent = `${all.length} Modules • ${installed} Installed • Business: ${currentType}`;
    }
  }

  function pluginAction(id, action) {
    try {
      root.OmniPluginSDK[action](id);
      bootstrap();
      root.showToast?.(`✅ Plugin ${action}: ${id}`);
    } catch (error) {
      root.showToast?.(error.message || String(error), 'error');
    }
  }

  function openSettings(id) {
    selectedPluginId = id;
    root.showPage?.('business-plugin-settings');
    renderSettings(id);
  }

  function renderSettings(id = selectedPluginId) {
    if (!id) id = root.OmniPluginSDK?.getActivePlugins?.()[0]?.metadata?.id || root.OmniPluginSDK?.listPlugins?.()[0]?.metadata?.id || '';
    const plugin = root.OmniPluginSDK?.getPlugin(id);
    const host = root.document?.getElementById('businessPluginSettingsContent');
    if (!plugin || !host) return;
    selectedPluginId = id;
    const settings = root.OmniPluginSDK.getSettings(id);
    const fields = Object.entries(settings).map(([key, value]) => {
      const control = typeof value === 'boolean'
        ? `<input data-plugin-setting="${escapeHtml(key)}" type="checkbox" ${value ? 'checked' : ''}>`
        : typeof value === 'number'
          ? `<input data-plugin-setting="${escapeHtml(key)}" type="number" value="${escapeHtml(value)}">`
          : `<input data-plugin-setting="${escapeHtml(key)}" value="${escapeHtml(value)}">`;
      return `<div class="form-group"><label>${escapeHtml(key)}</label>${control}</div>`;
    }).join('');
    host.innerHTML = `<div class="table-container">
      <div class="table-header"><div class="table-title">${escapeHtml(plugin.icons.primary)} ${escapeHtml(plugin.metadata.name)} — Settings</div><span class="badge badge-blue">v${escapeHtml(plugin.metadata.version)}</span></div>
      <div class="grid-2">${fields}</div>
      <div class="alert alert-info">Permissions: ${plugin.permissions.map(escapeHtml).join(' • ')}</div>
      <div style="text-align:left"><button class="btn btn-accent" onclick="saveBusinessPluginSettings()">💾 Save Module Settings</button></div>
    </div>`;
  }

  function saveSettings() {
    const host = root.document?.getElementById('businessPluginSettingsContent');
    if (!host || !selectedPluginId) return;
    const patch = {};
    host.querySelectorAll('[data-plugin-setting]').forEach(input => {
      const key = input.getAttribute('data-plugin-setting');
      patch[key] = input.type === 'checkbox' ? !!input.checked : input.type === 'number' ? Number(input.value) : input.value;
    });
    root.OmniPluginSDK.updateSettings(selectedPluginId, patch);
    root.showToast?.('✅ تم حفظ إعدادات النشاط محلياً');
    renderSettings(selectedPluginId);
  }

  function renderReports() {
    const host = root.document?.getElementById('businessPluginReportsPanel');
    if (!host || !root.OmniPluginSDK) return;
    const plugins = root.OmniPluginSDK.getActivePlugins();
    host.innerHTML = plugins.flatMap(plugin => plugin.reports.map(report =>
      `<div class="stat-card blue" style="padding:14px;cursor:pointer" onclick="showPage('${escapeHtml(report.route || 'reports')}')">
        <div class="stat-icon">${escapeHtml(plugin.icons.primary)}</div>
        <div class="stat-value" style="font-size:1rem">${escapeHtml(metricValue(report.metric))}</div>
        <div class="stat-label">${escapeHtml(root.OmniPluginSDK.translate(plugin.metadata.id, report.labelKey))}</div>
      </div>`
    )).join('') || '<div class="alert alert-info">لا توجد تقارير Plugin مفعّلة للنشاط الحالي.</div>';
  }

  function bootstrap() {
    root.OmniPluginSDK?.bootActive();
    root.bootstrapOmniModulePlatform?.();
    renderMarketplace();
    renderReports();
    root.OmniNavigationBuilder?.build();
    root.OmniDashboardBuilder?.build();
  }

  root.renderBusinessPluginMarketplace = renderMarketplace;
  root.renderBusinessPluginSettings = renderSettings;
  root.renderBusinessPluginReports = renderReports;
  root.installBusinessPlugin = id => pluginAction(id, 'install');
  root.uninstallBusinessPlugin = id => pluginAction(id, 'uninstall');
  root.enableBusinessPlugin = id => pluginAction(id, 'enable');
  root.disableBusinessPlugin = id => pluginAction(id, 'disable');
  root.openBusinessPluginSettings = openSettings;
  root.saveBusinessPluginSettings = saveSettings;
  root.bootstrapOmniPluginPlatform = bootstrap;
  root.addEventListener?.('businessprofilechange', bootstrap);
  root.addEventListener?.('omnipluginchange', () => {
    renderMarketplace();
    renderReports();
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
