(function (root) {
  'use strict';

  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const list = value => Array.isArray(value) ? value : [];

  function dbSnapshot() {
    let db = {};
    try { if (typeof DB !== 'undefined') db = DB || {}; } catch (e) { db = root.DB || {}; }
    return {
      products: list(db.products || root.products),
      salesInvoices: list(db.saleInvoices || db.invoices || root.saleInvoices || root.invoices),
      purchaseInvoices: list(db.purchaseInvoices || db.purchases || root.purchaseInvoices || root.purchases),
      customers: list(db.customers || root.customers),
      suppliers: list(db.suppliers || root.suppliers),
      posSales: []
    };
  }

  function createReadinessContext() {
    const snapshot = dbSnapshot();
    const accountingEngine = root.OmniEnterpriseAccounting && root.OmniEnterpriseAccounting.AccountingEngine
      ? root.OmniEnterpriseAccounting.AccountingEngine.createEngine()
      : null;
    let integrationEngine = null;
    if (root.OmniERPIntegration && root.OmniERPIntegration.ERPIntegrationEngine && root.OmniAutoPosting && root.OmniAutoPosting.AutoPostingEngine) {
      const inventoryEngine = {
        onHandQty(itemId) {
          const p = snapshot.products.find(product => String(product.id || product.productId || product.code) === String(itemId)) || {};
          return Number(p.stock ?? p.qty ?? p.quantity ?? 10) || 0;
        },
        averageCost(itemId) {
          const p = snapshot.products.find(product => String(product.id || product.productId || product.code) === String(itemId)) || {};
          return { averageCost: Number(p.cost || p.buyPrice || p.purchasePrice || 60) || 0 };
        }
      };
      const autoPostingEngine = root.OmniAutoPosting.AutoPostingEngine.createEngine({ accountingEngine, inventoryEngine });
      integrationEngine = root.OmniERPIntegration.ERPIntegrationEngine.createEngine({ accountingEngine, inventoryEngine, autoPostingEngine });
    }
    const previewDocuments = snapshot.salesInvoices.slice(-2).map(inv => ({ docType: 'sales_invoice', id: inv.id || inv.invoiceNo, paymentType: inv.paymentType || 'credit', items: inv.items || [] }));
    return { snapshot, products: snapshot.products, salesInvoices: snapshot.salesInvoices, purchaseInvoices: snapshot.purchaseInvoices, customers: snapshot.customers, suppliers: snapshot.suppliers, accountingEngine, integrationEngine, previewDocuments };
  }

  function renderList(items, empty, className) {
    if (!items.length) return `<div style="color:var(--text2);padding:8px">${esc(empty)}</div>`;
    return items.map(item => `<div class="${className || 'alert alert-info'}" style="font-size:.8rem;margin-bottom:8px"><strong>${esc(item.code)}</strong> — ${esc(item.message)}${item.requiredFix ? `<div style="color:var(--text2);margin-top:4px">Fix: ${esc(item.requiredFix)}</div>` : ''}</div>`).join('');
  }

  function renderPostingReadinessCenter() {
    const target = document.getElementById('postingReadinessResult');
    if (!target) return;
    try {
      if (!root.OmniPostingReadiness || !root.OmniPostingReadiness.PostingReadinessEngine) throw new Error('Posting Readiness Engine is not loaded.');
      const result = root.OmniPostingReadiness.PostingReadinessEngine.run(createReadinessContext());
      const report = result.report;
      target.innerHTML = `
        <div class="alert alert-warning" style="font-size:.84rem;margin-bottom:12px">Read-only readiness scan. No fixing, no posting, no save, no database write, no localStorage write.</div>
        <div class="stats-grid" style="margin-bottom:14px">
          <div class="stat-card blue"><div class="stat-value">${report.readinessScore}</div><div class="stat-label">Readiness Score</div></div>
          <div class="stat-card ${report.riskLevel === 'high' ? 'red' : report.riskLevel === 'medium' ? 'yellow' : 'green'}"><div class="stat-value">${esc(report.riskLevel)}</div><div class="stat-label">Risk Level</div></div>
          <div class="stat-card red"><div class="stat-value">${report.criticalErrors.length}</div><div class="stat-label">Critical Errors</div></div>
          <div class="stat-card yellow"><div class="stat-value">${report.warnings.length}</div><div class="stat-label">Warnings</div></div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px">
          <div class="report-card"><div class="table-title">⛔ Critical Errors</div>${renderList(report.criticalErrors, 'No critical errors.', 'alert alert-danger')}</div>
          <div class="report-card"><div class="table-title">⚠️ Warnings</div>${renderList(report.warnings, 'No warnings.', 'alert alert-warning')}</div>
          <div class="report-card"><div class="table-title">✅ Safe Items</div>${renderList(report.safeItems, 'No safe items reported.', 'alert alert-info')}</div>
          <div class="report-card"><div class="table-title">🧩 Required Fixes Before Posting</div>${report.requiredFixesBeforePosting.length ? report.requiredFixesBeforePosting.map(fix => `<div class="alert alert-danger" style="font-size:.8rem">${esc(fix)}</div>`).join('') : '<div style="color:var(--text2)">No required fixes.</div>'}</div>
          <div class="report-card"><div class="table-title">🔁 Reconciliation Summary</div>
            <div>Unbalanced previews: <strong>${report.reconciliationSummary.unbalancedPreviewJournals}</strong></div>
            <div>Negative stock risks: <strong>${report.reconciliationSummary.negativeStockRisks}</strong></div>
            <div>Duplicate references: <strong>${report.reconciliationSummary.duplicateReferences}</strong></div>
          </div>
          <div class="report-card"><div class="table-title">➡️ Recommended Next Actions</div>${report.recommendedNextActions.map(action => `<div class="alert alert-info" style="font-size:.8rem">${esc(action)}</div>`).join('')}</div>
        </div>`;
      const status = document.getElementById('postingReadinessStatus');
      if (status) status.innerHTML = '<span class="badge">Read Only — No Posting</span>';
    } catch (error) {
      target.innerHTML = `<div class="alert alert-danger">${esc(error.message)}</div>`;
    }
  }

  root.renderPostingReadinessCenter = renderPostingReadinessCenter;
  root.OmniPostingReadinessUi = Object.freeze({ version: '1.0.0', renderPostingReadinessCenter, createReadinessContext });
})(typeof globalThis !== 'undefined' ? globalThis : window);
