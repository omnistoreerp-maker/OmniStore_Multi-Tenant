const fs = require('fs');

let content = fs.readFileSync('E:/Projects/ESO/DigiTronics_v5.html', 'utf-8');
const originalLength = content.length;

// ============================================
// STEP 1: REMOVE V5 CSS (lines ~1591 to ~117466 area)
// ============================================
const v5CSSStart = content.indexOf('    /* ===== DASHBOARD V5 ENTERPRISE ===== */');
// Find the end of V5 CSS - the last @media rule
let v5CSSEnd = content.indexOf('@media(max-width:760px){.v5-kpi-grid');
if (v5CSSEnd < 0) v5CSSEnd = content.indexOf('@media(max-width:480px){.v5-kpi-grid');
// Find the closing brace of that media query
if (v5CSSEnd > 0) {
  let braceCount = 0;
  let foundStart = false;
  let pos = v5CSSEnd;
  for (; pos < content.length; pos++) {
    if (content[pos] === '{') { braceCount++; foundStart = true; }
    if (content[pos] === '}') { braceCount--; }
    if (foundStart && braceCount === 0) { pos++; break; }
  }
  v5CSSEnd = pos;
}

if (v5CSSStart >= 0 && v5CSSEnd > v5CSSStart) {
  content = content.slice(0, v5CSSStart) + content.slice(v5CSSEnd);
  console.log('Removed V5 CSS, bytes:', v5CSSEnd - v5CSSStart);
} else {
  console.log('V5 CSS not found or already removed');
}

// ============================================
// STEP 2: REMOVE V5 HTML
// ============================================
const v5HTMLStart = content.indexOf('<div class="page" id="page-dashboard">');
const v5HTMLEnd = content.indexOf('<!-- SMART BUSINESS INTELLIGENCE -->');

if (v5HTMLStart >= 0 && v5HTMLEnd > v5HTMLStart) {
  content = content.slice(0, v5HTMLStart) + content.slice(v5HTMLEnd);
  console.log('Removed V5 HTML, bytes:', v5HTMLEnd - v5HTMLStart);
} else {
  console.log('V5 HTML not found');
}

// ============================================
// STEP 3: REMOVE V5 JS - renderDashboard function
// ============================================
const renderDashStart = content.indexOf('function renderDashboard() {');
const renderDashEnd = content.indexOf('// Render sales chart on dashboard');

if (renderDashStart >= 0 && renderDashEnd > renderDashStart) {
  content = content.slice(0, renderDashStart) + content.slice(renderDashEnd);
  console.log('Removed old renderDashboard');
} else {
  console.log('renderDashboard not found');
}

// ============================================
// STEP 4: REMOVE safeShowPage
// ============================================
const safeShowStart = content.indexOf('function safeShowPage(page)');
if (safeShowStart >= 0) {
  let braceCount = 0;
  let foundStart = false;
  let pos = safeShowStart;
  for (; pos < content.length; pos++) {
    if (content[pos] === '{') { braceCount++; foundStart = true; }
    if (content[pos] === '}') { braceCount--; }
    if (foundStart && braceCount === 0) { pos++; break; }
  }
  // Include the newline after
  if (content[pos] === '\n') pos++;
  content = content.slice(0, safeShowStart) + content.slice(pos);
  console.log('Removed safeShowPage');
}

// ============================================
// STEP 5: REMOVE new chart functions
// ============================================
const revChartStart = content.indexOf('function renderDashboardRevenueChart()');
const cashChartStart = content.indexOf('function renderDashboardCashChart()');

if (revChartStart >= 0 && cashChartStart > revChartStart) {
  let braceCount = 0;
  let foundStart = false;
  let pos = cashChartStart;
  for (; pos < content.length; pos++) {
    if (content[pos] === '{') { braceCount++; foundStart = true; }
    if (content[pos] === '}') { braceCount--; }
    if (foundStart && braceCount === 0) { pos++; break; }
  }
  // Include the newline after
  if (content[pos] === '\n') pos++;
  content = content.slice(0, revChartStart) + content.slice(pos);
  console.log('Removed new chart functions');
}

// ============================================
// STEP 6: REMOVE any remaining v5- class references in old CSS
// ============================================
// Check if there are any remaining v5- references
const v5Refs = (content.match(/\.v5-/g) || []).length;
console.log('Remaining v5- references:', v5Refs);

// ============================================
// STEP 7: INSERT V6 CSS before </style> in main style block
// ============================================
const v6CSS = `
    /* ===== DASHBOARD V6 ENTERPRISE ===== */
    .d6{--d6-bg:var(--bg);--d6-surface:var(--surface);--d6-surface2:var(--surface2);--d6-border:var(--border);--d6-text:var(--text);--d6-text2:var(--text2);--d6-muted:var(--muted);--d6-accent:var(--accent);--d6-green:var(--green);--d6-red:var(--red);--d6-yellow:var(--yellow);--d6-purple:var(--purple);--d6-orange:var(--orange);--d6-teal:var(--teal);--d6-sky:var(--sky)}
    .d6-header{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;background:linear-gradient(135deg,rgba(255,255,255,.92) 0%,rgba(238,244,251,.95) 100%);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid var(--d6-border);position:sticky;top:0;z-index:100;gap:12px;flex-wrap:wrap;box-shadow:0 1px 8px rgba(15,23,42,.06)}
    .d6-header-left{display:flex;align-items:center;gap:14px;flex:1;min-width:0}
    .d6-logo{font-size:1.15rem;font-weight:900;color:var(--d6-accent);letter-spacing:-.3px;display:flex;align-items:center;gap:6px}
    .d6-logo-icon{width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,var(--d6-accent),var(--d6-sky));display:grid;place-items:center;color:#fff;font-size:.9rem}
    .d6-header-center{display:flex;align-items:center;gap:8px;flex:1;justify-content:center;max-width:400px}
    .d6-search{position:relative;flex:1;max-width:320px}
    .d6-search input{width:100%;padding:8px 14px 8px 36px;border-radius:12px;border:1px solid var(--d6-border);background:rgba(255,255,255,.7);font-size:.78rem;font-family:inherit;outline:none;transition:all .2s}
    .d6-search input:focus{border-color:var(--d6-accent);box-shadow:0 0 0 3px rgba(37,99,235,.1)}
    .d6-search::before{content:'🔍';position:absolute;left:12px;top:50%;transform:translateY(-50%);font-size:.8rem;opacity:.5}
    .d6-header-right{display:flex;align-items:center;gap:8px}
    .d6-header-btn{position:relative;width:36px;height:36px;border-radius:10px;border:1px solid var(--d6-border);background:rgba(255,255,255,.7);display:grid;place-items:center;cursor:pointer;transition:all .2s;font-size:1rem}
    .d6-header-btn:hover{background:var(--d6-accent);color:#fff;border-color:var(--d6-accent);transform:translateY(-1px)}
    .d6-header-btn .badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;background:var(--d6-red);color:#fff;font-size:.6rem;font-weight:800;display:grid;place-items:center;padding:0 4px}
    .d6-header-btn.profile{width:auto;padding:4px 10px 4px 4px;display:flex;align-items:center;gap:6px;font-size:.75rem;font-weight:600;color:var(--d6-text2)}
    .d6-header-btn.profile .avatar{width:28px;height:28px;border-radius:8px;background:linear-gradient(135deg,var(--d6-accent),var(--d6-purple));color:#fff;display:grid;place-items:center;font-size:.7rem;font-weight:700}
    .d6-clock{font-size:.72rem;color:var(--d6-muted);font-weight:500;direction:ltr}
    .d6-connection{display:flex;align-items:center;gap:4px;font-size:.68rem;color:var(--d6-green);font-weight:600}
    .d6-connection.offline{color:var(--d6-red)}
    .d6-kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;padding:16px 20px}
    .d6-kpi-card{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:14px;padding:14px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04);transition:all .25s cubic-bezier(.4,0,.2,1);position:relative;overflow:hidden;cursor:pointer}
    .d6-kpi-card:hover{transform:translateY(-3px);box-shadow:0 8px 24px rgba(15,23,42,.1);border-color:rgba(37,99,235,.2)}
    .d6-kpi-card::after{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:14px 14px 0 0;opacity:.8}
    .d6-kpi-card.sales::after{background:linear-gradient(90deg,var(--d6-green),#22c55e)}
    .d6-kpi-card.profit::after{background:linear-gradient(90deg,var(--d6-accent),#3b82f6)}
    .d6-kpi-card.cash::after{background:linear-gradient(90deg,var(--d6-sky),#38bdf8)}
    .d6-kpi-card.alerts::after{background:linear-gradient(90deg,var(--d6-red),#f87171)}
    .d6-kpi-card.inventory::after{background:linear-gradient(90deg,var(--d6-purple),#a78bfa)}
    .d6-kpi-card.users::after{background:linear-gradient(90deg,var(--d6-orange),#fb923c)}
    .d6-kpi-card.maintenance::after{background:linear-gradient(90deg,var(--d6-yellow),#fbbf24)}
    .d6-kpi-card.installments::after{background:linear-gradient(90deg,var(--d6-teal),#2dd4bf)}
    .d6-kpi-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}
    .d6-kpi-icon{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;font-size:1rem;background:rgba(37,99,235,.08)}
    .d6-kpi-trend{font-size:.62rem;font-weight:700;padding:2px 6px;border-radius:10px;background:rgba(22,163,74,.1);color:var(--d6-green)}
    .d6-kpi-trend.down{background:rgba(220,38,38,.1);color:var(--d6-red)}
    .d6-kpi-value{font-size:1.2rem;font-weight:800;color:var(--d6-text);line-height:1.1;margin-bottom:2px}
    .d6-kpi-label{font-size:.68rem;color:var(--d6-muted);font-weight:500}
    .d6-kpi-spark{height:3px;border-radius:2px;background:rgba(215,227,242,.5);margin-top:8px;overflow:hidden}
    .d6-kpi-spark-bar{height:100%;border-radius:2px;background:var(--d6-accent);transition:width .6s ease}
    .d6-section{display:flex;align-items:center;justify-content:space-between;padding:0 20px;margin:16px 0 10px}
    .d6-section-title{font-size:.82rem;font-weight:800;color:var(--d6-text);display:flex;align-items:center;gap:6px}
    .d6-section-title span{font-size:.68rem;color:var(--d6-muted);font-weight:500}
    .d6-section-action{font-size:.68rem;color:var(--d6-accent);font-weight:600;cursor:pointer;padding:4px 10px;border-radius:8px;background:rgba(37,99,235,.08);transition:all .2s}
    .d6-section-action:hover{background:var(--d6-accent);color:#fff}
    .d6-chart-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:12px;padding:0 20px 16px}
    .d6-chart-card{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:16px;padding:16px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04);transition:all .2s}
    .d6-chart-card:hover{box-shadow:0 6px 20px rgba(15,23,42,.08)}
    .d6-chart-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    .d6-chart-title{font-size:.78rem;font-weight:700;color:var(--d6-text)}
    .d6-chart-badge{font-size:.6rem;font-weight:700;padding:2px 8px;border-radius:10px;background:rgba(37,99,235,.08);color:var(--d6-accent)}
    .d6-chart-area{height:200px;position:relative}
    .d6-chart-empty{display:grid;place-items:center;height:200px;color:var(--d6-muted);font-size:.75rem}
    .d6-timeline{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:16px;padding:16px;margin:0 20px 16px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04)}
    .d6-timeline-item{display:flex;gap:12px;padding:10px 0;border-bottom:1px solid rgba(215,227,242,.4);font-size:.75rem;transition:all .2s;cursor:pointer}
    .d6-timeline-item:hover{background:rgba(37,99,235,.02);margin:0 -16px;padding:10px 16px;border-radius:8px}
    .d6-timeline-item:last-child{border-bottom:none}
    .d6-timeline-dot{width:8px;height:8px;border-radius:50%;margin-top:5px;flex-shrink:0;position:relative}
    .d6-timeline-dot::after{content:'';position:absolute;top:10px;left:3px;width:2px;height:calc(100% + 8px);background:rgba(215,227,242,.5)}
    .d6-timeline-item:last-child .d6-timeline-dot::after{display:none}
    .d6-timeline-content{flex:1;min-width:0}
    .d6-timeline-title{font-weight:700;color:var(--d6-text);font-size:.78rem;margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .d6-timeline-meta{color:var(--d6-muted);font-size:.65rem;display:flex;gap:8px;flex-wrap:wrap}
    .d6-alerts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;padding:0 20px 16px}
    .d6-alert-card{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:14px;padding:14px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04);display:flex;align-items:center;gap:12px;transition:all .2s;cursor:pointer}
    .d6-alert-card:hover{transform:translateX(-3px);box-shadow:0 4px 16px rgba(15,23,42,.08)}
    .d6-alert-card.critical{border-right:3px solid var(--d6-red)}
    .d6-alert-card.warning{border-right:3px solid var(--d6-yellow)}
    .d6-alert-card.info{border-right:3px solid var(--d6-accent)}
    .d6-alert-icon{width:36px;height:36px;border-radius:10px;display:grid;place-items:center;font-size:1rem;flex-shrink:0;background:rgba(37,99,235,.08)}
    .d6-alert-icon.critical{background:rgba(220,38,38,.1);color:var(--d6-red)}
    .d6-alert-icon.warning{background:rgba(245,158,11,.1);color:var(--d6-yellow)}
    .d6-alert-icon.info{background:rgba(37,99,235,.1);color:var(--d6-accent)}
    .d6-alert-text{flex:1;min-width:0}
    .d6-alert-title{font-weight:700;font-size:.76rem;color:var(--d6-text);margin-bottom:2px}
    .d6-alert-desc{font-size:.68rem;color:var(--d6-muted)}
    .d6-alert-time{font-size:.62rem;color:var(--d6-muted);white-space:nowrap;flex-shrink:0}
    .d6-quick-actions{display:flex;gap:8px;padding:0 20px 16px;overflow-x:auto;scrollbar-width:none}
    .d6-quick-actions::-webkit-scrollbar{display:none}
    .d6-quick-btn{flex-shrink:0;display:flex;align-items:center;gap:6px;padding:10px 16px;border-radius:12px;border:1px solid rgba(215,227,242,.6);background:rgba(255,255,255,.8);color:var(--d6-text2);font-size:.72rem;font-weight:700;cursor:pointer;transition:all .2s;white-space:nowrap}
    .d6-quick-btn:hover{background:var(--d6-accent);color:#fff;border-color:var(--d6-accent);transform:translateY(-2px);box-shadow:0 4px 12px rgba(37,99,235,.2)}
    .d6-quick-btn .icon{font-size:1.1rem}
    .d6-modules-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;padding:0 20px 20px}
    .d6-module-tile{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:16px;padding:16px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04);transition:all .25s cubic-bezier(.4,0,.2,1);cursor:pointer;position:relative;overflow:hidden}
    .d6-module-tile:hover{transform:translateY(-4px) scale(1.01);box-shadow:0 12px 32px rgba(15,23,42,.12);border-color:rgba(37,99,235,.15)}
    .d6-module-tile::before{content:'';position:absolute;top:0;right:0;width:60px;height:60px;border-radius:0 0 0 60px;opacity:.06}
    .d6-module-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}
    .d6-module-icon{width:40px;height:40px;border-radius:12px;display:grid;place-items:center;font-size:1.2rem;background:linear-gradient(135deg,rgba(37,99,235,.1),rgba(37,99,235,.05))}
    .d6-module-title{font-size:.82rem;font-weight:800;color:var(--d6-text)}
    .d6-module-desc{font-size:.68rem;color:var(--d6-muted);margin-bottom:10px;line-height:1.5}
    .d6-module-metrics{display:flex;gap:12px;font-size:.65rem;color:var(--d6-text2)}
    .d6-module-metric{display:flex;align-items:center;gap:3px}
    .d6-module-metric strong{color:var(--d6-text);font-weight:700}
    .d6-empty{display:grid;place-items:center;padding:20px;color:var(--d6-muted);font-size:.75rem;text-align:center}
    .d6-skeleton{background:linear-gradient(90deg,rgba(215,227,242,.5) 25%,rgba(238,244,251,.8) 50%,rgba(215,227,242,.5) 75%);background-size:200% 100%;animation:d6-skel 1.5s infinite;border-radius:8px}
    @keyframes d6-skel{0%{background-position:200% 0}100%{background-position:-200% 0}}
    .d6-fab{position:fixed;bottom:24px;left:24px;width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,var(--d6-accent),var(--d6-sky));color:#fff;border:none;box-shadow:0 4px 20px rgba(37,99,235,.35);display:grid;place-items:center;font-size:1.5rem;cursor:pointer;z-index:90;transition:all .3s cubic-bezier(.4,0,.2,1)}
    .d6-fab:hover{transform:scale(1.1) rotate(90deg);box-shadow:0 6px 28px rgba(37,99,235,.45)}
    .d6-fab-menu{position:fixed;bottom:88px;left:24px;display:flex;flex-direction:column;gap:8px;z-index:89;opacity:0;transform:translateY(20px);pointer-events:none;transition:all .3s cubic-bezier(.4,0,.2,1)}
    .d6-fab-menu.open{opacity:1;transform:translateY(0);pointer-events:auto}
    .d6-fab-item{display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:12px;background:rgba(255,255,255,.95);backdrop-filter:blur(12px);border:1px solid var(--d6-border);box-shadow:0 4px 16px rgba(15,23,42,.1);font-size:.72rem;font-weight:700;color:var(--d6-text);cursor:pointer;transition:all .2s;white-space:nowrap}
    .d6-fab-item:hover{background:var(--d6-accent);color:#fff}
    .d6-fab-item .icon{font-size:1.1rem}
    .d6-widget-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;padding:0 20px 16px}
    .d6-widget{background:rgba(255,255,255,.85);backdrop-filter:blur(12px);border-radius:14px;padding:14px;border:1px solid rgba(215,227,242,.6);box-shadow:0 2px 8px rgba(15,23,42,.04)}
    .d6-widget-title{font-size:.72rem;font-weight:700;color:var(--d6-text);margin-bottom:10px;display:flex;align-items:center;gap:6px}
    .d6-widget-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(215,227,242,.3);font-size:.72rem}
    .d6-widget-item:last-child{border-bottom:none;padding-bottom:0}
    .d6-widget-item:first-child{padding-top:0}
    .d6-widget-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0}
    .d6-widget-text{flex:1;color:var(--d6-text2)}
    .d6-widget-value{font-size:.68rem;color:var(--d6-muted);white-space:nowrap}
    @media(max-width:900px){.d6-chart-grid{grid-template-columns:1fr}.d6-kpi-grid{grid-template-columns:repeat(3,1fr)}.d6-modules-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:640px){.d6-kpi-grid{grid-template-columns:repeat(2,1fr);padding:12px}.d6-header-center{display:none}.d6-modules-grid{grid-template-columns:1fr}.d6-chart-grid{padding:0 12px 12px}.d6-timeline{margin:0 12px 12px}.d6-quick-actions{padding:0 12px 12px}.d6-alerts-grid{padding:0 12px 12px}.d6-widget-row{padding:0 12px 12px}.d6-section{padding:0 12px}}
    @media(max-width:400px){.d6-kpi-grid{grid-template-columns:1fr}}
`;

const styleEndIdx = content.indexOf('  </style>\n  <nav class="sidebar"');
if (styleEndIdx >= 0) {
  content = content.slice(0, styleEndIdx) + v6CSS + '\n' + content.slice(styleEndIdx);
  console.log('Inserted V6 CSS');
} else {
  console.log('WARNING: CSS insertion point not found');
}

// ============================================
// STEP 8: INSERT V6 HTML
// ============================================
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
        <!-- Populated by JS -->
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

const dashHTMLStart = content.indexOf('<div class="page" id="page-dashboard">');
const dashHTMLEnd = content.indexOf('<!-- SMART BUSINESS INTELLIGENCE -->');

if (dashHTMLStart >= 0 && dashHTMLEnd > dashHTMLStart) {
  content = content.slice(0, dashHTMLStart) + v6HTML + '\n    <!-- SMART BUSINESS INTELLIGENCE -->' + content.slice(dashHTMLEnd + '<!-- SMART BUSINESS INTELLIGENCE -->'.length);
  console.log('Inserted V6 HTML');
} else {
  console.log('WARNING: Could not find dashboard HTML boundaries');
}

// ============================================
// STEP 9: INSERT V6 renderDashboard JS
// ============================================
const v6RenderDashboard = `function renderDashboard() {
  const dashboardVersionKey = getDataVersionKey('dashboard');
  const today = new Date();
  const todayInvoices = DB.saleInvoices.filter(inv => isToday(inv.date));
  
  const todaySales = todayInvoices.reduce((sum, inv) => sum + getNetInvoiceTotal(inv), 0);
  const todayProfit = todayInvoices.reduce((sum, inv) => sum + getNetInvoiceProfit(inv), 0);
  const todayExpenses = DB.expenses.filter(e => isToday(e.date)).reduce((sum, e) => sum + (e.amount || 0), 0);
  const totalProducts = DB.products.length;
  const lowStock = DB.products.filter(p => getProductStock(p.id) <= (p.minStock || 5)).length;
  const treasuryBalance = getTreasurySummary().total;
  const maintPending = DB.maintenance.filter(m => m.status === 'pending').length;
  
  const setD6 = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value; };
  const setSpark = (id, pct, color) => { const el = document.getElementById(id); if (el) { el.style.width = pct + '%'; el.style.background = color || 'var(--d6-accent)'; } };
  
  setD6('ds-sales', formatMoney(todaySales));
  setD6('ds-profit', maskMoneyIfRestricted(todayProfit));
  setD6('ds-treasury', formatMoney(treasuryBalance));
  setD6('ds-alert-lowstock', lowStock);
  setD6('ds-products', totalProducts);
  setD6('ds-maint', maintPending);
  
  const activeUsers = new Set(getVisibleAuditEntries().filter(e => String(e.timestamp || '').slice(0,10) === today.toISOString().slice(0,10)).map(e => e.username || '-')).size;
  setD6('ds-audit-users', activeUsers);
  
  try {
    normalizeAllInstallments();
    const instToday = localDateString();
    const visibleInst = (DB.installments || []).filter(i => can('all') || canSeeBranch(i.branchId || 'MAIN'));
    const overdue = visibleInst.reduce((s, i) => s + getInstallmentDueStats(i, instToday).overdue, 0);
    setD6('ds-inst-overdue', overdue);
    setSpark('d6InstSpark', Math.min(overdue * 10, 100), 'var(--d6-teal)');
  } catch(e) {}
  
  // Update sparks
  setSpark('d6SalesSpark', Math.min((todaySales / 10000) * 100, 100), 'var(--d6-green)');
  setSpark('d6ProfitSpark', Math.min((todayProfit / 5000) * 100, 100), 'var(--d6-accent)');
  setSpark('d6CashSpark', Math.min((treasuryBalance / 50000) * 100, 100), 'var(--d6-sky)');
  setSpark('d6AlertSpark', Math.min(lowStock * 20, 100), 'var(--d6-red)');
  setSpark('d6InvSpark', Math.min((totalProducts / 500) * 100, 100), 'var(--d6-purple)');
  setSpark('d6UsersSpark', Math.min(activeUsers * 20, 100), 'var(--d6-orange)');
  setSpark('d6MaintSpark', Math.min(maintPending * 15, 100), 'var(--d6-yellow)');
  
  // Header
  const clockEl = document.getElementById('d6Clock');
  if (clockEl) clockEl.textContent = today.toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
  
  const avatarEl = document.getElementById('d6HeaderAvatar');
  if (avatarEl && currentUser) avatarEl.textContent = (currentUser.name || currentUser.username || 'A').charAt(0).toUpperCase();
  
  const userEl = document.getElementById('d6HeaderUser');
  if (userEl && currentUser) userEl.textContent = currentUser.name || currentUser.username || 'Admin';
  
  const badgeEl = document.getElementById('d6AlertBadge');
  if (badgeEl) badgeEl.textContent = lowStock + maintPending;
  
  // Smart Alerts Panel
  try {
    const smartAlerts = getCachedComputation('dashboard:smartAlerts', dashboardVersionKey, () => buildSmartAlerts());
    const alertsPanel = document.getElementById('d6WidgetAlerts');
    if (alertsPanel) {
      if (smartAlerts.length === 0) {
        alertsPanel.innerHTML = '<div class="d6-empty">لا توجد تنبيهات حالياً</div>';
      } else {
        alertsPanel.innerHTML = smartAlerts.slice(0, 5).map(a => {
          const cls = a.level === 'critical' ? 'critical' : a.level === 'warning' ? 'warning' : 'info';
          const icon = a.level === 'critical' ? '⚠️' : a.level === 'warning' ? '⏳' : 'ℹ️';
          return '<div class="d6-alert-card ' + cls + '"><div class="d6-alert-icon ' + cls + '">' + icon + '</div><div class="d6-alert-text"><div class="d6-alert-title">' + a.title + '</div><div class="d6-alert-desc">' + a.text + '</div></div><div class="d6-alert-time">' + (a.time || '') + '</div></div>';
        }).join('');
      }
    }
  } catch(e) {}
  
  // Timeline
  try {
    const timeline = document.getElementById('d6Timeline');
    if (timeline) {
      const entries = [];
      todayInvoices.slice(0, 6).forEach(inv => {
        entries.push({ title: 'فاتورة بيع #' + inv.id, meta: (inv.items ? inv.items.length : 0) + ' صنف · ' + formatMoney(getNetInvoiceTotal(inv)) + ' · ' + (inv.user || '-'), icon: '🛒', time: new Date(inv.date).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}), color: 'var(--d6-green)' });
      });
      DB.maintenance.filter(m => m.status === 'pending').slice(0, 4).forEach(m => {
        entries.push({ title: 'صيانة: ' + (m.deviceName || m.deviceSerial || '-'), meta: (m.customerName || '-') + ' · ' + (m.issue || '-'), icon: '🔧', time: m.date ? new Date(m.date).toLocaleDateString('ar-EG') : '', color: 'var(--d6-yellow)' });
      });
      DB.purchaseInvoices.filter(inv => isToday(inv.date)).slice(0, 3).forEach(inv => {
        entries.push({ title: 'فاتورة شراء #' + inv.id, meta: (inv.supplierName || '-') + ' · ' + formatMoney(inv.total || 0), icon: '📥', time: new Date(inv.date).toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'}), color: 'var(--d6-sky)' });
      });
      if (entries.length === 0) {
        timeline.innerHTML = '<div class="d6-empty">لا توجد عمليات حديثة</div>';
      } else {
        timeline.innerHTML = entries.map(e => '<div class="d6-timeline-item"><div class="d6-timeline-dot" style="background:' + e.color + '"></div><div class="d6-timeline-content"><div class="d6-timeline-title">' + e.icon + ' ' + e.title + '</div><div class="d6-timeline-meta">' + e.meta + ' · ' + e.time + '</div></div></div>').join('');
      }
    }
  } catch(e) {}
  
  // Top Products
  try {
    const topProd = document.getElementById('d6WidgetTopProducts');
    if (topProd) {
      const productSales = {};
      DB.saleInvoices.forEach(inv => {
        (inv.items || []).forEach(item => {
          const pid = item.productId || item.id;
          if (pid) productSales[pid] = (productSales[pid] || 0) + (item.qty || 1);
        });
      });
      const sorted = Object.entries(productSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (sorted.length === 0) {
        topProd.innerHTML = '<div class="d6-empty">لا توجد بيانات</div>';
      } else {
        topProd.innerHTML = sorted.map(([pid, qty], i) => {
          const p = DB.products.find(x => String(x.id) === String(pid));
          const name = p ? p.name : 'منتج #' + pid;
          const colors = ['var(--d6-green)', 'var(--d6-accent)', 'var(--d6-sky)', 'var(--d6-purple)', 'var(--d6-orange)'];
          return '<div class="d6-widget-item"><div class="d6-widget-dot" style="background:' + colors[i % colors.length] + '"></div><div class="d6-widget-text">' + name + '</div><div class="d6-widget-value">' + qty + ' مباع</div></div>';
        }).join('');
      }
    }
  } catch(e) {}
  
  // Top Customers
  try {
    const topCust = document.getElementById('d6WidgetTopCustomers');
    if (topCust) {
      const custSales = {};
      DB.saleInvoices.forEach(inv => {
        const cid = inv.customerId || inv.customer?.id;
        if (cid) custSales[cid] = (custSales[cid] || 0) + getNetInvoiceTotal(inv);
      });
      const sorted = Object.entries(custSales).sort((a, b) => b[1] - a[1]).slice(0, 5);
      if (sorted.length === 0) {
        topCust.innerHTML = '<div class="d6-empty">لا توجد بيانات</div>';
      } else {
        topCust.innerHTML = sorted.map(([cid, total], i) => {
          const c = DB.customers.find(x => String(x.id) === String(cid));
          const name = c ? c.name : 'عميل #' + cid;
          const colors = ['var(--d6-green)', 'var(--d6-accent)', 'var(--d6-sky)', 'var(--d6-purple)', 'var(--d6-orange)'];
          return '<div class="d6-widget-item"><div class="d6-widget-dot" style="background:' + colors[i % colors.length] + '"></div><div class="d6-widget-text">' + name + '</div><div class="d6-widget-value">' + formatMoney(total) + '</div></div>';
        }).join('');
      }
    }
  } catch(e) {}
  
  // Module Grid
  try {
    const modulesGrid = document.getElementById('d6ModulesGrid');
    if (modulesGrid) {
      const modules = [
        { id: 'sales', title: 'المبيعات', desc: 'فواتير البيع والمردودات', icon: '🛒', color: 'linear-gradient(135deg,#16a34a,#22c55e)', metrics: [{l:'اليوم',v:formatMoney(todaySales)},{l:'الفواتير',v:todayInvoices.length}] },
        { id: 'purchases', title: 'المشتريات', desc: 'فواتير الشراء والموردين', icon: '📥', color: 'linear-gradient(135deg,#0284c7,#38bdf8)', metrics: [{l:'المشتريات',v:(DB.purchaseInvoices||[]).length},{l:'الموردين',v:(DB.suppliers||[]).length}] },
        { id: 'inventory', title: 'المخزون', desc: 'المنتجات والتنبيهات', icon: '📦', color: 'linear-gradient(135deg,#7c3aed,#a78bfa)', metrics: [{l:'المنتجات',v:totalProducts},{l:'منخفض',v:lowStock}] },
        { id: 'finance', title: 'المالية', desc: 'الخزينة والتقارير', icon: '🏦', color: 'linear-gradient(135deg,#2563eb,#3b82f6)', metrics: [{l:'الرصيد',v:formatMoney(treasuryBalance)},{l:'المصروفات',v:formatMoney(todayExpenses)}] },
        { id: 'maintenance', title: 'الصيانة', desc: 'طلبات الصيانة والضمان', icon: '🔧', color: 'linear-gradient(135deg,#d97706,#fbbf24)', metrics: [{l:'معلقة',v:maintPending},{l:'الأجهزة',v:(DB.devices||[]).length}] },
        { id: 'customers', title: 'العملاء', desc: 'قاعدة العملاء والولاء', icon: '👤', color: 'linear-gradient(135deg,#ea580c,#fb923c)', metrics: [{l:'العملاء',v:(DB.customers||[]).length},{l:'الجديد',v:(DB.customers||[]).filter(c=>{const d=new Date(c.registrationDate||c.createdAt||c.id||0);return !isNaN(d.getTime())&&d>=new Date(today.getFullYear(),today.getMonth(),1);}).length}] },
        { id: 'employees', title: 'الموظفين', desc: 'الحضور والرواتب', icon: '👨‍💼', color: 'linear-gradient(135deg,#0f9f9a,#2dd4bf)', metrics: [{l:'الموظفين',v:(DB.employees||[]).length},{l:'الحضور',v:'-'}] },
        { id: 'reports', title: 'التقارير', desc: 'التقارير والتحليلات', icon: '📊', color: 'linear-gradient(135deg,#4f46e5,#818cf8)', metrics: [{l:'التقارير',v:'متاح'},{l:'التحليلات',v:'متاح'}] },
        { id: 'settings', title: 'الإعدادات', desc: 'إعدادات النظام', icon: '⚙️', color: 'linear-gradient(135deg,#64748b,#94a3b8)', metrics: [{l:'الفروع',v:(DB.branches||[]).length},{l:'المستخدمين',v:(DB.users||[]).length}] },
        { id: 'analytics', title: 'التحليلات', desc: 'الذكاء التجاري', icon: '💡', color: 'linear-gradient(135deg,#059669,#34d399)', metrics: [{l:'التحليلات',v:'متاح'},{l:'التنبؤات',v:'متاح'}] }
      ];
      modulesGrid.innerHTML = modules.map(m => '<div class="d6-module-tile" onclick="showPage(\'' + m.id + '\')" style="--tile-accent:' + m.color + '"><div class="d6-module-top"><div class="d6-module-icon" style="background:' + m.color + ';color:#fff">' + m.icon + '</div><div class="d6-module-title">' + m.title + '</div></div><div class="d6-module-desc">' + m.desc + '</div><div class="d6-module-metrics">' + m.metrics.map(me => '<div class="d6-module-metric"><span>' + me.l + ':</span> <strong>' + me.v + '</strong></div>').join('') + '</div></div>').join('');
    }
  } catch(e) {}
  
  updateAlertsBell();
  try { renderDashboardSalesChart(); } catch(e) {}
  try { renderDashboardRevenueChart(); } catch(e) {}
  try { renderDashboardInventoryChart(); } catch(e) {}
}

function toggleD6Fab() {
  const menu = document.getElementById('d6FabMenu');
  if (menu) menu.classList.toggle('open');
}

function renderDashboardRevenueChart() {
  const ctx = document.getElementById('dashboardRevenueChart');
  if (!ctx) return;
  if (window._dashboardRevenueChart) window._dashboardRevenueChart.destroy();
  const days = 7, labels = [], revenue = [], expenses = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    const ds = d.toISOString().slice(0, 10);
    labels.push(d.toLocaleDateString('ar-EG', {weekday:'short'}));
    revenue.push((DB.saleInvoices || []).filter(inv => inv.date && inv.date.slice(0, 10) === ds).reduce((s, inv) => s + getNetInvoiceTotal(inv), 0));
    expenses.push((DB.expenses || []).filter(e => e.date && e.date.slice(0, 10) === ds).reduce((s, e) => s + (e.amount || 0), 0));
  }
  window._dashboardRevenueChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [
      { label: 'إيرادات', data: revenue, backgroundColor: 'rgba(37,99,235,0.25)', borderColor: 'rgba(37,99,235,1)', borderWidth: 2, borderRadius: 6 },
      { label: 'مصروفات', data: expenses, backgroundColor: 'rgba(220,38,38,0.15)', borderColor: 'rgba(220,38,38,1)', borderWidth: 2, borderRadius: 6 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 10 } } } }, scales: { y: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, x: { grid: { display: false } } } }
  });
}

function renderDashboardInventoryChart() {
  const ctx = document.getElementById('dashboardInventoryChart');
  if (!ctx) return;
  if (window._dashboardInventoryChart) window._dashboardInventoryChart.destroy();
  const products = DB.products.slice(0, 8);
  const labels = products.map(p => (p.name || 'P' + p.id).slice(0, 12));
  const data = products.map(p => getProductStock(p.id));
  window._dashboardInventoryChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: 'المخزون', data: data, backgroundColor: products.map((_, i) => 'hsla(' + (200 + i * 20) + ',70%,55%,0.7)'), borderRadius: 6 }] },
    options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(0,0,0,0.04)' } }, y: { grid: { display: false } } } }
  });
}
`;

const renderDashStart2 = content.indexOf('// Render sales chart on dashboard');
if (renderDashStart2 >= 0) {
  content = content.slice(0, renderDashStart2) + v6RenderDashboard + '\n' + content.slice(renderDashStart2);
  console.log('Inserted V6 renderDashboard');
} else {
  console.log('WARNING: Could not find insertion point for renderDashboard');
}

// ============================================
// STEP 10: Remove any remaining v5- references
// ============================================
const remainingV5 = (content.match(/\.v5-/g) || []).length;
console.log('Remaining v5- CSS references:', remainingV5);

// ============================================
// STEP 11: Update clock periodically
// ============================================
const clockUpdate = `
// Dashboard V6 clock updater
setInterval(() => {
  const el = document.getElementById('d6Clock');
  if (el) el.textContent = new Date().toLocaleTimeString('ar-EG', {hour:'2-digit', minute:'2-digit'});
}, 30000);
`;

// Find a good place to insert - after the last function or before closing script
const lastScriptEnd = content.lastIndexOf('</script>');
if (lastScriptEnd > 0) {
  content = content.slice(0, lastScriptEnd) + clockUpdate + '\n' + content.slice(lastScriptEnd);
  console.log('Inserted clock updater');
}

// ============================================
// STEP 12: Write file
// ============================================
fs.writeFileSync('E:/Projects/ESO/DigiTronics_v5.html', content, 'utf-8');
console.log('Done. Original:', originalLength, 'New:', content.length, 'Diff:', content.length - originalLength);
