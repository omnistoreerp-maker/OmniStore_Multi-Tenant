/* ================= Tenant Owner Home — OmniStore =================
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
  const lowStockList = document.getElementById('lowStockList');
  const lowStockViewAll = document.getElementById('lowStockViewAll');
  const activityList = document.getElementById('activityList');
  const customerList = document.getElementById('customerList');
  const supplierList = document.getElementById('supplierList');
  const treasuryList = document.getElementById('treasuryList');
  const quickGrid = document.getElementById('quickGrid');

  // ---------- State ----------
  let data = null;
  let loading = true;
  let errorMsg = null;

  // ---------- Helpers ----------
  function t(key) {
    const T = {
      ar: {
        app_title: 'رئيس المالك — متجر omni',
        welcome: 'مرحباً، صاحب العمل',
        logout: 'تسجيل خروج',
        loading: 'جارٍ تحميل بيانات العمل…',
        error_title: 'تعذر تحميل البيانات',
        error_retry: 'محاولة مرة أخرى',
        empty_title: 'لا توجد بيانات',
        empty_sub: 'لا توجد بيانات أعمال متاحة للشركة المختارة.',
        business_overview: 'نظرة عامة على العمل',
        low_stock: 'تنبيهات المخزون المنخفض',
        recent_activity: 'آخر النشاط التجاري',
        recent_customers: 'آخر العملاء',
        recent_suppliers: 'آخر الموردين',
        treasury: 'آخر الحركات المالية',
        quick_access: 'الوصول السريع',
        total_sales: 'إجمالي المبيعات',
        total_profit: 'إجمالي الربح',
        total_invoices: 'إجمالي الفواتير',
        cash_sales: 'مبيعات نقدية',
        credit_sales: 'مبيعات آجلة',
        total_items: 'إجمالي الأصناف',
        low_stock_alert: 'تنبيه: مخزون منخفض',
        recent_sale: 'بيع حديث',
        new_customer: 'عميل جديد',
        new_supplier: 'مورد جديد',
        treasury_move: 'حركة مالية',
        view_all: 'عرض الكل',
        sales_overview: 'نظرة عامة على المبيعات',
        inventory_position: 'الوضع الحالي للمخزون',
        tasks_title: 'المهام operativa',
        ctx_role: 'الدور',
        ctx_perms: 'الصلاحيات',
        ctx_status: 'الحالة',
        server_verified: 'موثقة من الخادم',
        quick_sales: 'الفواتير',
        quick_inventory: 'الأصناف',
        quick_customers: 'العملاء',
        quick_suppliers: 'الموردين',
        quick_reports: 'التقارير',
        quick_treasury: 'الخزينة'
      },
      en: {
        app_title: 'Tenant Owner Home — OmniStore',
        welcome: 'Welcome, Business Owner',
        logout: 'Sign Out',
        loading: 'Loading business data…',
        error_title: 'Failed to load data',
        error_retry: 'Retry',
        empty_title: 'No data',
        empty_sub: 'No business data available for the selected company.',
        business_overview: 'Business Overview',
        low_stock: 'Low Stock Alerts',
        recent_activity: 'Recent Business Activity',
        recent_customers: 'Recent Customers',
        recent_suppliers: 'Recent Suppliers',
        treasury: 'Recent Treasury Transactions',
        quick_access: 'Quick Access',
        total_sales: 'Total Sales',
        total_profit: 'Total Profit',
        total_invoices: 'Total Invoices',
        cash_sales: 'Cash Sales',
        credit_sales: 'Credit Sales',
        total_items: 'Total Items',
        low_stock_alert: 'Low Stock Alert',
        recent_sale: 'Recent Sale',
        new_customer: 'New Customer',
        new_supplier: 'New Supplier',
        treasury_move: 'Treasury Transaction',
        view_all: 'View All',
        sales_overview: 'Sales Overview',
        inventory_position: 'Inventory Position',
        tasks_title: 'Operational Tasks',
        ctx_role: 'Role',
        ctx_perms: 'Permissions',
        ctx_status: 'Status',
        server_verified: 'Server-verified',
        quick_sales: 'Sales',
        quick_inventory: 'Inventory',
        quick_customers: 'Customers',
        quick_suppliers: 'Suppliers',
        quick_reports: 'Reports',
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

    // User welcome
    if (userWelcomeEl) userWelcomeEl.textContent = t('welcome');

    // KPI cards
    kpiGrid.innerHTML = '';
    var sales = data.sales || {};
    var inv = data.inventory || {};
    var cust = data.customers || {};

    var kpis = [
      { label: t('total_sales'), value: fmtMoney(sales.totalSales || 0), trend: 'neutral', sub: t('sales_overview') },
      { label: t('total_profit'), value: fmtMoney(sales.profit || 0), trend: 'neutral', sub: t('sales_overview') },
      { label: t('total_invoices'), value: String(sales.count || 0), trend: 'neutral', sub: t('sales_overview') },
      { label: t('total_items'), value: String(inv.totalItems || 0), trend: inv.lowStockCount > 0 ? 'down' : 'neutral', sub: t('inventory_position') },
      { label: t('low_stock_alert'), value: String(inv.lowStockCount || 0), trend: inv.lowStockCount > 0 ? 'down' : 'neutral', sub: t('low_stock') },
      { label: t('recent_customers'), value: String(cust.count || 0), trend: 'neutral', sub: t('recent_customers') }
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

    // Low stock alerts
    lowStockList.innerHTML = '';
    var lowItems = (inv.recentItems || []).filter(function (it) { return it.stockQty > 0 && it.stockQty <= 10; });
    if (lowItems.length === 0) {
      lowStockList.innerHTML =
        '<div class="empty-state"><div class="empty-icon">✅</div>' +
        '<div style="font-size:0.85rem">' + (isRTL ? 'لا توجد تنبيهات مخزون منخفض' : 'No low-stock alerts') + '</div></div>';
      lowStockViewAll.style.display = 'none';
    } else {
      lowItems.slice(0, 5).forEach(function (it) {
        var item = document.createElement('div');
        item.className = 'alert-item danger';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(it.name) + '</div>' +
          '<div class="item-sub">' + (isRTL ? 'المخزون المتبقي: ' : 'Remaining stock: ') + esc(it.stockQty) + ' · ' + esc(it.sku || '—') + '</div>' +
          '</div>' +
          '<div class="item-badge stock-low">' + t('low_stock_alert') + '</div>';
        lowStockList.appendChild(item);
      });
      lowStockViewAll.style.display = 'inline-block';
      lowStockViewAll.onclick = function (e) {
        e.preventDefault();
        window.location.href = '/index.html#inventory';
      };
    }

    // Recent activity (combine sales + customers + suppliers + treasury)
    activityList.innerHTML = '';
    var activities = [];
    (data.sales || []).forEach(function () { /* placeholder - real data from sales list if available */ });
    var recent = [];
    var invItems = (inv.recentItems || []);
    invItems.slice(0, 3).forEach(function (it) {
      recent.push({ label: t('recent_sale'), sub: it.name + ' — ' + fmtMoney(it.sellPrice), time: fmtDate(it.updatedAt), type: 'sale' });
    });
    var custList = (cust.recentCustomers || []);
    custList.slice(0, 3).forEach(function (c) {
      recent.push({ label: t('new_customer'), sub: c.name, time: fmtDate(c.createdAt), type: 'customer' });
    });
    var suppList = (data.suppliers || {}).recentSuppliers || [];
    suppList.slice(0, 2).forEach(function (s) {
      recent.push({ label: t('new_supplier'), sub: s.name, time: fmtDate(s.createdAt), type: 'supplier' });
    });
    var treasList = (data.treasury || {}).recentTransactions || [];
    treasList.slice(0, 2).forEach(function (t2) {
      recent.push({ label: t('treasury_move'), sub: t2.description || '—', time: fmtDate(t2.createdAt), type: 'treasury' });
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

    // Customers
    customerList.innerHTML = '';
    if (custList.length === 0) {
      customerList.innerHTML =
        '<div class="empty-state" style="padding:16px"><div class="empty-icon">👥</div>' +
        '<div style="font-size:0.8rem">' + (isRTL ? 'لا توجد عملاء' : 'No customers') + '</div></div>';
    } else {
      custList.forEach(function (c) {
        var item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(c.name) + '</div>' +
          '<div class="item-sub">' + esc(c.phone || c.email || '—') + '</div>' +
          '</div>' +
          '<div class="item-value">' + esc(fmtDate(c.createdAt)) + '</div>';
        customerList.appendChild(item);
      });
    }

    // Suppliers
    supplierList.innerHTML = '';
    if (suppList.length === 0) {
      supplierList.innerHTML =
        '<div class="empty-state" style="padding:16px"><div class="empty-icon">🚚</div>' +
        '<div style="font-size:0.8rem">' + (isRTL ? 'لا توجد موردين' : 'No suppliers') + '</div></div>';
    } else {
      suppList.forEach(function (s) {
        var item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(s.name) + '</div>' +
          '<div class="item-sub">' + esc(s.phone || s.email || '—') + '</div>' +
          '</div>' +
          '<div class="item-value">' + esc(fmtDate(s.createdAt)) + '</div>';
        supplierList.appendChild(item);
      });
    }

    // Treasury
    treasuryList.innerHTML = '';
    if (treasList.length === 0) {
      treasuryList.innerHTML =
        '<div class="empty-state" style="padding:16px"><div class="empty-icon">💰</div>' +
        '<div style="font-size:0.8rem">' + (isRTL ? 'لا توجد حركات مالية' : 'No treasury transactions') + '</div></div>';
    } else {
      treasList.forEach(function (tx) {
        var item = document.createElement('div');
        item.className = 'list-item';
        item.innerHTML =
          '<div class="item-main">' +
          '<div style="font-weight:700">' + esc(tx.type || t('treasury_move')) + '</div>' +
          '<div class="item-sub">' + esc(tx.description || '—') + '</div>' +
          '</div>' +
          '<div class="item-value">' + esc(fmtMoney(tx.amount || 0)) + '</div>';
        treasuryList.appendChild(item);
      });
    }

    // Quick access
    quickGrid.innerHTML = '';
    var quicks = [
      { label: t('quick_sales'), icon: '🧾', href: '/index.html#sales' },
      { label: t('quick_inventory'), icon: '📦', href: '/index.html#inventory' },
      { label: t('quick_customers'), icon: '👥', href: '/index.html#customers' },
      { label: t('quick_suppliers'), icon: '🚚', href: '/index.html#suppliers' },
      { label: t('quick_reports'), icon: '📊', href: '/index.html#reports' },
      { label: t('quick_treasury'), icon: '💰', href: '/index.html#treasury' }
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
