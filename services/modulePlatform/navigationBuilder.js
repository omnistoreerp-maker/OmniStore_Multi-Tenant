(function (root) {
  'use strict';

  // Phase 34.1 — navigation architecture.
  // Every group declares a scope: 'tenant' (company), 'master' (platform),
  // or 'internal' (developer/diagnostics, hidden from normal business nav).
  // Group ids are the dropdown element suffix (dropdown-<id>) and the toggle
  // token used by toggleNavDropdown('<id>', ...). The original nine group ids
  // (main, sales, inventory, reports, customers, admin, maintenance, analytics,
  // employees) are preserved verbatim so module/plugin contracts stay intact.
  const groups = {
    main: { title: '📊 الرئيسية', icon: '📊', scope: 'tenant' },
    sales: { title: '🛒 الفواتير والمبيعات', icon: '🛒', scope: 'tenant' },
    purchases: { title: '🛍️ المشتريات', icon: '🛍️', scope: 'tenant' },
    inventory: { title: '📦 المخزون', icon: '📦', scope: 'tenant' },
    reports: { title: '📈 التقارير والمالية', icon: '📈', scope: 'tenant' },
    customers: { title: '👥 العملاء والموردون', icon: '👥', scope: 'tenant' },
    admin: { title: '⚙️ الإدارة والنظام', icon: '⚙️', scope: 'tenant' },
    maintenance: { title: '🔧 الصيانة والضمان', icon: '🔧', scope: 'tenant' },
    analytics: { title: '💡 التحليلات', icon: '💡', scope: 'tenant' },
    employees: { title: '👨‍💼 الموظفون', icon: '👨‍💼', scope: 'tenant' },
    treasury: { title: '🏦 الخزنة', icon: '🏦', scope: 'tenant' },
    installments: { title: '📆 التقسيط', icon: '📆', scope: 'tenant' },
    marketplace: { title: '🏪 المتجر والإضافات', icon: '🏪', scope: 'tenant' },
    entertainment: { title: '🎮 خدمات إضافية', icon: '🎮', scope: 'tenant' },
    internal: { title: '🧪 مركز المطورين والاختبار', icon: '🧪', scope: 'internal' },
    master_home: { title: '🛰️ لوحة تحكم المنصة', icon: '🛰️', scope: 'master' },
    master_companies: { title: '🏢 الشركات', icon: '🏢', scope: 'master' },
    master_users: { title: '🔐 المستخدمون والجلسات', icon: '🔐', scope: 'master' },
    master_licenses: { title: '🔑 التراخيص والاشتراكات', icon: '🔑', scope: 'master' },
    master_integrations: { title: '🔌 التكاملات', icon: '🔌', scope: 'master' },
    master_database: { title: '🗄️ قاعدة البيانات', icon: '🗄️', scope: 'master' },
    master_backups: { title: '💾 النسخ الاحتياطي والاستعادة', icon: '💾', scope: 'master' },
    master_audit: { title: '🛡️ الأمان والتدقيق', icon: '🛡️', scope: 'master' },
    master_platform: { title: '👑 منصة OmniStore', icon: '👑', scope: 'master' }
  };

  const item = (route, name, icon, group, scope) => ({ route, name, icon, group, scope });

  // Platform-scope navigation (rendered only when platformRole && USE_BACKEND).
  const MASTER_NAV = [
    item('platform-master', 'مركز تحكم OmniStore', '👑', 'master_home', 'master'),
    item('platform-dashboard', 'لوحة تحكم المنصة', '🛰️', 'master_home', 'master'),
    item('monitoring-center', 'مركز المراقبة', '📡', 'master_home', 'master'),
    item('self-platform-customers', 'إدارة الشركات', '🏢', 'master_companies', 'master'),
    item('saas-all-customers', 'كل عملاء المنصة', '🏢', 'master_companies', 'master'),
    item('current-customers', 'العملاء الحاليون', '📍', 'master_companies', 'master'),
    item('customer-details', 'تفاصيل العميل', '🪪', 'master_companies', 'master'),
    item('customer-status', 'حالة العميل', '📡', 'master_companies', 'master'),
    item('workspace-health', 'صحة مساحة العمل', '💚', 'master_companies', 'master'),
    item('customer-health', 'صحة العميل', '🩺', 'master_companies', 'master'),
    item('customer-provisioning', 'إنشاء عميل', '🏗️', 'master_companies', 'master'),
    item('customer-provision-report', 'تقرير التجهيز', '📄', 'master_companies', 'master'),
    item('provision-history', 'سجل التجهيز', '🕘', 'master_companies', 'master'),
    item('provision-rollback', 'تراجع التجهيز', '🗑️', 'master_companies', 'master'),
    item('workspace-audit', 'تدقيق مساحة العمل', '🔍', 'master_companies', 'master'),
    item('customer-provisioning-preview', 'معاينة التجهيز', '🧰', 'master_companies', 'master'),
    item('auth-preview-users', 'المستخدمون', '👤', 'master_users', 'master'),
    item('license-center', 'مركز التراخيص', '🔑', 'master_licenses', 'master'),
    item('license-audit', 'تدقيق التراخيص', '🧾', 'master_licenses', 'master'),
    item('subscription-plans', 'خطط الاشتراك', '📦', 'master_licenses', 'master'),
    item('subscription-dashboard', 'لوحة الاشتراكات', '📊', 'master_licenses', 'master'),
    item('customer-statistics', 'إحصائيات العملاء', '📈', 'master_licenses', 'master'),
    item('revenue-preview', 'معاينة الإيرادات', '💵', 'master_licenses', 'master'),
    item('self-platform-subscriptions', 'اشتراكات المنصة', '📦', 'master_licenses', 'master'),
    item('self-platform-licenses', 'تراخيص المنصة', '🔑', 'master_licenses', 'master'),
    item('supabase-diagnostic', 'Supabase Diagnostic', '☁️', 'master_integrations', 'master'),
    item('supabase-health', 'Supabase Health', '🩺', 'master_integrations', 'master'),
    item('supabase-setup-preview', 'معاينة إعداد Supabase', '🧱', 'master_integrations', 'master'),
    item('schema-installer-preview', 'معاينة تثبيت المخطط', '📐', 'master_integrations', 'master'),
    item('rls-preview', 'معاينة RLS', '🛡️', 'master_integrations', 'master'),
    item('edge-function-setup-plan', 'خطة Edge Functions', '⚡', 'master_integrations', 'master'),
    item('database-installer', 'Database Installer', '🗄️', 'master_database', 'master'),
    item('migration-progress', 'تقدم الترحيل', '⏳', 'master_database', 'master'),
    item('installation-report', 'تقرير التثبيت', '📄', 'master_database', 'master'),
    item('verification-report', 'تقرير التحقق', '✅', 'master_database', 'master'),
    item('backup-center', 'مركز النسخ الاحتياطي', '💾', 'master_backups', 'master'),
    item('self-platform-backups', 'نسخ احتياطي للمنصة', '💾', 'master_backups', 'master'),
    item('recovery-platform-center', 'مركز الاستعادة', '🛟', 'master_backups', 'master'),
    item('recovery-platform-backups', 'نسخ الاستعادة', '💾', 'master_backups', 'master'),
    item('recovery-platform-restore-wizard', 'معالج الاستعادة', '🧙', 'master_backups', 'master'),
    item('recovery-platform-snapshot-browser', 'مستعرض اللقطات', '📸', 'master_backups', 'master'),
    item('recovery-platform-update-center', 'مركز تحديث الاستعادة', '⬆️', 'master_backups', 'master'),
    item('recovery-platform-installed-versions', 'الإصدارات المثبتة', '🏷️', 'master_backups', 'master'),
    item('recovery-platform-rollback-history', 'سجل التراجع', '↩️', 'master_backups', 'master'),
    item('recovery-platform-recovery-health', 'صحة الاستعادة', '🩺', 'master_backups', 'master'),
    item('recovery-platform-recovery-audit', 'تدقيق الاستعادة', '🧾', 'master_backups', 'master'),
    item('audit-dashboard', 'لوحة التدقيق', '🧾', 'master_audit', 'master'),
    item('security-dashboard', 'لوحة الأمان', '🔐', 'master_audit', 'master'),
    item('security-scan', 'فحص الأمان', '🔎', 'master_audit', 'master'),
    item('vulnerability-report', 'تقرير الثغرات', '🛡️', 'master_audit', 'master'),
    item('production-security-checklist', 'قائمة الأمان للإنتاج', '✅', 'master_audit', 'master'),
    item('self-platform-audit-logs', 'سجلات تدقيق المنصة', '🧾', 'master_audit', 'master'),
    item('self-platform-dashboard', 'لوحة المنصة', '👑', 'master_platform', 'master'),
    item('self-platform-deployments', 'نشرات المنصة', '🚀', 'master_platform', 'master'),
    item('self-platform-updates', 'تحديثات المنصة', '⬆️', 'master_platform', 'master'),
    item('self-platform-monitoring', 'مراقبة المنصة', '📡', 'master_platform', 'master'),
    item('self-platform-system-health', 'صحة المنصة', '🩺', 'master_platform', 'master'),
    item('self-platform-notifications', 'إشعارات المنصة', '🔔', 'master_platform', 'master'),
    item('self-platform-jobs-queue', 'طابور المهام', '📋', 'master_platform', 'master'),
    item('self-platform-workers', 'العمال', '⚙️', 'master_platform', 'master'),
    item('self-platform-storage-usage', 'استخدام التخزين', '🗄️', 'master_platform', 'master'),
    item('self-platform-database-usage', 'استخدام قاعدة البيانات', '🗃️', 'master_platform', 'master'),
    item('self-platform-api-usage', 'استخدام API', '🌐', 'master_platform', 'master'),
    item('self-platform-edge-functions', 'Edge Functions', '⚡', 'master_platform', 'master'),
    item('self-platform-automation', 'أتمتة المنصة', '🤖', 'master_platform', 'master'),
    item('self-platform-reports', 'تقارير المنصة', '📊', 'master_platform', 'master'),
    item('update-center', 'مركز التحديث', '⬆️', 'master_platform', 'master'),
    item('error-dashboard', 'لوحة الأخطاء', '🚨', 'master_platform', 'master'),
    item('saas-admin-center', 'مركز إدارة SaaS', '👑', 'master_platform', 'master'),
    item('saas-customer-details', 'تفاصيل عميل SaaS', '🪪', 'master_platform', 'master'),
    item('saas-customer-status', 'حالة عميل SaaS', '🎛️', 'master_platform', 'master'),
    item('saas-billing-preview', 'معاينة الفوترة', '🧪', 'master_platform', 'master'),
    item('saas-notifications', 'إشعارات SaaS', '🔔', 'master_platform', 'master'),
    item('workspace-usage', 'استخدام مساحة العمل', '💾', 'master_platform', 'master'),
    item('production-execution-execution-center', 'مركز التنفيذ', '🔴', 'master_platform', 'master'),
    item('production-execution-execution-queue', 'طابور التنفيذ', '📋', 'master_platform', 'master'),
    item('production-execution-execution-history', 'سجل التنفيذ', '🕘', 'master_platform', 'master'),
    item('production-execution-pending-operations', 'عمليات معلقة', '⏳', 'master_platform', 'master'),
    item('production-execution-rollback-manager', 'مدير التراجع', '↩️', 'master_platform', 'master'),
    item('production-execution-verification-center', 'مركز التحقق', '✅', 'master_platform', 'master')
  ];

  // Developer / diagnostics navigation. Hidden from business nav; kept
  // reachable via direct showPage(). Visible only for manageUsers holders.
  const INTERNAL_NAV = [
    item('go-live-center', 'Go Live Center', '🚀', 'internal', 'internal'),
    item('go-live-production-mode', 'Production Mode', '🔐', 'internal', 'internal'),
    item('go-live-supabase-connection', 'Supabase Connection', '🔌', 'internal', 'internal'),
    item('go-live-database-installer', 'Database Installer', '🗄️', 'internal', 'internal'),
    item('go-live-customer-001', 'Customer #001 Mario Fely', '🏪', 'internal', 'internal'),
    item('go-live-production-verification', 'Production Verification', '✅', 'internal', 'internal'),
    item('go-live-release-v1', 'Release v1.0', '🏷️', 'internal', 'internal'),
    item('go-live-deployment-runbook', 'Deployment Runbook', '📘', 'internal', 'internal'),
    item('go-live-rollback-center', 'Rollback Center', '↩️', 'internal', 'internal'),
    item('erp-preview-center', 'مركز معاينة العمليات', '🧪', 'internal', 'internal'),
    item('posting-readiness-center', 'فحص جاهزية الترحيل', '🛡️', 'internal', 'internal'),
    item('production-readiness', 'جاهزية العرض والتشغيل', '🚦', 'internal', 'internal'),
    item('customer-acceptance', 'تجربة وقبول العميل', '🤝', 'internal', 'internal'),
    item('system-health-uat', 'حالة النظام', '🩺', 'internal', 'internal'),
    item('deployment-checklist', 'قائمة مراجعة التشغيل', '🚀', 'internal', 'internal'),
    item('customer-feedback', 'ملاحظات العميل', '💬', 'internal', 'internal'),
    item('uat-issues', 'مشكلات تجربة القبول', '🐞', 'internal', 'internal'),
    item('demo-notes', 'ملاحظات العرض', '📝', 'internal', 'internal'),
    item('client-requests', 'طلبات العميل', '💡', 'internal', 'internal'),
    item('client-demo-package', 'حزمة عرض العميل', '📦', 'internal', 'internal'),
    item('training-checklist', 'قائمة تدريب العميل', '🎓', 'internal', 'internal'),
    item('demo-scenarios', 'سيناريوهات العرض', '🎬', 'internal', 'internal'),
    item('client-signoff', 'اعتماد العميل', '✍️', 'internal', 'internal'),
    item('known-limitations', 'حدود النسخة الحالية', '⚠️', 'internal', 'internal'),
    item('master-release-snapshot', 'لقطة إصدار Master', '🏷️', 'internal', 'internal'),
    item('customer-copy-checklist', 'قائمة تجهيز نسخة عميل', '📋', 'internal', 'internal'),
    item('new-customer-setup-guide', 'دليل إعداد عميل جديد', '🧭', 'internal', 'internal'),
    item('release-health', 'صحة الإصدار', '💚', 'internal', 'internal'),
    item('configuration-center', 'Configuration Center', '⚙️', 'internal', 'internal'),
    item('config-business-profile', 'Business Profile', '🏢', 'internal', 'internal'),
    item('config-pos', 'POS Configuration', '🧾', 'internal', 'internal'),
    item('config-inventory', 'Inventory Configuration', '📦', 'internal', 'internal'),
    item('config-accounting', 'Accounting Configuration Preview', '🧮', 'internal', 'internal'),
    item('config-print', 'Print Configuration', '🖨️', 'internal', 'internal'),
    item('config-theme', 'Theme Configuration', '🎨', 'internal', 'internal'),
    item('config-security', 'Security Configuration', '🔐', 'internal', 'internal'),
    item('config-backup', 'Backup Configuration', '🗄️', 'internal', 'internal'),
    item('config-export', 'Export Configuration', '⬇️', 'internal', 'internal'),
    item('config-import', 'Import Configuration', '⬆️', 'internal', 'internal'),
    item('authentication-center', 'Authentication Center', '🛡️', 'internal', 'internal'),
    item('auth-preview-roles', 'Roles Preview', '🎭', 'internal', 'internal'),
    item('auth-preview-permissions', 'Permissions Preview', '🔑', 'internal', 'internal'),
    item('auth-login-preview', 'Login Preview', '🚪', 'internal', 'internal'),
    item('auth-session-preview', 'Session Preview', '⏳', 'internal', 'internal'),
    item('auth-security-audit', 'Security Audit Preview', '🔍', 'internal', 'internal'),
    item('auth-permission-matrix', 'Permission Matrix', '🧩', 'internal', 'internal'),
    item('tenant-center', 'Tenant Center', '🏢', 'internal', 'internal'),
    item('current-workspace', 'Current Workspace', '📍', 'internal', 'internal'),
    item('workspace-preview', 'Workspace Preview', '🔁', 'internal', 'internal'),
    item('multi-tenant-health', 'Multi-Tenant Health', '💚', 'internal', 'internal'),
    item('deployment-center', 'Deployment Center', '🚀', 'internal', 'internal'),
    item('customer-deployment-wizard', 'Customer Deployment Wizard', '🧙', 'internal', 'internal'),
    item('deployment-status', 'Deployment Status', '📡', 'internal', 'internal'),
    item('deployment-logs', 'Deployment Logs', '📋', 'internal', 'internal'),
    item('deployment-rollback', 'Deployment Rollback', '↩️', 'internal', 'internal'),
    item('deployment-health', 'Deployment Health', '💚', 'internal', 'internal'),
    item('release-readiness', 'Release Readiness', '🚀', 'internal', 'internal'),
    item('performance-scale-dashboard', 'Performance Dashboard', '⚡', 'internal', 'internal'),
    item('performance-scale-memory-usage', 'Memory Usage', '🧠', 'internal', 'internal'),
    item('performance-scale-cpu-usage', 'CPU Usage Preview', '🖥️', 'internal', 'internal'),
    item('performance-scale-storage-analyzer', 'Storage Analyzer', '💾', 'internal', 'internal'),
    item('performance-scale-large-dataset-analyzer', 'Large Dataset Analyzer', '📚', 'internal', 'internal'),
    item('performance-scale-query-performance', 'Query Performance Preview', '🔎', 'internal', 'internal'),
    item('performance-scale-realtime-status', 'Realtime Status', '🔄', 'internal', 'internal'),
    item('performance-scale-cache-status', 'Cache Status', '🗂️', 'internal', 'internal'),
    item('performance-scale-network-status', 'Network Status', '🌐', 'internal', 'internal'),
    item('performance-scale-lazy-loading-status', 'Lazy Loading Status', '⏳', 'internal', 'internal'),
    item('performance-engine', 'محرك الأداء', '⚡', 'internal', 'internal'),
    item('qa-center', 'مركز الجودة', '✅', 'internal', 'internal'),
    item('training-center', 'مركز التدريب', '🎓', 'internal', 'internal'),
    item('command-center', 'مركز القيادة', '🛰️', 'internal', 'internal'),
    item('opshub', 'مركز التحكم', '🧠', 'internal', 'internal'),
    item('production', 'Production Checklist', '✅', 'internal', 'internal')
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function canShow(route) {
    if (typeof root.canAccessPage !== 'function') return true;
    try { return root.canAccessPage(route); } catch (e) { return true; }
  }

  function isPlatformMaster() {
    if (typeof root.isPlatformMaster === 'function') return root.isPlatformMaster();
    return !!(root.platformRole && root.USE_BACKEND);
  }

  function scopeVisible(item) {
    const scope = item.scope || 'tenant';
    if (scope === 'tenant') return true;
    if (scope === 'master') return isPlatformMaster();
    if (scope === 'internal') return typeof root.can === 'function' && !!root.can('manageUsers');
    return false;
  }

  function renderItem(item) {
    const scopeAttr = item.scope && item.scope !== 'tenant' ? ` data-nav-scope="${escapeHtml(item.scope)}"` : '';
    const masterId = item.route === 'platform-master' ? ' id="platformMasterNav"' : '';
    return `<div class="nav-dropdown-item" data-page="${escapeHtml(item.route)}" data-module-id="${escapeHtml(item.moduleId || '')}"${masterId}${scopeAttr} onclick="showPage('${escapeHtml(item.route)}');closeAllNavDropdowns()"><span class="icon">${escapeHtml(item.icon)}</span> ${escapeHtml(item.name)}</div>`;
  }

  function build() {
    const loader = root.OmniModuleLoader;
    if (!loader || !root.document) return {};
    const enabled = loader.getActiveModules();
    const pluginNavigation = root.OmniPluginSDK?.getActivePlugins?.().flatMap(plugin =>
      (plugin.navigation || []).map(item => ({ ...item, moduleId: `plugin:${plugin.metadata.id}` }))
    ) || [];
    const catalog = MASTER_NAV.concat(INTERNAL_NAV);
    const result = {};
    Object.entries(groups).forEach(([groupId, meta]) => {
      const dropdown = root.document.getElementById(`dropdown-${groupId}`);
      if (!dropdown) return;
      const moduleRoutes = enabled.flatMap(module =>
        (module.navigation || []).filter(item => item.group === groupId && canShow(item.route) && scopeVisible(item))
          .map(item => ({ ...item, moduleId: module.id }))
      );
      const pluginItems = pluginNavigation.filter(item => item.group === groupId && canShow(item.route) && scopeVisible(item))
        .map(item => ({
          ...item,
          name: root.OmniPluginSDK.translate(item.moduleId.replace('plugin:', ''), item.labelKey || item.name || 'settings')
        }));
      const catalogItems = catalog.filter(item => item.group === groupId && canShow(item.route) && scopeVisible(item));
      const combined = [...moduleRoutes, ...pluginItems, ...catalogItems];
      const routes = combined.filter((row, index, rows) => rows.findIndex(r => r.route === row.route) === index);
      dropdown.innerHTML = `<div class="nav-dropdown-header">${meta.title}</div>` + routes.map(renderItem).join('');
      if (dropdown.dataset) dropdown.dataset.navScope = meta.scope;
      const button = root.document.querySelector(`.nav-icon-btn[onclick*="'${groupId}'"]`);
      if (button) button.style.display = routes.length ? '' : 'none';
      result[groupId] = routes.map(row => row.route);
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

  root.OmniNavigationBuilder = Object.freeze({
    build,
    groups: Object.keys(groups),
    MASTER_NAV,
    INTERNAL_NAV,
    isPlatformMaster
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
