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
        sales_total: 'إجمالي المبيعات',
        customers_total: 'إجمالي العملاء',
        suppliers_total: 'إجمالي الموردين',
        treasury_total: 'إجمالي الحركات المالية',
        unavailable: 'غير متاح',
        recent_activity: 'آخر النشاط التجاري',
        ctx_role: 'الدور',
        ctx_perms: 'الصلاحية',
        ctx_status: 'الحالة',
        server_verified: 'موثقة من الخادم',
        quick_sales: 'المبيعات',
        quick_inventory: 'المخزون',
        quick_customers: 'العملاء',
        quick_suppliers: 'الموردين',
        quick_treasury: 'الخزينة'
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
        sales_total: 'Total Sales',
        customers_total: 'Total Customers',
        suppliers_total: 'Total Suppliers',
        treasury_total: 'Total Treasury Transactions',
        unavailable: 'Unavailable',
        recent_activity: 'Recent Business Activity',
        ctx_role: 'Role',
        ctx_perms: 'Permissions',
        ctx_status: 'Status',
        server_verified: 'Server-verified',
        quick_sales: 'Sales',
        quick_inventory: 'Inventory',
        quick_customers: 'Customers',
        quick_suppliers: 'Suppliers',
        quick_treasury: 'Treasury'
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

  // Render a single KPI card. Shows real value or explicit unavailable state.
  function renderKpi(label, value, available, sub) {
    var card = document.createElement('div');
    card.className = 'kpi-card';
    var disp = available ? String(value) : t('unavailable');
    card.innerHTML =
      '<div class="kpi-value">' + esc(disp) + '</div>' +
      '<div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-trend neutral">' + esc(sub || '') + '</div>';
    kpiGrid.appendChild(card);
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
    ctxPermsEl.textContent = t('ctx_perms') + ': ' + (data.perms && data.perms.length ? data.perms.join(', ') : '—');

    if (userWelcomeEl) userWelcomeEl.textContent = t('welcome');

    // KPI cards — real data only, no hardcoded values
    kpiGrid.innerHTML = '';
    var sales = data.sales || {};
    var cust = data.customers || {};
    var supp = data.suppliers || {};
    var treas = data.treasury || {};

    renderKpi(t('sales_total'), fmtMoney(sales.totalSales || 0), sales.available, '');
    renderKpi(t('customers_total'), String(cust.count || 0), cust.available, '');
    renderKpi(t('suppliers_total'), String(supp.count || 0), supp.available, '');
    // Treasury: only recent transactions are available, no complete total count.
    renderKpi(t('treasury_total'), t('unavailable'), false, '');

    // Recent activity (combine sales + customers + suppliers + treasury)
    activityList.innerHTML = '';
    var recent = [];
    (data.inventory && data.inventory.recentItems || []).slice(0, 3).forEach(function (it) {
      recent.push({ label: t('recent_activity'), sub: (it.name || '—') + ' — ' + fmtMoney(it.sellPrice || 0), time: fmtDate(it.updatedAt) });
    });
    (cust.recentCustomers || []).slice(0, 2).forEach(function (c) {
      recent.push({ label: 'New Customer', sub: c.name, time: fmtDate(c.createdAt) });
    });
    (supp.recentSuppliers || []).slice(0, 2).forEach(function (s) {
      recent.push({ label: 'New Supplier', sub: s.name, time: fmtDate(s.createdAt) });
    });
    (treas.recentTransactions || []).slice(0, 2).forEach(function (tx) {
      recent.push({ label: 'Treasury Transaction', sub: tx.description || '—', time: fmtDate(tx.createdAt) });
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
