/* ================= OmniStore Workspace JS Foundation =================
   Shared i18n, navigation, theme, and role-gating for OmniStore workspaces.
   Incorporates Gentelella v4.2.2 (MIT, Colorlib) shell-config pattern:
   host-supplied JSON island <script type="application/json" id="omni-workspace-config">
   for links/logout/notifications, falling back to page defaults.
   Source: https://github.com/ColorlibHQ/gentelella (tag v4.2.2)
   License: MIT (see omnistore-workspace.css for full notice).
   Scoped to [data-omni-workspace]. Static JS only. No framework.
   ================= */

(function () {
  'use strict';

  // ---- Shell config (Gentelella pattern: host-supplied JSON island) ----
  let _shellConfigCache = null;
  function shellConfig() {
    if (_shellConfigCache !== null) return _shellConfigCache;
    _shellConfigCache = {};
    const el = document.getElementById('omni-workspace-config');
    if (el) {
      try {
        const parsed = JSON.parse(el.textContent || '{}');
        if (parsed && typeof parsed === 'object') _shellConfigCache = parsed;
      } catch { /* malformed JSON island → empty config */ }
    }
    return _shellConfigCache;
  }
  function shellLink(name, fallback) {
    const links = shellConfig().links;
    const value = links && links[name];
    return typeof value === 'string' && value ? value : fallback;
  }
  function shellList(name) {
    const value = shellConfig()[name];
    return Array.isArray(value) ? value : null;
  }
  function signOut(fallback) {
    const url = shellLink('logout', '');
    if (!url) { window.location.href = fallback; return; }
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url;
    form.style.display = 'none';
    const token = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content');
    if (token) {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = '_token'; input.value = token;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  }

  // ---- i18n dictionary (shared across workspaces) ----
  const DICT = {
    ar: {
      app_name: 'متجر omni',
      master: 'مركز تحكم المنصة',
      owner: 'مساحة مالك المتجر',
      employee: 'مساحة الموظف',
      nav_dashboard: 'لوحة القيادة',
      nav_companies: 'الشركات',
      nav_users: 'المستخدمون',
      nav_licenses: 'التراخيص',
      nav_integrations: 'التكاملات',
      nav_audit: 'التدقيق',
      nav_platform: 'المنصة',
      nav_overview: 'نظرة عامة',
      nav_sales: 'المبيعات',
      nav_inventory: 'المخزون',
      nav_customers: 'العملاء',
      nav_suppliers: 'الموردين',
      nav_treasury: 'الخزينة',
      nav_tasks: 'المهام',
      nav_profile: 'الملف الشخصي',
      nav_settings: 'الإعدادات',
      lang_ar: 'العربية',
      lang_en: 'English',
      theme_dark: 'الوضع الليلي',
      theme_light: 'الوضع النهاري',
      btn_toggle_sidebar: 'إظهار/إخفاء القائمة الجانبية',
      master_overview: 'نظرة عامة على المنصة',
      master_companies_total: 'إجمالي الشركات',
      master_companies_active: 'الشركات النشطة',
      master_users_total: 'إجمالي المستخدمين',
      master_users_online: 'المتصلون الآن',
      master_platform_health: 'صحة المنصة',
      master_platform_status: 'حالة المنصة',
      master_recent_activity: 'الأنشطة الحديثة',
      master_no_activity: 'لا توجد أنشطة حديثة',
      master_platform_operational: 'المنصة تعمل بشكل طبيعي',
      owner_overview: 'نظرة عامة على العمل',
      owner_business_status: 'حالة العمل',
      owner_business_active: 'العمل نشط',
      owner_kpi_sales: 'إجمالي المبيعات',
      owner_kpi_inventory: 'عناصر المخزون',
      owner_kpi_customers: 'العملاء',
      owner_kpi_suppliers: 'الموردين',
      owner_kpi_treasury: 'رصيد الخزينة',
      owner_kpi_unavailable: 'غير متاح',
      owner_no_data: 'لا توجد بيانات متاحة',
      owner_recent_activity: 'الأنشطة التجارية الحديثة',
      owner_no_recent_activity: 'لا توجد أنشطة تجارية حديثة',
      employee_overview: 'مساحة العمل',
      employee_welcome: 'أهلاً بك في مساحة عملك',
      employee_quick_actions: 'إجراءات سريعة',
      employee_view_profile: 'عرض الملف الشخصي',
      employee_view_profile_desc: 'عرض معلومات ملفك الشخصي',
      empty_state: 'حالة فارغة',
      nav_employee_quick_actions: 'إجراءات سريعة',
      nav_employee_profile: 'الملف الشخصي',
      ctx_role: 'الدور',
      ctx_role_value: '—',
      ctx_server_verified: 'موثقة من الخادم',
      employee_welcome_desc: 'يمكنك استخدام الروابط أدناه للوصول إلى مهامك اليومية.',
      employee_quick_sales: 'الفواتير',
      employee_quick_sales_desc: 'عرض وإدارة فواتير المبيعات',
      employee_quick_customers: 'العملاء',
      employee_quick_customers_desc: 'عرض وإدارة بيانات العملاء',
      employee_quick_inventory: 'المخزون',
      employee_quick_inventory_desc: 'عرض وإدارة أصناف المخزون',
      employee_quick_products: 'المنتجات',
      employee_quick_products_desc: 'عرض وإدارة بيانات المنتجات',
      employee_no_actions_title: 'لا توجد إجراءات متاحة لدورك',
      employee_no_actions_desc: 'دورك الحالي لا يشمل إجراءات سريعة مخصصة في هذه المساحة.'
    },
    en: {
      app_name: 'OmniStore',
      master: 'Platform Control Center',
      owner: 'Tenant Owner Workspace',
      employee: 'Employee Workspace',
      nav_dashboard: 'Dashboard',
      nav_companies: 'Companies',
      nav_users: 'Users',
      nav_licenses: 'Licenses',
      nav_integrations: 'Integrations',
      nav_audit: 'Audit',
      nav_platform: 'Platform',
      nav_overview: 'Overview',
      nav_sales: 'Sales',
      nav_inventory: 'Inventory',
      nav_customers: 'Customers',
      nav_suppliers: 'Suppliers',
      nav_treasury: 'Treasury',
      nav_tasks: 'Tasks',
      nav_profile: 'Profile',
      nav_settings: 'Settings',
      lang_ar: 'العربية',
      lang_en: 'English',
      theme_dark: 'Dark mode',
      theme_light: 'Light mode',
      btn_toggle_sidebar: 'Toggle sidebar',
      master_overview: 'Platform overview',
      master_companies_total: 'Total companies',
      master_companies_active: 'Active companies',
      master_users_total: 'Total users',
      master_users_online: 'Online now',
      master_platform_health: 'Platform health',
      master_platform_status: 'Platform status',
      master_recent_activity: 'Recent activity',
      master_no_activity: 'No recent activity',
      master_platform_operational: 'Platform is operational',
      owner_overview: 'Business overview',
      owner_business_status: 'Business status',
      owner_business_active: 'Business active',
      owner_kpi_sales: 'Total sales',
      owner_kpi_inventory: 'Inventory items',
      owner_kpi_customers: 'Customers',
      owner_kpi_suppliers: 'Suppliers',
      owner_kpi_treasury: 'Treasury balance',
      owner_kpi_unavailable: 'Unavailable',
      owner_no_data: 'No data available',
      owner_recent_activity: 'Recent business activity',
      owner_no_recent_activity: 'No recent business activity',
      employee_overview: 'Workspace',
      employee_welcome: 'Welcome to your workspace',
      employee_quick_actions: 'Quick actions',
      employee_view_profile: 'View profile',
      employee_view_profile_desc: 'View your profile information',
      empty_state: 'Empty state',
      nav_employee_quick_actions: 'Quick Actions',
      nav_employee_profile: 'Profile',
      ctx_role: 'Role',
      ctx_role_value: '—',
      ctx_server_verified: 'Server-verified',
      employee_welcome_desc: 'Use the links below to manage your daily tasks.',
      employee_quick_sales: 'Sales',
      employee_quick_sales_desc: 'View and manage sales invoices',
      employee_quick_customers: 'Customers',
      employee_quick_customers_desc: 'View and manage customer data',
      employee_quick_inventory: 'Inventory',
      employee_quick_inventory_desc: 'View and manage stock items',
      employee_quick_products: 'Products',
      employee_quick_products_desc: 'View and manage product data',
      employee_no_actions_title: 'No actions available for your role',
      employee_no_actions_desc: 'Your role does not include quick actions in this workspace.'
    }
  };

  // ---- Role → workspace mapping (real roles from registry only) ----
  // Owner → tenant-owner.html (existing)
  // Admin → tenant-admin.html (existing)
  // Cashier → employee-workspace.html (new, task-oriented)
  // Technician → employee-workspace.html (new, task-oriented)
  // All other roles → existing index.html behavior
  const ROLE_WORKSPACE = {
    Owner: '/tenant-owner.html',
    Admin: '/tenant-admin.html',
    Cashier: '/employee-workspace.html',
    Technician: '/employee-workspace.html'
  };

  // Roles permitted in the Employee Workspace (verified against registry)
  const EMPLOYEE_ROLES = ['Cashier', 'Technician'];

  // ---- State ----
  const state = {
    lang: 'ar',
    dark: false,
    sidebarOpen: false,
    role: null
  };

  // ---- DOM helpers ----
  function $scope(root) {
    return {
      q: (sel) => root.querySelector(sel),
      qa: (sel) => root.querySelectorAll(sel)
    };
  }

  function t(key, langOverride) {
    const lang = langOverride || state.lang;
    return (DICT[lang] && DICT[lang][key]) || key;
  }

  function setLang(root, lang) {
    state.lang = lang;
    const html = document.documentElement;
    if (html) {
      html.lang = lang;
      html.dir = lang === 'ar' ? 'rtl' : 'ltr';
    }
    root.setAttribute('lang', lang);
    root.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    const { qa } = $scope(root);
    qa('[data-i18n]').forEach(function (el) {
      const key = el.getAttribute('data-i18n');
      if (DICT[lang] && DICT[lang][key]) el.textContent = DICT[lang][key];
    });
    qa('[data-i18n-placeholder]').forEach(function (el) {
      const key = el.getAttribute('data-i18n-placeholder');
      if (DICT[lang] && DICT[lang][key]) el.placeholder = DICT[lang][key];
    });
    updateLangButtons(root);
  }

  function updateLangButtons(root) {
    const { qa } = $scope(root);
    qa('.os-lang-btn').forEach(function (btn) {
      btn.classList.toggle('os-active', btn.dataset.lang === state.lang);
    });
  }

  function toggleDark(root) {
    state.dark = !state.dark;
    const html = document.documentElement;
    if (html) html.classList.toggle('os-dark', state.dark);
    root.classList.toggle('os-dark', state.dark);
    try { localStorage.setItem('omni_workspace_theme', state.dark ? 'dark' : 'light'); } catch (e) {}
  }

  function toggleSidebar(root) {
    state.sidebarOpen = !state.sidebarOpen;
    const sidebar = root.querySelector('.os-sidebar');
    const overlay = root.querySelector('.os-sidebar-overlay');
    if (sidebar) sidebar.classList.toggle('os-open', state.sidebarOpen);
    if (overlay) overlay.classList.toggle('os-open', state.sidebarOpen);
  }

  function closeSidebar(root) {
    state.sidebarOpen = false;
    const sidebar = root.querySelector('.os-sidebar');
    const overlay = root.querySelector('.os-sidebar-overlay');
    if (sidebar) sidebar.classList.remove('os-open');
    if (overlay) overlay.classList.remove('os-open');
  }

  function setRole(role) {
    state.role = role;
    const root = document.querySelector('[data-omni-workspace]');
    if (!root) return;
    const { qa } = $scope(root);
    qa('[data-role]').forEach(function (el) {
      const roles = el.getAttribute('data-role').split(' ');
      el.style.display = roles.includes(role) ? '' : 'none';
    });
  }

  function workspaceForRole(role) {
    return ROLE_WORKSPACE[role] || null;
  }

  function isEmployeeRole(role) {
    return EMPLOYEE_ROLES.includes(role);
  }

  // ---- Init ----
  function init(root) {
    if (!root) return;

    // Restore theme
    try {
      const savedTheme = localStorage.getItem('omni_workspace_theme');
      if (savedTheme === 'dark') toggleDark(root);
    } catch (e) {}

    // Restore lang
    try {
      const savedLang = localStorage.getItem('omni_workspace_lang');
      if (savedLang) setLang(root, savedLang);
      else setLang(root, 'ar');
    } catch (e) {
      setLang(root, 'ar');
    }

    // Language toggle buttons
    const { qa } = $scope(root);
    qa('.os-lang-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const lang = this.dataset.lang;
        setLang(root, lang);
        try { localStorage.setItem('omni_workspace_lang', lang); } catch (e) {}
      });
    });

    // Theme toggle
    const themeBtn = root.querySelector('.os-theme-toggle');
    if (themeBtn) themeBtn.addEventListener('click', function () { toggleDark(root); });

    // Sidebar toggle
    const sidebarBtn = root.querySelector('.os-mobile-menu-btn');
    if (sidebarBtn) sidebarBtn.addEventListener('click', function () { toggleSidebar(root); });

    const overlay = root.querySelector('.os-sidebar-overlay');
    if (overlay) overlay.addEventListener('click', function () { closeSidebar(root); });

    const navCollapse = root.querySelector('.os-nav-collapse');
    if (navCollapse) navCollapse.addEventListener('click', function () {
      const sidebar = root.querySelector('.os-sidebar');
      if (sidebar) sidebar.classList.toggle('os-collapsed');
    });

    // Nav link active state
    qa('.os-nav-link').forEach(function (link) {
      link.addEventListener('click', function () {
        qa('.os-nav-link').forEach(function (l) { l.classList.remove('is-active'); });
        this.classList.add('is-active');
        closeSidebar(root);
      });
    });

    // Role-based visibility
    setRole(state.role || 'employee');

    // Close sidebar on resize to desktop
    window.addEventListener('resize', function () {
      if (window.innerWidth > 1024) {
        const sidebar = root.querySelector('.os-sidebar');
        const overlay = root.querySelector('.os-sidebar-overlay');
        if (sidebar) sidebar.classList.remove('os-open');
        if (overlay) overlay.classList.remove('os-open');
        state.sidebarOpen = false;
      }
    });
  }

  // Escape helper
  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Expose
  window.omniWorkspace = {
    t, setLang, toggleDark, toggleSidebar, closeSidebar, setRole, init,
    esc, workspaceForRole, isEmployeeRole, state
  };

  // Auto-init on the nearest [data-omni-workspace] root
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      const root = document.querySelector('[data-omni-workspace]');
      if (root) init(root);
    });
  } else {
    const root = document.querySelector('[data-omni-workspace]');
    if (root) init(root);
  }
})();
