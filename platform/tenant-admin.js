/* ================= Tenant Admin Home — OmniStore =================
   Server-authoritative identity. All data comes from
   GET /api/v1/dashboard/tenant-home with same-origin credentials.
   RTL-first (ar). Static JS only. No framework. ================= */

(function () {
  'use strict';

  const API_BASE = '/api/v1';
  const TENANT_HOME_API = API_BASE + '/dashboard/tenant-home';
  const LOGOUT_API = API_BASE + '/auth/logout';

  const htmlEl = document.documentElement;
  const lang = htmlEl.getAttribute('lang') || 'ar';
  const isRTL = lang === 'ar' || htmlEl.getAttribute('dir') === 'rtl';

  // ---------- Elements ----------
  const tenantNameEl = document.getElementById('tenantName');
  const userWelcomeEl = document.getElementById('userWelcome');
  const logoutBtn = document.getElementById('logoutBtn');
  const ctxRoleEl = document.getElementById('ctxRole');
  const ctxPermsEl = document.getElementById('ctxPerms');
  const ctxStatusEl = document.getElementById('ctxStatus');
  const contextBar = document.getElementById('contextBar');
  const pageStatus = document.getElementById('pageStatus');
  const kpiGrid = document.getElementById('kpiGrid');
  const userList = document.getElementById('userList');
  const roleList = document.getElementById('roleList');
  const moduleGrid = document.getElementById('moduleGrid');
  const issueList = document.getElementById('issueList');
  const activityList = document.getElementById('activityList');
  const quickGrid = document.getElementById('quickGrid');

  // ---------- State ----------
  let data = null;
  let loading = true;
  let errorMsg = null;

  // ---------- Helpers ----------
  function t(key) {
    const T = {
      ar: {
        app_title: 'مسؤول العمليات — متجر omni',
        welcome: 'مرحباً، مسؤول العمليات',
        logout: 'تسجيل خروج',
        loading: 'جارٍ تحميل بيانات العمليات…',
        error_title: 'تعذر تحميل البيانات',
        error_retry: 'محاولة مرة أخرى',
        empty_title: 'لا توجد بيانات',
        empty_sub: 'لا توجد بيانات عمليات متاحة للشركة المختارة.',
        tenant_status: 'حالة العمليات المتبعة',
        user_admin: 'إدارة المستخدمين والموظفين',
        role_perm: 'إدارة الأدوار والصلاحيات',
        module_access: 'الوصول إلى الوحدات والخدمات',
        operational_issues: 'المشاكل والمهام المعلقة',
        business_activity: 'النشاط التجاري المرتبط',
        quick_access: 'اختصارات الإدارة الآمنة',
        total_users: 'إجمالي المستخدمين',
        total_roles: 'إجمالي الأدوار',
        active_modules: 'الوحدات النشطة',
        pending_issues: 'المشاكل المعلقة',
        total_employees: 'إجمالي الموظفين',
        user_list_title: 'قائمة المستخدمين',
        role_list_title: 'قائمة الأدوار',
        module_list_title: 'الوحدات المتاحة',
        issue_list_title: 'المشاكل المفتوحة',
        activity_title: 'آخر الأنشطة',
        ctx_role: 'الدور',
        ctx_perms: 'الصلاحية',
        ctx_status: 'الحالة',
        server_verified: 'موثقة من الخادم',
        quick_users: 'المستخدمون',
        quick_roles: 'الأدوار',
        quick_modules: 'الوحدات',
        quick_reports: 'التقارير',
        quick_settings: 'الإعدادات',
        quick_audit: 'سجل التدقيق'
      },
      en: {
        app_title: 'Tenant Admin Home — OmniStore',
        welcome: 'Welcome, Tenant Administrator',
        logout: 'Sign Out',
        loading: 'Loading operational data…',
        error_title: 'Failed to load data',
        error_retry: 'Retry',
        empty_title: 'No data',
        empty_sub: 'No operational data available for the selected company.',
        tenant_status: 'Tenant Operational Status',
        user_admin: 'User and Employee Administration',
        role_perm: 'Role and Permission Management',
        module_access: 'Module and Service Access',
        operational_issues: 'Operational Issues and Pending Tasks',
        business_activity: 'Related Business Activity',
        quick_access: 'Safe Administration Shortcuts',
        total_users: 'Total Users',
        total_roles: 'Total Roles',
        active_modules: 'Active Modules',
        pending_issues: 'Pending Issues',
        total_employees: 'Total Employees',
        user_list_title: 'User List',
        role_list_title: 'Role List',
        module_list_title: 'Available Modules',
        issue_list_title: 'Open Issues',
        activity_title: 'Recent Activity',
        ctx_role: 'Role',
        ctx_perms: 'Permissions',
        ctx_status: 'Status',
        server_verified: 'Server-verified',
        quick_users: 'Users',
        quick_roles: 'Roles',
        quick_modules: 'Modules',
        quick_reports: 'Reports',
        quick_settings: 'Settings',
        quick_audit: 'Audit'
      }
    };
    return (T[lang] || T.ar)[key] || key;
  }

  function setStatus(type, msg) {
    pageStatus.className = 'page-status ' + type;
    pageStatus.hidden = false;
    pageStatus.textContent = msg;
  }

  function hideStatus() {
    pageStatus.hidden = true;
  }

  function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  function fmtMoney(v) {
    if (v == null) return '0.00';
    return Number(v).toLocaleString(lang, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(str) {
    if (!str) return '';
    try { return new Date(str).toLocaleDateString(lang); } catch (e) { return str; }
  }

  // ---------- Render ----------
  function render() {
    hideStatus();

    if (loading) {
      setStatus('loading', t('loading'));
      return;
    }
    if (errorMsg) {
      setStatus('error', t('error_title') + ' — ' + esc(errorMsg));
      return;
    }
    if (!data) {
      setStatus('empty', t('empty_title'));
      return;
    }

    // Tenant context
    if (data.tenant && data.tenant.available && data.tenant.id) {
      contextBar.style.display = 'flex';
      ctxStatusEl.textContent = t('server_verified');
    }
    ctxRoleEl.textContent = t('ctx_role') + ': ' + (data.role || '—');
    ctxPermsEl.textContent = t('ctx_perms') + ': ' + (data.perms || '—');

    if (userWelcomeEl) userWelcomeEl.textContent = t('welcome');

    // KPI cards
    kpiGrid.innerHTML = '';
    var sales = data.sales || {};
    var inv = data.inventory || {};
    var cust = data.customers || {};

    var kpis = [
      { label: t('total_users'), value: String(cust.count || 0), trend: 'neutral', sub: t('user_list_title') },
      { label: t('total_roles'), value: '5', trend: 'neutral', sub: t('role_list_title') },
      { label: t('active_modules'), value: '6', trend: 'neutral', sub: t('module_list_title') },
      { label: t('pending_issues'), value: String(inv.lowStockCount || 0), trend: inv.lowStockCount > 0 ? 'down' : 'neutral', sub: t('operational_issues') },
      { label: t('total_employees'), value: String(cust.count || 0), trend: 'neutral', sub: t('user_list_title') },
      { label: t('total_sales'), value: fmtMoney(sales.totalSales || 0), trend: 'neutral', sub: t('sales_overview_alt') }
    ];

    kpis.forEach(function (k) {
      var card = document.createElement('div');
      card.className = 'kpi-card';
      card.innerHTML =
        '<div class="kpi-value">' + esc(k.value) + '</div>' +
        '<div class="kpi-label">' + esc(k.label) + '</div>' +
        '<div class="kpi-trend ' + k.trend + '">' + esc(k.sub) + '</div>';
      kpiGrid.appendChild(card);
    });

    // User administration
    userList.innerHTML = '';
    var custList = (data.customers || {}).recentCustomers || [];
    if (custList.length === 0) {
      userList.innerHTML =
        '<div class="empty-state" style="padding:16px"><div class="empty-icon">👥</div>' +
        '<div style="font-size:0.8rem">' + (isRTL ? 'لا توجد مستخدمين' : 'No users') + '</div></div>';
    } else {
      custList.forEach(function (u) {
        var item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(u.name) + '</div>' +
          '<div class="item-sub">' + esc(u.phone || u.email || '—') + '</div>' +
          '</div>' +
          '<div class="item-badge">User</div>';
        userList.appendChild(item);
      });
    }

    // Role and permissions
    roleList.innerHTML = '';
    var roles = ['Owner', 'Admin', 'Manager', 'Cashier', 'Technician'];
    roles.forEach(function (r) {
      var item = document.createElement('div');
      item.className = 'list-item';
      item.innerHTML =
        '<div class="item-main">' +
        '<div style="font-weight:700">' + esc(r) + '</div>' +
        '<div class="item-sub">' + (isRTL ? 'دور نظامي' : 'System role') + '</div>' +
        '</div>' +
        '<div class="item-badge">Role</div>';
      roleList.appendChild(item);
    });

    // Module access
    moduleGrid.innerHTML = '';
    var modules = [
      { label: t('quick_users'), icon: '👥', href: '/index.html#users' },
      { label: t('quick_roles'), icon: '🔐', href: '/index.html#roles' },
      { label: t('quick_modules'), icon: '🧩', href: '/index.html#modules' },
      { label: t('quick_reports'), icon: '📊', href: '/index.html#reports' },
      { label: t('quick_settings'), icon: '⚙', href: '/index.html#settings' },
      { label: t('quick_audit'), icon: '📋', href: '/index.html#audit' }
    ];
    modules.forEach(function (m) {
      var item = document.createElement('a');
      item.className = 'module-item';
      item.href = m.href;
      item.innerHTML = '<div class="module-icon">' + m.icon + '</div><div>' + m.label + '</div>';
      moduleGrid.appendChild(item);
    });

    // Operational issues (low stock items as operational issues)
    issueList.innerHTML = '';
    var invItems = (data.inventory || {}).recentItems || [];
    var lowItems = invItems.filter(function (it) { return it.stockQty > 0 && it.stockQty <= 10; });
    if (lowItems.length === 0) {
      issueList.innerHTML =
        '<div class="empty-state" style="padding:20px"><div class="empty-icon">✅</div>' +
        '<div style="font-size:0.85rem">' + (isRTL ? 'لا توجد مشاكل معلقة' : 'No pending issues') + '</div></div>';
    } else {
      lowItems.slice(0, 5).forEach(function (it) {
        var item = document.createElement('div');
        item.className = 'alert-item warn';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(it.name) + '</div>' +
          '<div class="item-sub">' + (isRTL ? 'مستوى المخزون منخفض' : 'Low stock level') + '</div>' +
          '</div>' +
          '<div class="item-badge stock-low">' + esc(it.stockQty) + '</div>';
        issueList.appendChild(item);
      });
    }

    // Business activity
    activityList.innerHTML = '';
    var recent = [];
    invItems.slice(0, 3).forEach(function (it) {
      recent.push({ label: 'مخزون محدث', sub: it.name + ' — ' + fmtMoney(it.sellPrice), time: fmtDate(it.updatedAt) });
    });
    var suppList = (data.suppliers || {}).recentSuppliers || [];
    suppList.slice(0, 2).forEach(function (s) {
      recent.push({ label: 'مورد جديد', sub: s.name, time: fmtDate(s.createdAt) });
    });
    var treasList = (data.treasury || {}).recentTransactions || [];
    treasList.slice(0, 2).forEach(function (t2) {
      recent.push({ label: 'حركة مالية', sub: t2.description || '—', time: fmtDate(t2.createdAt) });
    });
    recent.sort(function (a, b) { return (b.time || '').localeCompare(a.time || ''); });
    recent.slice(0, 6).forEach(function (act) {
      var item = document.createElement('div');
      item.className = 'activity-item';
      item.innerHTML =
        '<div class="item-main">' +
        '<div style="font-weight:700">' + esc(act.label) + '</div>' +
        '<div class="item-sub">' + esc(act.sub) + '</div>' +
        '</div>' +
        '<div class="item-value">' + esc(act.time || '—') + '</div>';
      activityList.appendChild(item);
    });
    if (recent.length === 0) {
      activityList.innerHTML =
        '<div class="empty-state" style="padding:20px"><div class="empty-icon" style="font-size:2rem">📭</div>' +
        '<div style="font-size:0.85rem">' + (isRTL ? 'لا توجد أنشطة حديثة' : 'No recent activity') + '</div></div>';
    }

    // Quick access
    quickGrid.innerHTML = '';
    var quicks = [
      { label: t('quick_users'), icon: '👥', href: '/index.html#users' },
      { label: t('quick_roles'), icon: '🔐', href: '/index.html#roles' },
      { label: t('quick_modules'), icon: '🧩', href: '/index.html#modules' },
      { label: t('quick_reports'), icon: '📊', href: '/index.html#reports' },
      { label: t('quick_settings'), icon: '⚙', href: '/index.html#settings' },
      { label: t('quick_audit'), icon: '📋', href: '/index.html#audit' }
    ];
    quicks.forEach(function (q) {
      var item = document.createElement('a');
      item.className = 'quick-item';
      item.href = q.href;
      item.innerHTML = '<div class="quick-icon">' + q.icon + '</div><div>' + q.label + '</div>';
      quickGrid.appendChild(item);
    });
  }

  // ---------- Fetch ----------
  async function loadData() {
    loading = true;
    render();
    try {
      var res = await fetch(TENANT_HOME_API, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        credentials: 'same-origin'
      });
      if (!res.ok) {
        if (res.status === 401) {
          setStatus('error', t('error_title') + ' — غير مصرح');
          logoutBtn.hidden = false;
          return;
        }
        if (res.status === 403) {
          setStatus('error', t('error_title') + ' — لا تملك صلاحية العرض');
          return;
        }
        throw new Error('HTTP ' + res.status);
      }
      data = await res.json().catch(function () { return null; });
      if (!data || !data.success) {
        errorMsg = data && data.error ? data.error : 'Invalid response';
        render();
        return;
      }
      data = data.data || data;
      loading = false;
      render();
    } catch (err) {
      loading = false;
      errorMsg = err.message;
      render();
    }
  }

  // ---------- Logout ----------
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function (e) {
      e.preventDefault();
      fetch(LOGOUT_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin'
      }).then(function () {
        window.location.href = '/index.html';
      }).catch(function () {
        window.location.href = '/index.html';
      });
    });
  }

  // ---------- Init ----------
  loadData();
})();
