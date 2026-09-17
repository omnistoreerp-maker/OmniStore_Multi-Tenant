(function (root) {
  'use strict';

  let latestResult = null;

  const escapeHtml = value => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const format = value => typeof root.formatMoney === 'function'
    ? root.formatMoney(Number(value) || 0)
    : `${Number(value || 0).toFixed(2)}`;
  const badge = (label, kind) => `<span class="badge badge-${kind}">${escapeHtml(label)}</span>`;
  const emptyRow = (span, message) => `<tr><td colspan="${span}" style="text-align:center;color:var(--text2)">${escapeHtml(message)}</td></tr>`;

  function getSnapshot() {
    if (typeof root.getOmniAccountingSnapshot !== 'function') {
      throw new Error('Accounting snapshot adapter is unavailable');
    }
    return root.getOmniAccountingSnapshot();
  }

  function renderSummary(audit, reports) {
    const host = document.getElementById('accountingAuditSummary');
    if (!host) return;
    const cards = [
      ['الأخطاء', audit.errors.length, 'red'],
      ['التحذيرات', audit.warnings.length, 'yellow'],
      ['قيود غير متوازنة', audit.unbalanced.length, audit.unbalanced.length ? 'red' : 'green'],
      ['منتجات بلا تكلفة', reports.inventoryValuation.missingCost.length, 'orange'],
      ['فرق الخزنة', reports.cashReconciliation.runningDifferences.length, 'purple'],
      ['قيمة المخزون', format(reports.inventoryValuation.totalValue), 'blue']
    ];
    host.innerHTML = cards.map(([label, value, color]) => `
      <div class="stat-card ${color}" style="padding:14px">
        <div class="stat-value" style="font-size:1.15rem">${escapeHtml(value)}</div>
        <div class="stat-label">${escapeHtml(label)}</div>
      </div>`).join('');
  }

  function renderIssues(audit) {
    const host = document.getElementById('accountingIssuesTbody');
    if (!host) return;
    const filter = document.getElementById('accountingIssueFilter')?.value || 'all';
    const issues = [...audit.errors, ...audit.warnings].filter(issue => {
      if (filter === 'all') return true;
      if (filter === 'errors') return issue.severity === 'error';
      if (filter === 'warnings') return issue.severity !== 'error';
      if (filter === 'cost') return ['PRODUCT_WITHOUT_COST', 'SALE_ITEM_WITHOUT_COST', 'PURCHASE_ITEM_WITHOUT_COST', 'STOCK_MOVEMENT_WITHOUT_COST'].includes(issue.code);
      if (filter === 'links') return String(issue.code).includes('UNLINKED');
      if (filter === 'inventory') return issue.sourceType === 'inventory';
      if (filter === 'treasury') return issue.sourceType === 'treasury';
      return true;
    });
    host.innerHTML = issues.map(issue => `<tr>
      <td>${issue.severity === 'error' ? badge('خطأ', 'red') : badge('تحذير', 'yellow')}</td>
      <td><code>${escapeHtml(issue.code)}</code></td>
      <td>${escapeHtml(issue.sourceType || '-')}</td>
      <td>${escapeHtml(issue.sourceId || issue.productId || '-')}</td>
      <td>${escapeHtml(issue.message || '-')}</td>
    </tr>`).join('') || emptyRow(5, 'لا توجد نتائج في هذا التصنيف');
  }

  function renderTrialBalance(report) {
    const host = document.getElementById('accountingTrialBalanceTbody');
    if (!host) return;
    host.innerHTML = report.accounts.map(row => `<tr>
      <td>${escapeHtml(row.code)}</td><td>${escapeHtml(row.nameAr)}</td>
      <td>${format(row.debit)}</td><td>${format(row.credit)}</td><td>${format(row.balance)}</td>
    </tr>`).join('') || emptyRow(5, 'لا توجد عمليات لتكوين ميزان المراجعة');
    const status = document.getElementById('accountingTrialStatus');
    if (status) status.innerHTML = report.balanced
      ? `${badge('متوازن', 'green')} مدين ${format(report.debit)} = دائن ${format(report.credit)}`
      : `${badge('غير متوازن', 'red')} الفرق ${format(report.difference)}`;
  }

  function renderProfitAndInventory(reports) {
    const pnl = reports.profitAndLoss;
    const pnlHost = document.getElementById('accountingPnlSummary');
    if (pnlHost) pnlHost.innerHTML = `
      <div class="report-row"><span>إيراد المبيعات</span><strong>${format(pnl.salesRevenue)}</strong></div>
      <div class="report-row"><span>تكلفة البضاعة المباعة</span><strong>${format(pnl.costOfGoodsSold)}</strong></div>
      <div class="report-row"><span>مجمل الربح</span><strong>${format(pnl.grossProfit)}</strong></div>
      <div class="report-row"><span>مصروفات التشغيل</span><strong>${format(pnl.operatingExpenses)}</strong></div>
      <div class="report-row"><span>صافي الربح التقديري</span><strong>${format(pnl.netProfit)}</strong></div>
      <div style="margin-top:8px">${pnl.reliable ? badge('الربح قابل للمراجعة', 'green') : badge('غير موثوق: توجد تكاليف ناقصة', 'red')}</div>`;

    const inv = reports.inventoryValuation;
    const invHost = document.getElementById('accountingInventoryTbody');
    if (invHost) invHost.innerHTML = inv.rows.map(row => `<tr>
      <td>${escapeHtml(row.name || row.productId)}</td><td>${escapeHtml(row.stock)}</td>
      <td>${format(row.unitCost)}</td><td>${format(row.value)}</td>
      <td>${row.negativeStock ? badge('مخزون سالب', 'red') : row.missingCost ? badge('تكلفة ناقصة', 'yellow') : badge('سليم', 'green')}</td>
    </tr>`).join('') || emptyRow(5, 'لا توجد منتجات');
  }

  function renderReconciliation(report) {
    const host = document.getElementById('accountingTreasurySummary');
    if (!host) return;
    host.innerHTML = `
      <div class="report-row"><span>إجمالي الوارد</span><strong>${format(report.incoming)}</strong></div>
      <div class="report-row"><span>إجمالي الصادر</span><strong>${format(report.outgoing)}</strong></div>
      <div class="report-row"><span>الرصيد المحسوب</span><strong>${format(report.calculatedBalance)}</strong></div>
      <div class="report-row"><span>حركات غير صالحة</span><strong>${report.invalid.length}</strong></div>
      <div class="report-row"><span>فروق الرصيد الجاري</span><strong>${report.runningDifferences.length}</strong></div>
      <div style="margin-top:8px">${report.reconciled ? badge('متطابق', 'green') : badge('يحتاج مراجعة', 'yellow')}</div>`;
  }

  function renderOperations(reports) {
    const saleHost = document.getElementById('accountingSalesAuditTbody');
    if (saleHost) saleHost.innerHTML = reports.salesProfitAudit.rows.map(row => `<tr>
      <td>${escapeHtml(row.id)}</td><td>${format(row.revenue)}</td><td>${format(row.cost)}</td>
      <td>${row.profit === null ? badge('غير محسوب', 'red') : format(row.profit)}</td>
      <td>${row.balanced ? badge('متوازن', 'green') : badge('غير متوازن', 'red')}</td>
      <td><button class="btn btn-outline btn-sm" onclick="previewOmniAccountingOperation('sale',decodeURIComponent('${escapeHtml(encodeURIComponent(row.id))}'))">معاينة القيد</button></td>
    </tr>`).join('') || emptyRow(6, 'لا توجد فواتير بيع');

    const purchaseHost = document.getElementById('accountingPurchasesAuditTbody');
    if (purchaseHost) purchaseHost.innerHTML = reports.purchaseCostAudit.rows.map(row => `<tr>
      <td>${escapeHtml(row.id)}</td><td>${format(row.total)}</td><td>${row.missingCost}</td><td>${row.unlinkedItems}</td>
      <td>${row.balanced ? badge('متوازن', 'green') : badge('غير متوازن', 'red')}</td>
      <td><button class="btn btn-outline btn-sm" onclick="previewOmniAccountingOperation('purchase',decodeURIComponent('${escapeHtml(encodeURIComponent(row.id))}'))">معاينة القيد</button></td>
    </tr>`).join('') || emptyRow(6, 'لا توجد فواتير شراء');
  }

  function renderAccountingAuditCenter() {
    const host = document.getElementById('accountingAuditStatus');
    try {
      const snapshot = getSnapshot();
      const audit = root.OmniAccountingCore.validateSnapshot(snapshot);
      const reports = root.OmniAccountingReports.generate(snapshot);
      latestResult = { snapshotMeta: snapshot.meta || {}, audit, reports };
      renderSummary(audit, reports);
      renderIssues(audit);
      renderTrialBalance(reports.trialBalance);
      renderProfitAndInventory(reports);
      renderReconciliation(reports.cashReconciliation);
      renderOperations(reports);
      if (host) host.innerHTML = `${badge('قراءة فقط', 'blue')} آخر فحص: ${escapeHtml(new Date(audit.generatedAt).toLocaleString('ar-EG'))}`;
    } catch (error) {
      if (host) host.innerHTML = `<span class="badge badge-red">تعذر الفحص</span> ${escapeHtml(error.message)}`;
      if (root.console) root.console.error('Accounting Audit Center failed', error);
    }
  }

  function previewOperation(type, id) {
    const snapshot = getSnapshot();
    const source = (type === 'sale' ? snapshot.sales : snapshot.purchases).find(row => String(row.id) === String(id));
    if (!source) return;
    const preview = type === 'sale'
      ? root.OmniAccountingCore.previewSale(source, snapshot)
      : root.OmniAccountingCore.previewPurchase(source, snapshot);
    const host = document.getElementById('accountingOperationPreview');
    if (!host) return;
    host.innerHTML = `
      <div class="table-header"><div class="table-title">قيد افتراضي — ${type === 'sale' ? 'بيع' : 'شراء'} #${escapeHtml(id)}</div>
      <div>${preview.balanced ? badge('متوازن', 'green') : badge('غير متوازن', 'red')}</div></div>
      <div class="alert alert-info" style="font-size:.78rem">هذه معاينة فقط ولم يتم تسجيل أي قيد.</div>
      <div class="overflow-x"><table class="data-table"><thead><tr><th>الكود</th><th>الحساب</th><th>مدين</th><th>دائن</th><th>البيان</th></tr></thead><tbody>
      ${preview.lines.map(line => `<tr><td>${escapeHtml(line.accountCode)}</td><td>${escapeHtml(line.accountNameAr)}</td><td>${format(line.debit)}</td><td>${format(line.credit)}</td><td>${escapeHtml(line.memo)}</td></tr>`).join('')}
      </tbody></table></div>`;
    host.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function exportAudit() {
    if (!latestResult) renderAccountingAuditCenter();
    if (!latestResult) return;
    const blob = new Blob([JSON.stringify(latestResult, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `omnistore_accounting_audit_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  root.renderAccountingAuditCenter = renderAccountingAuditCenter;
  root.filterOmniAccountingIssues = () => latestResult && renderIssues(latestResult.audit);
  root.previewOmniAccountingOperation = previewOperation;
  root.exportOmniAccountingAudit = exportAudit;
})(typeof globalThis !== 'undefined' ? globalThis : window);
