const fs = require('fs');
let content = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');

const v6HTML = `<div class="page" id="page-dashboard">
      <!-- V6 Enterprise Header -->
      <div class="d6-header">
        <div class="d6-header-left">
          <div class="d6-logo">
            <div class="d6-logo-icon">◈</div>
            OmniStore ERP
          </div>
        </div>
        <div class="d6-header-center">
          <div class="d6-search">
            <input type="text" placeholder="بحث سريع..." id="d6GlobalSearch" onkeydown="if(event.key==='Enter')alert('البحث: '+this.value)">
          </div>
        </div>
        <div class="d6-header-right">
          <div class="d6-connection" id="d6ConnectionStatus">
            <span>●</span> متصل
          </div>
          <div class="d6-clock" id="d6Clock">--:--</div>
          <button class="d6-header-btn" onclick="toggleDarkMode()" title="الوضع الليلي">🌙</button>
          <button class="d6-header-btn" onclick="showPage('alerts-center')" title="التنبيهات">
            🔔
            <span class="badge" id="d6AlertBadge">0</span>
          </button>
          <button class="d6-header-btn profile" onclick="showPage('settings')" title="الملف الشخصي">
            <div class="avatar" id="d6HeaderAvatar">A</div>
            <span id="d6HeaderUser">Admin</span>
          </button>
        </div>
      </div>

      <!-- KPI Grid -->
      <div class="d6-kpi-grid" id="d6KpiGrid">
        <div class="d6-kpi-card sales" onclick="showPage('invoices')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">💰</div>
            <div class="d6-kpi-trend" id="d6SalesTrend">▲ 0%</div>
          </div>
          <div class="d6-kpi-value" id="ds-sales">0</div>
          <div class="d6-kpi-label">مبيعات اليوم</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6SalesSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card profit" onclick="showPage('reports')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">📈</div>
            <div class="d6-kpi-trend" id="d6ProfitTrend">▲ 0%</div>
          </div>
          <div class="d6-kpi-value" id="ds-profit">0</div>
          <div class="d6-kpi-label">ربح اليوم</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6ProfitSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card cash" onclick="showPage('treasury')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">🏦</div>
            <div class="d6-kpi-trend" id="d6CashTrend">--</div>
          </div>
          <div class="d6-kpi-value" id="ds-treasury">0</div>
          <div class="d6-kpi-label">الخزينة</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6CashSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card alerts" onclick="showPage('alerts-center')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">🔔</div>
            <div class="d6-kpi-trend down" id="d6AlertTrend">▼ 0</div>
          </div>
          <div class="d6-kpi-value" id="ds-alert-lowstock">0</div>
          <div class="d6-kpi-label">تنبيهات</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6AlertSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card inventory" onclick="showPage('products')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">📦</div>
            <div class="d6-kpi-trend" id="d6InvTrend">--</div>
          </div>
          <div class="d6-kpi-value" id="ds-products">0</div>
          <div class="d6-kpi-label">المنتجات</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6InvSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card users" onclick="showPage('audit')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">👤</div>
            <div class="d6-kpi-trend" id="d6UsersTrend">▲ 0</div>
          </div>
          <div class="d6-kpi-value" id="ds-audit-users">0</div>
          <div class="d6-kpi-label">نشطين</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6UsersSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card maintenance" onclick="showPage('maintenance')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">🔧</div>
            <div class="d6-kpi-trend" id="d6MaintTrend">--</div>
          </div>
          <div class="d6-kpi-value" id="ds-maint">0</div>
          <div class="d6-kpi-label">صيانة</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6MaintSpark" style="width:0%"></div></div>
        </div>
        <div class="d6-kpi-card installments" onclick="showPage('installments')">
          <div class="d6-kpi-top">
            <div class="d6-kpi-icon">⏰</div>
            <div class="d6-kpi-trend down" id="d6InstTrend">▼ 0</div>
          </div>
          <div class="d6-kpi-value" id="ds-inst-overdue">0</div>
          <div class="d6-kpi-label">أقساط متأخرة</div>
          <div class="d6-kpi-spark"><div class="d6-kpi-spark-bar" id="d6InstSpark" style="width:0%"></div></div>
        </div>
      </div>

      <!-- Quick Actions -->
      <div class="d6-quick-actions">
        <button class="d6-quick-btn" onclick="showPage('pos')">
          <span class="icon">🛒</span> فاتورة بيع
        </button>
        <button class="d6-quick-btn" onclick="showPage('purchases')">
          <span class="icon">📥</span> فاتورة شراء
        </button>
        <button class="d6-quick-btn" onclick="showPage('crm')">
          <span class="icon">👤</span> عميل
        </button>
        <button class="d6-quick-btn" onclick="showPage('products')">
          <span class="icon">📦</span> منتج
        </button>
        <button class="d6-quick-btn" onclick="showPage('maintenance')">
          <span class="icon">🔧</span> صيانة
        </button>
        <button class="d6-quick-btn" onclick="showPage('treasury')">
          <span class="icon">💵</span> تحصيل
        </button>
        <button class="d6-quick-btn" onclick="showPage('expenses')">
          <span class="icon">💸</span> مصروف
        </button>
        <button class="d6-quick-btn" onclick="showPage('reports')">
          <span class="icon">📊</span> تقارير
        </button>
      </div>

      <!-- Charts -->
      <div class="d6-section">
        <div class="d6-section-title">📊 التحليلات <span>مؤشرات الأداء</span></div>
        <div class="d6-section-action" onclick="showPage('reports')">عرض الكل →</div>
      </div>
      <div class="d6-chart-grid">
        <div class="d6-chart-card">
          <div class="d6-chart-header">
            <div class="d6-chart-title">مبيعات الأسبوع</div>
            <div class="d6-chart-badge">7 أيام</div>
          </div>
          <div class="d6-chart-area">
            <canvas id="dashboardSalesChart"></canvas>
          </div>
        </div>
        <div class="d6-chart-card">
          <div class="d6-chart-header">
            <div class="d6-chart-title">الإيرادات vs المصروفات</div>
            <div class="d6-chart-badge">أسبوعي</div>
          </div>
          <div class="d6-chart-area">
            <canvas id="dashboardRevenueChart"></canvas>
          </div>
        </div>
        <div class="d6-chart-card">
          <div class="d6-chart-header">
            <div class="d6-chart-title">أداء المخزون</div>
            <div class="d6-chart-badge">حي</div>
          </div>
          <div class="d6-chart-area">
            <canvas id="dashboardInventoryChart"></canvas>
          </div>
        </div>
      </div>

      <!-- Smart Widgets Row -->
      <div class="d6-section">
        <div class="d6-section-title">🧩 نظرة سريعة <span>معلومات لحظية</span></div>
      </div>
      <div class="d6-widget-row">
        <div class="d6-widget">
          <div class="d6-widget-title">⚠️ أهم التنبيهات</div>
          <div id="d6WidgetAlerts">
            <div class="d6-empty">لا توجد تنبيهات حالياً</div>
          </div>
        </div>
        <div class="d6-widget">
          <div class="d6-widget-title">🏆 الأكثر مبيعاً</div>
          <div id="d6WidgetTopProducts">
            <div class="d6-empty">لا توجد بيانات</div>
          </div>
        </div>
        <div class="d6-widget">
          <div class="d6-widget-title">👥 أفضل العملاء</div>
          <div id="d6WidgetTopCustomers">
            <div class="d6-empty">لا توجد بيانات</div>
          </div>
        </div>
        <div class="d6-widget">
          <div class="d6-widget-title">📋 مهام اليوم</div>
          <div id="d6WidgetTasks">
            <div class="d6-empty">لا توجد مهام</div>
          </div>
        </div>
      </div>

      <!-- Activity Timeline -->
      <div class="d6-section">
        <div class="d6-section-title">🕘 النشاط الأخير <span>آخر العمليات</span></div>
        <div class="d6-section-action" onclick="showPage('audit')">السجل الكامل →</div>
      </div>
      <div class="d6-timeline" id="d6Timeline">
        <div class="d6-empty">لا توجد عمليات حديثة</div>
      </div>

      <!-- Module Grid -->
      <div class="d6-section">
        <div class="d6-section-title">🧩 الوحدات <span>الوصول السريع</span></div>
      </div>
      <div class="d6-modules-grid" id="d6ModulesGrid">
      </div>

      <!-- FAB -->
      <button class="d6-fab" id="d6Fab" onclick="toggleD6Fab()">+</button>
      <div class="d6-fab-menu" id="d6FabMenu">
        <button class="d6-fab-item" onclick="showPage('pos');toggleD6Fab()">
          <span class="icon">🛒</span> فاتورة بيع
        </button>
        <button class="d6-fab-item" onclick="showPage('purchases');toggleD6Fab()">
          <span class="icon">📥</span> فاتورة شراء
        </button>
        <button class="d6-fab-item" onclick="showPage('maintenance');toggleD6Fab()">
          <span class="icon">🔧</span> استلام جهاز
        </button>
        <button class="d6-fab-item" onclick="showPage('crm');toggleD6Fab()">
          <span class="icon">👤</span> عميل جديد
        </button>
      </div>
    </div>`;

// Insert after DASHBOARD comment
const dashComment = content.indexOf('    <!-- DASHBOARD -->');
if (dashComment >= 0) {
  const insertPos = dashComment + '    <!-- DASHBOARD -->'.length;
  content = content.slice(0, insertPos) + '\n' + v6HTML + '\n' + content.slice(insertPos);
  console.log('Inserted V6 HTML after DASHBOARD comment');
} else {
  console.log('DASHBOARD comment not found!');
}

fs.writeFileSync('E:/Projects/ESO/DigiTronics_v5.html', content, 'utf-8');
console.log('File saved. New length:', content.length);
