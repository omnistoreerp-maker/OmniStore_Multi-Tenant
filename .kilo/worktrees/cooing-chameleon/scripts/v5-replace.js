const fs = require('fs');
let content = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');
const originalLength = content.length;

// 1. ADD V5 DASHBOARD CSS
const v5CSS = `
    /* ===== DASHBOARD V5 ENTERPRISE ===== */
    .v5-dashboard-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;background:linear-gradient(135deg,var(--surface) 0%,var(--surface2) 100%);border-radius:16px;margin-bottom:16px;box-shadow:var(--glass-shadow);border:1px solid var(--border);flex-wrap:wrap;gap:12px}
    .v5-header-left{display:flex;align-items:center;gap:14px;flex:1}
    .v5-header-logo{font-size:1.25rem;font-weight:800;color:var(--accent);letter-spacing:-0.5px}
    .v5-header-date{font-size:.78rem;color:var(--muted);font-weight:500}
    .v5-header-right{display:flex;align-items:center;gap:10px}
    .v5-header-btn{display:flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:.75rem;font-weight:600;cursor:pointer;transition:all .2s}
    .v5-header-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
    .v5-header-btn.accent{background:var(--accent);color:#fff;border-color:var(--accent)}
    .v5-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}
    .v5-kpi-card{background:var(--surface);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,.06);border:1px solid var(--border);transition:transform .2s,box-shadow .2s;position:relative;overflow:hidden}
    .v5-kpi-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(15,23,42,.1)}
    .v5-kpi-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;background:var(--accent);border-radius:16px 16px 0 0;opacity:.7}
    .v5-kpi-card.sales::before{background:var(--green)}
    .v5-kpi-card.profit::before{background:var(--accent)}
    .v5-kpi-card.cash::before{background:var(--sky)}
    .v5-kpi-card.alerts::before{background:var(--red)}
    .v5-kpi-card.inventory::before{background:var(--purple)}
    .v5-kpi-card.users::before{background:var(--orange)}
    .v5-kpi-card.maintenance::before{background:var(--amber)}
    .v5-kpi-card.installments::before{background:var(--teal)}
    .v5-kpi-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .v5-kpi-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:1.1rem;background:var(--surface2)}
    .v5-kpi-trend{display:flex;align-items:center;gap:3px;font-size:.68rem;font-weight:700;padding:3px 8px;border-radius:20px;background:var(--surface2)}
    .v5-kpi-trend.up{color:var(--green)}
    .v5-kpi-trend.down{color:var(--red)}
    .v5-kpi-value{font-size:1.35rem;font-weight:800;color:var(--text);margin-bottom:4px;line-height:1.2}
    .v5-kpi-label{font-size:.72rem;color:var(--muted);font-weight:500}
    .v5-kpi-sparkline{height:4px;border-radius:2px;background:var(--surface2);margin-top:10px;overflow:hidden}
    .v5-kpi-sparkline-bar{height:100%;border-radius:2px;background:var(--accent);width:60%}
    .v5-kpi-sparkline-bar.sales{background:var(--green)}
    .v5-kpi-sparkline-bar.profit{background:var(--accent)}
    .v5-kpi-sparkline-bar.cash{background:var(--sky)}
    .v5-kpi-sparkline-bar.alerts{background:var(--red)}
    .v5-kpi-sparkline-bar.inventory{background:var(--purple)}
    .v5-section-title{font-size:.88rem;font-weight:700;color:var(--text);margin:20px 0 12px;display:flex;align-items:center;gap:8px}
    .v5-section-title span{color:var(--muted);font-weight:500;font-size:.75rem}
    .v5-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;margin-bottom:16px}
    .v5-chart-card{background:var(--surface);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,.06);border:1px solid var(--border)}
    .v5-chart-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .v5-chart-title{font-size:.82rem;font-weight:700;color:var(--text)}
    .v5-chart-canvas{height:220px;position:relative}
    .v5-chart-empty{display:grid;place-items:center;height:220px;color:var(--muted);font-size:.78rem;text-align:center}
    .v5-alerts-panel{background:var(--surface);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,.06);border:1px solid var(--border);margin-bottom:16px}
    .v5-alert-item{display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border);font-size:.78rem}
    .v5-alert-item:last-child{border-bottom:none}
    .v5-alert-icon{width:28px;height:28px;border-radius:8px;display:grid;place-items:center;font-size:.9rem;background:var(--surface2);flex-shrink:0}
    .v5-alert-icon.critical{background:#fee2e2;color:var(--red)}
    .v5-alert-icon.warning{background:#fef3c7;color:var(--amber)}
    .v5-alert-icon.info{background:#dbeafe;color:var(--accent)}
    .v5-alert-text{flex:1;color:var(--text2)}
    .v5-alert-time{font-size:.68rem;color:var(--muted);white-space:nowrap}
    .v5-activity-timeline{background:var(--surface);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,.06);border:1px solid var(--border);margin-bottom:16px}
    .v5-timeline-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid var(--border);font-size:.78rem}
    .v5-timeline-item:last-child{border-bottom:none}
    .v5-timeline-dot{width:10px;height:10px;border-radius:50%;background:var(--accent);margin-top:4px;flex-shrink:0;position:relative}
    .v5-timeline-dot::after{content:'';position:absolute;top:10px;left:4px;width:2px;height:calc(100% + 10px);background:var(--border)}
    .v5-timeline-item:last-child .v5-timeline-dot::after{display:none}
    .v5-timeline-content{flex:1}
    .v5-timeline-title{font-weight:600;color:var(--text);margin-bottom:2px}
    .v5-timeline-meta{color:var(--muted);font-size:.68rem}
    .v5-quick-actions{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:16px}
    .v5-quick-action-btn{display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;border-radius:14px;border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:.72rem;font-weight:600;cursor:pointer;transition:all .2s}
    .v5-quick-action-btn:hover{background:var(--accent);color:#fff;border-color:var(--accent);transform:translateY(-2px)}
    .v5-quick-action-icon{font-size:1.4rem}
    .v5-modules-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px;margin-bottom:16px}
    .v5-module-card{background:var(--surface);border-radius:16px;padding:16px;box-shadow:0 2px 12px rgba(15,23,42,.06);border:1px solid var(--border);transition:transform .2s,box-shadow .2s;cursor:pointer}
    .v5-module-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(15,23,42,.1)}
    .v5-module-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
    .v5-module-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:1.2rem;background:linear-gradient(135deg,var(--surface2),var(--bg))}
    .v5-module-title{font-size:.85rem;font-weight:700;color:var(--text)}
    .v5-module-desc{font-size:.72rem;color:var(--muted);margin-bottom:10px}
    .v5-module-metrics{display:flex;gap:12px;font-size:.7rem;color:var(--text2)}
    .v5-module-metric{display:flex;align-items:center;gap:4px}
    .v5-empty-state{display:grid;place-items:center;padding:24px;color:var(--muted);font-size:.78rem;text-align:center}
    .v5-skeleton{background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200% 100%;animation:v5-skeleton 1.5s infinite;border-radius:8px}
    @keyframes v5-skeleton{0%{background-position:200% 0}100%{background-position:-200% 0}}
    @media(max-width:760px){.v5-kpi-grid{grid-template-columns:repeat(2,1fr)}.v5-chart-grid{grid-template-columns:1fr}.v5-modules-grid{grid-template-columns:1fr}}
    @media(max-width:480px){.v5-kpi-grid{grid-template-columns:1fr}.v5-quick-actions{grid-template-columns:repeat(2,1fr)}}
`;

const styleEndIdx = content.indexOf('  </style>\n  <nav class="sidebar"');
if (styleEndIdx >= 0) {
  content = content.slice(0, styleEndIdx) + v5CSS + '\n' + content.slice(styleEndIdx);
  console.log('Inserted V5 CSS');
} else {
  console.log('WARNING: CSS insertion point not found');
}

// 2. REPLACE #page-dashboard HTML
const oldDashboardStart = content.indexOf('<div class="page" id="page-dashboard">');
const oldDashboardEnd = content.indexOf('<!-- SMART BUSINESS INTELLIGENCE -->');

if (oldDashboardStart >= 0 && oldDashboardEnd >= 0) {
  const v5DashboardHTML = `<div class="page" id="page-dashboard">
      <!-- V5 Enterprise Header -->
      <div class="v5-dashboard-header">
        <div class="v5-header-left">
          <div class="v5-header-logo">◈ OmniStore ERP</div>
          <div class="v5-header-date" id="dashDate"></div>
        </div>
        <div class="v5-header-right">
          <button class="v5-header-btn" onclick="toggleSidebar()" title="القائمة">☰</button>
          <button class="v5-header-btn" onclick="showPage('alerts-center')" title="التنبيهات">🔔 <span id="v5HeaderAlertCount">0</span></button>
          <button class="v5-header-btn accent" onclick="safeShowPage('pos')" title="فاتورة جديدة">+ بيع</button>
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="v5-kpi-grid" id="v5KpiGrid">
        <div class="v5-kpi-card sales">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">💰</div>
            <div class="v5-kpi-trend up">▲ --%</div>
          </div>
          <div class="v5-kpi-value" id="ds-sales">0</div>
          <div class="v5-kpi-label">مبيعات اليوم</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar sales" style="width:65%"></div></div>
        </div>
        <div class="v5-kpi-card profit">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">📈</div>
            <div class="v5-kpi-trend up">▲ --%</div>
          </div>
          <div class="v5-kpi-value" id="ds-profit">0</div>
          <div class="v5-kpi-label">ربح اليوم</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar profit" style="width:55%"></div></div>
        </div>
        <div class="v5-kpi-card cash">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">🏦</div>
            <div class="v5-kpi-trend">--</div>
          </div>
          <div class="v5-kpi-value" id="ds-treasury">0</div>
          <div class="v5-kpi-label">الخزينة</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar cash" style="width:70%"></div></div>
        </div>
        <div class="v5-kpi-card alerts">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">🔔</div>
            <div class="v5-kpi-trend down">▼ --</div>
          </div>
          <div class="v5-kpi-value" id="ds-alert-lowstock">0</div>
          <div class="v5-kpi-label">التنبيهات</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar alerts" style="width:40%"></div></div>
        </div>
        <div class="v5-kpi-card inventory">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">📦</div>
            <div class="v5-kpi-trend">--</div>
          </div>
          <div class="v5-kpi-value" id="ds-products">0</div>
          <div class="v5-kpi-label">المنتجات</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar inventory" style="width:80%"></div></div>
        </div>
        <div class="v5-kpi-card users">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">👤</div>
            <div class="v5-kpi-trend up">▲ --</div>
          </div>
          <div class="v5-kpi-value" id="ds-audit-users">0</div>
          <div class="v5-kpi-label">المستخدمين النشطين</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar users" style="width:50%"></div></div>
        </div>
        <div class="v5-kpi-card maintenance">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">🔧</div>
            <div class="v5-kpi-trend">--</div>
          </div>
          <div class="v5-kpi-value" id="ds-maint">0</div>
          <div class="v5-kpi-label">صيانة معلقة</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar maintenance" style="width:35%"></div></div>
        </div>
        <div class="v5-kpi-card installments">
          <div class="v5-kpi-top">
            <div class="v5-kpi-icon">⏰</div>
            <div class="v5-kpi-trend down">▼ --</div>
          </div>
          <div class="v5-kpi-value" id="ds-inst-overdue">0</div>
          <div class="v5-kpi-label">أقساط متأخرة</div>
          <div class="v5-kpi-sparkline"><div class="v5-kpi-sparkline-bar installments" style="width:30%"></div></div>
        </div>
      </div>

      <!-- Analytics Charts -->
      <div class="v5-section-title">📊 التحليلات <span>مؤشرات الأداء الرئيسية</span></div>
      <div class="v5-chart-grid">
        <div class="v5-chart-card">
          <div class="v5-chart-header">
            <div class="v5-chart-title">مبيعات الأسبوع</div>
          </div>
          <div class="v5-chart-canvas">
            <canvas id="dashboardSalesChart"></canvas>
          </div>
        </div>
        <div class="v5-chart-card">
          <div class="v5-chart-header">
            <div class="v5-chart-title">الإيرادات</div>
          </div>
          <div class="v5-chart-canvas">
            <canvas id="dashboardRevenueChart"></canvas>
          </div>
        </div>
        <div class="v5-chart-card">
          <div class="v5-chart-header">
            <div class="v5-chart-title">التدفق النقدي</div>
          </div>
          <div class="v5-chart-canvas">
            <canvas id="dashboardCashChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Alerts Panel -->
      <div class="v5-section-title">⚠️ التنبيهات الذكية <span>مخزون، ضمان، أقساط</span></div>
      <div class="v5-alerts-panel" id="v5AlertsPanel">
        <div class="v5-empty-state">لا توجد تنبيهات حالياً</div>
      </div>

      <!-- Activity Timeline -->
      <div class="v5-section-title">🕘 النشاط الأخير <span>آخر العمليات</span></div>
      <div class="v5-activity-timeline" id="v5ActivityTimeline">
        <div class="v5-empty-state">لا توجد عمليات حديثة</div>
      </div>

      <!-- Quick Actions -->
      <div class="v5-section-title">⚡ إجراءات سريعة <span>الوصول المباشر</span></div>
      <div class="v5-quick-actions">
        <button class="v5-quick-action-btn" onclick="safeShowPage('pos')">
          <span class="v5-quick-action-icon">🛒</span>
          <span>فاتورة بيع</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('purchases')">
          <span class="v5-quick-action-icon">📥</span>
          <span>فاتورة شراء</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('crm')">
          <span class="v5-quick-action-icon">👤</span>
          <span>عميل جديد</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('products')">
          <span class="v5-quick-action-icon">📦</span>
          <span>منتج جديد</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('maintenance')">
          <span class="v5-quick-action-icon">🔧</span>
          <span>طلب صيانة</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('treasury')">
          <span class="v5-quick-action-icon">💵</span>
          <span>تحصيل</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('expenses')">
          <span class="v5-quick-action-icon">💸</span>
          <span>مصروف</span>
        </button>
        <button class="v5-quick-action-btn" onclick="safeShowPage('reports')">
          <span class="v5-quick-action-icon">📊</span>
          <span>تقارير</span>
        </button>
      </div>

      <!-- Module Cards -->
      <div class="v5-section-title">🧩 الوحدات <span>الوصول السريع للوحدات</span></div>
      <div class="v5-modules-grid" id="v5ModulesGrid">
      </div>
    </div>`;

  content = content.slice(0, oldDashboardStart) + v5DashboardHTML + '\n    <!-- SMART BUSINESS INTELLIGENCE -->' + content.slice(oldDashboardEnd + '<!-- SMART BUSINESS INTELLIGENCE -->'.length);
  console.log('Replaced dashboard HTML');
} else {
  console.log('WARNING: dashboard HTML boundaries not found', oldDashboardStart, oldDashboardEnd);
}

// 3. REPLACE renderDashboard() function
const oldFuncStart = content.indexOf('function renderDashboard() {');
const oldFuncEnd = content.indexOf('// Render sales chart on dashboard');

if (oldFuncStart >= 0 && oldFuncEnd >= 0) {
  const v5RenderDashboard = `function renderDashboard() {
  const dashboardVersionKey = getDataVersionKey('dashboard');
  const today = new Date();
  const todayInvoices = DB.saleInvoices.filter(inv => isToday(inv.date));
  
  const todaySales = todayInvoices.reduce((sum, inv) => sum + getNetInvoiceTotal(inv), 0);
  const todayProfit = todayInvoices.reduce((sum, inv) => sum + getNetInvoiceProfit(inv), 0);
  const todayExpenses = DB.expenses.filter(e => isToday(e.date)).reduce((sum, e) => sum + (e.amount || 0), 0);
  const netProfit = todayProfit - todayExpenses;
  
  const totalProducts = DB.products.length;
  const lowStock = DB.products.filter(p => getProductStock(p.id) <= (p.minStock || 5)).length;
  const treasuryBalance = getTreasurySummary().total;
  const maintPending = DB.maintenance.filter(m => m.status === 'pending').length;
  
  const setDash = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  
  setDash('ds-sales', formatMoney(todaySales));
  setDash('ds-profit', maskMoneyIfRestricted(todayProfit));
  setDash('ds-treasury', formatMoney(treasuryBalance));
  setDash('ds-alert-lowstock', lowStock);
  setDash('ds-products', totalProducts);
  setDash('ds-maint', maintPending);
  setDash('ds-audit-users', new Set(getVisibleAuditEntries().filter(e => String(e.timestamp || '').slice(0,10) === new Date().toISOString().slice(0,10)).map(e => e.username || '-')).size);
  
  try {
    normalizeAllInstallments();
    const instToday = localDateString();
    const visibleInst = (DB.installments || []).filter(i => can('all') || canSeeBranch(i.branchId || 'MAIN'));
    setDash('ds-inst-overdue', visibleInst.reduce((s, i) => s + getInstallmentDueStats(i, instToday).overdue, 0));
  } catch(e) {}
  
  const dashDateEl = document.getElementById('dashDate');
  if (dashDateEl) dashDateEl.textContent = today.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  const headerAlertEl = document.getElementById('v5HeaderAlertCount');
  if (headerAlertEl) headerAlertEl.textContent = lowStock + maintPending;
  
  try {
    const smartAlerts = getCachedComputation('dashboard:smartAlerts', dashboardVersionKey, () => buildSmartAlerts());
    const alertsPanel = document.getElementById('v5AlertsPanel');
    if (alertsPanel) {
      if (smartAlerts.length === 0) {
        alertsPanel.innerHTML = '<div class="v5-empty-state">لا توجد تنبيهات حالياً</div>';
      } else {
        alertsPanel.innerHTML = smartAlerts.slice(0, 6).map(a => {
          const cls = a.level === 'critical' ? 'critical' : a.level === 'warning' ? 'warning' : 'info';
          const icon = a.level === 'critical' ? '⚠️' : a.level === 'warning' ? '⏳' : 'ℹ️';
          return '<div class="v5-alert-item"><div class="v5-alert-icon ' + cls + '">' + icon + '</div><div class="v5-alert-text">' + a.text + '</div><div class="v5-alert-time">' + (a.time || '') + '</div></div>';
        }).join('');
      }
    }
  } catch(e) {}
  
  try {
    const timeline = document.getElementById('v5ActivityTimeline');
    if (timeline) {
      const entries = [];
      todayInvoices.slice(0, 5).forEach(inv => {
        entries.push({
          title: 'فاتورة بيع #' + inv.id,
          meta: (inv.items ? inv.items.length : 0) + ' صنف · ' + formatMoney(getNetInvoiceTotal(inv)) + ' · ' + (inv.user || '-'),
          icon: '🛒',
          time: new Date(inv.date).toLocaleTimeString('ar-EG')
        });
      });
      const recentMaint = DB.maintenance.filter(m => m.status === 'pending').slice(0, 3);
      recentMaint.forEach(m => {
        entries.push({
          title: 'صيانة: ' + (m.deviceName || m.deviceSerial || '-'),
          meta: m.customerName || '-',
          icon: '🔧',
          time: m.date ? new Date(m.date).toLocaleDateString('ar-EG') : ''
        });
      });
      if (entries.length === 0) {
        timeline.innerHTML = '<div class="v5-empty-state">لا توجد عمليات حديثة</div>';
      } else {
        timeline.innerHTML = entries.map(e => '<div class="v5-timeline-item"><div class="v5-timeline-dot"></div><div class="v5-timeline-content"><div class="v5-timeline-title">' + e.icon + ' ' + e.title + '</div><div class="v5-timeline-meta">' + e.meta + ' · ' + e.time + '</div></div></div>').join('');
      }
    }
  } catch(e) {}
  
  try {
    const modulesGrid = document.getElementById('v5ModulesGrid');
    if (modulesGrid) {
      const modules = [
        { id: 'sales', title: 'المبيعات', desc: 'فواتير البيع والمردودات', icon: '🛒', metrics: [{label: 'اليوم', value: formatMoney(todaySales)}, {label: 'الفواتير', value: todayInvoices.length}] },
        { id: 'purchases', title: 'المشتريات', desc: 'فواتير الشراء والموردين', icon: '📥', metrics: [{label: 'المشتريات', value: (DB.purchaseInvoices || []).length}, {label: 'الموردين', value: (DB.suppliers || []).length}] },
        { id: 'inventory', title: 'المخزون', desc: 'المنتجات والتنبيهات', icon: '📦', metrics: [{label: 'المنتجات', value: totalProducts}, {label: 'منخفض', value: lowStock}] },
        { id: 'finance', title: 'المالية', desc: 'الخزينة والتقارير', icon: '🏦', metrics: [{label: 'الرصيد', value: formatMoney(treasuryBalance)}, {label: 'المصروفات', value: formatMoney(todayExpenses)}] },
        { id: 'maintenance', title: 'الصيانة', desc: 'طلبات الصيانة والضمان', icon: '🔧', metrics: [{label: 'معلقة', value: maintPending}, {label: 'الأجهزة', value: (DB.devices || []).length}] },
        { id: 'customers', title: 'العملاء', desc: 'قاعدة العملاء والولاء', icon: '👤', metrics: [{label: 'العملاء', value: (DB.customers || []).length}, {label: 'الجديد', value: (DB.customers || []).filter(c => { const d = new Date(c.registrationDate || c.createdAt || c.id || 0); return !isNaN(d.getTime()) && d >= new Date(today.getFullYear(), today.getMonth(), 1); }).length}] },
        { id: 'employees', title: 'الموظفين', desc: 'الحضور والرواتب', icon: '👨‍💼', metrics: [{label: 'الموظفين', value: (DB.employees || []).length}, {label: 'الحضور', value: '-'}] },
        { id: 'reports', title: 'التقارير', desc: 'التقارير والتحليلات', icon: '📊', metrics: [{label: 'التقارير', value: 'متاح'}, {label: 'التحليلات', value: 'متاح'}] },
        { id: 'settings', title: 'الإعدادات', desc: 'إعدادات النظام', icon: '⚙️', metrics: [{label: 'الفروع', value: (DB.branches || []).length}, {label: 'المستخدمين', value: (DB.users || []).length}] },
        { id: 'analytics', title: 'التحليلات', desc: 'الذكاء التجاري', icon: '💡', metrics: [{label: 'التحليلات', value: 'متاح'}, {label: 'التنبؤات', value: 'متاح'}] }
      ];
      modulesGrid.innerHTML = modules.map(m => '<div class="v5-module-card" onclick="safeShowPage(\'' + m.id + '\')"><div class="v5-module-top"><div class="v5-module-icon">' + m.icon + '</div><div class="v5-module-title">' + m.title + '</div></div><div class="v5-module-desc">' + m.desc + '</div><div class="v5-module-metrics">' + m.metrics.map(me => '<div class="v5-module-metric"><span>' + me.label + ':</span> <strong>' + me.value + '</strong></div>').join('') + '</div></div>').join('');
    }
  } catch(e) {}
  
  updateAlertsBell();
  try { renderDashboardSalesChart(); } catch(e) {}
  try { renderDashboardRevenueChart(); } catch(e) {}
  try { renderDashboardCashChart(); } catch(e) {}
}`;
  content = content.slice(0, oldFuncStart) + v5RenderDashboard + '\n' + content.slice(oldFuncEnd);
  console.log('Replaced renderDashboard()');
} else {
  console.log('WARNING: renderDashboard boundaries not found', oldFuncStart, oldFuncEnd);
}

// 4. ADD safeShowPage helper
const safeShowPageFunc = `
function safeShowPage(page) {
  try {
    if (typeof showPage === 'function') {
      showPage(page);
    } else {
      console.warn('showPage not available for page:', page);
    }
  } catch(e) {
    console.warn('Navigation error for page:', page, e);
  }
}
`;

const afterRenderDashboard = content.indexOf('try { renderDashboardCashChart(); } catch(e) {}');
if (afterRenderDashboard >= 0) {
  const insertPos = content.indexOf('}', afterRenderDashboard) + 1;
  content = content.slice(0, insertPos) + '\n' + safeShowPageFunc + content.slice(insertPos);
  console.log('Added safeShowPage');
}

// 5. ADD new chart functions after renderDashboardSalesChart
const newChartFuncs = `
function renderDashboardRevenueChart() {
  const ctx = document.getElementById('dashboardRevenueChart');
  if (!ctx) return;
  if (window._dashboardRevenueChart) { window._dashboardRevenueChart.destroy(); }
  const days = 7;
  const labels = [];
  const data = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('ar-EG', { weekday: 'short' }));
    const dayTotal = (DB.saleInvoices || []).filter(inv => inv.date && inv.date.slice(0, 10) === dateStr).reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
    data.push(dayTotal);
  }
  window._dashboardRevenueChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'الإيرادات', data: data, backgroundColor: 'rgba(37,99,235,0.2)', borderColor: 'rgba(37,99,235,1)', borderWidth: 2, borderRadius: 6, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
  });
}
function renderDashboardCashChart() {
  const ctx = document.getElementById('dashboardCashChart');
  if (!ctx) return;
  if (window._dashboardCashChart) { window._dashboardCashChart.destroy(); }
  const days = 7;
  const labels = [];
  const inData = [];
  const outData = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('ar-EG', { weekday: 'short' }));
    const dayIn = (DB.saleInvoices || []).filter(inv => inv.date && inv.date.slice(0, 10) === dateStr).reduce((s, inv) => s + getNetInvoiceTotal(inv), 0);
    const dayOut = (DB.expenses || []).filter(e => e.date && e.date.slice(0, 10) === dateStr).reduce((s, e) => s + (e.amount || 0), 0) + (DB.purchaseInvoices || []).filter(inv => inv.date && inv.date.slice(0, 10) === dateStr).reduce((s, inv) => s + (inv.total || 0), 0);
    inData.push(dayIn);
    outData.push(dayOut);
  }
  window._dashboardCashChart = new Chart(ctx, {
    type: 'line',
    data: { labels: labels, datasets: [{ label: 'وارد', data: inData, borderColor: '#16a34a', backgroundColor: 'rgba(22,163,74,0.1)', borderWidth: 2, tension: 0.4, fill: true }, { label: 'صادر', data: outData, borderColor: '#dc2626', backgroundColor: 'rgba(220,38,38,0.1)', borderWidth: 2, tension: 0.4, fill: true }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
  });
}
`;

const salesChartEnd = content.indexOf('window._dashboardSalesChart = new Chart(ctx, {');
if (salesChartEnd >= 0) {
  let braceCount = 0;
  let inString = false;
  let stringChar = '';
  let foundStart = false;
  let pos = salesChartEnd;
  for (; pos < content.length; pos++) {
    const ch = content[pos];
    if (inString) {
      if (ch === stringChar && content[pos-1] !== '\\') inString = false;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = true;
      stringChar = ch;
      continue;
    }
    if (ch === '{') { braceCount++; foundStart = true; }
    if (ch === '}') { braceCount--; }
    if (foundStart && braceCount === 0 && ch === '}') {
      pos++;
      break;
    }
  }
  const nextFunc = content.indexOf('function ', pos);
  const insertAt = nextFunc >= 0 ? nextFunc : pos;
  content = content.slice(0, insertAt) + newChartFuncs + '\n' + content.slice(insertAt);
  console.log('Added new chart functions');
} else {
  console.log('WARNING: sales chart end not found');
}

fs.writeFileSync('E:/Projects/ESO/DigiTronics_v5.html', content, 'utf-8');
console.log('Done. Original:', originalLength, 'New:', content.length, 'Diff:', content.length - originalLength);
