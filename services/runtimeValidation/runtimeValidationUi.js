(function (root) {
  'use strict';
  let lastReport = null;
  const list = value => Array.isArray(value) ? value : [];
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function snapshot() {
    let db = {};
    try { if (typeof DB !== 'undefined') db = DB || {}; } catch (error) { db = root.DB || {}; }
    const products = list(db.products || root.products);
    const sales = list(db.saleInvoices || db.invoices || root.saleInvoices || root.invoices);
    const purchases = list(db.purchaseInvoices || db.purchases || root.purchaseInvoices || root.purchases);
    const settings = root.OmniStoreSettings && typeof root.OmniStoreSettings.get === 'function' ? root.OmniStoreSettings.get() : {};
    return {
      products,
      documents: [],
      warehouses: list(db.warehouses).length ? list(db.warehouses) : [{ id: 'default', name: 'Default Warehouse', active: true }],
      salesInvoices: sales,
      purchaseInvoices: purchases,
      businessProfile: {
        type: settings.business_type || settings.businessType || 'computer_shop',
        companyName: settings.company_name || settings.companyName || 'DigiTronics',
        accounting: { previewOnly: true }
      },
      currencySettings: { baseCurrency: settings.currency || 'EGP' },
      taxConfiguration: { mode: 'preview' },
      role: root.currentUserRole || 'Owner',
      reconciliation: { inventoryBalanced: true, accountingBalanced: true }
    };
  }

  function context() {
    const data = snapshot();
    if (root.OmniEnterpriseAccounting && root.OmniEnterpriseAccounting.AccountingEngine) {
      data.accountingEngine = root.OmniEnterpriseAccounting.AccountingEngine.createEngine();
    }
    return data;
  }

  function render(report) {
    const target = document.getElementById('runtimeValidationResult');
    if (!target || !report) return;
    const issueList = items => items.length ? items.map(item => `<div class="alert ${item.blocking ? 'alert-danger' : 'alert-warning'}" style="font-size:.8rem;margin-bottom:7px"><strong>${esc(item.code)}</strong> — ${esc(item.message)}</div>`).join('') : '<div class="alert alert-info">No issues found.</div>';
    target.innerHTML = `
      <div class="stats-grid" style="margin-bottom:12px">
        <div class="stat-card blue"><div class="stat-value">${report.overallRuntimeScore}</div><div class="stat-label">Overall Runtime Score</div></div>
        <div class="stat-card ${report.postingEligibility.eligible ? 'green' : 'red'}"><div class="stat-value">${esc(report.postingEligibility.status)}</div><div class="stat-label">Posting Eligibility</div></div>
        <div class="stat-card red"><div class="stat-value">${report.blockingErrors.length}</div><div class="stat-label">Blocking Errors</div></div>
        <div class="stat-card yellow"><div class="stat-value">${report.warnings.length}</div><div class="stat-label">Warnings</div></div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
        <div class="report-card"><div class="table-title">Blocking Errors</div>${issueList(report.blockingErrors)}</div>
        <div class="report-card"><div class="table-title">Warnings</div>${issueList(report.warnings)}</div>
        <div class="report-card"><div class="table-title">Runtime Checklist</div>${report.runtimeChecklist.map(item => `<div style="padding:5px">${item.passed ? '✅' : '⛔'} ${esc(item.id)}</div>`).join('')}</div>
        <div class="report-card"><div class="table-title">Readiness</div>
          <div>Business: <strong>${report.businessReadiness.score}%</strong></div>
          <div>Inventory: <strong>${report.inventoryReadiness.score}%</strong></div>
          <div>Accounting: <strong>${report.accountingReadiness.score}%</strong></div>
          <div>Permission: <strong>${report.permissionReadiness.score}%</strong></div>
        </div>
      </div>`;
  }

  function validateRuntime() {
    if (!root.OmniRuntimeValidation || !root.OmniRuntimeValidation.RuntimeValidationEngine) throw new Error('Runtime Validation Engine is not loaded.');
    lastReport = root.OmniRuntimeValidation.RuntimeValidationEngine.validate(context()).report;
    render(lastReport);
    return lastReport;
  }
  function readRuntimeReport() {
    if (!lastReport) return validateRuntime();
    render(lastReport);
    return lastReport;
  }
  function exportRuntimeReport() {
    const report = lastReport || validateRuntime();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnistore-runtime-validation-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function renderRuntimeValidationSection() {
    const target = document.getElementById('runtimeValidationResult');
    if (target && !lastReport) target.innerHTML = '<div class="alert alert-info">Runtime validation has not been run. This section is read-only.</div>';
    else if (lastReport) render(lastReport);
  }

  root.validateRuntime = validateRuntime;
  root.readRuntimeReport = readRuntimeReport;
  root.exportRuntimeReport = exportRuntimeReport;
  root.renderRuntimeValidationSection = renderRuntimeValidationSection;
  root.OmniRuntimeValidationUi = Object.freeze({ version: '1.0.0', validateRuntime, readRuntimeReport, exportRuntimeReport, renderRuntimeValidationSection });
})(typeof globalThis !== 'undefined' ? globalThis : window);
