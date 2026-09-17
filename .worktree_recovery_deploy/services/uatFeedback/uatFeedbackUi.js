(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback;
  const engine = ns.UATFeedbackEngine.createEngine();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const VIEW_FILTERS = Object.freeze({
    'customer-feedback': {},
    'uat-issues': { categories: ['bug', 'accounting_concern', 'inventory_concern', 'sales_pos_concern'] },
    'demo-notes': { categories: ['ui_improvement', 'training_question'] },
    'client-requests': { categories: ['report_request', 'feature_request'] }
  });

  function feedbackForm() {
    const categories = ns.FeedbackCategoryRegistry.CATEGORIES.map(item => `<option value="${item.id}">${esc(item.labelAr)} — ${esc(item.label)}</option>`).join('');
    const severities = ns.IssueSeverityClassifier.SEVERITIES.map(item => `<option value="${item}">${item}</option>`).join('');
    const statuses = ns.UATFeedbackValidator.STATUSES.map(item => `<option value="${item}">${item}</option>`).join('');
    return `<div class="table-container" style="margin-bottom:14px">
      <div class="table-header"><div class="table-title">إضافة ملاحظة مؤقتة أثناء تجربة العميل</div><span class="badge">Memory Only</span></div>
      <div class="form-grid" style="padding:12px">
        <div class="form-group"><label>عنوان الملاحظة</label><input id="uatFeedbackTitle" maxlength="160" placeholder="مثال: زر البحث غير واضح"></div>
        <div class="form-group"><label>التصنيف</label><select id="uatFeedbackCategory">${categories}</select></div>
        <div class="form-group"><label>الأهمية</label><select id="uatFeedbackSeverity">${severities}</select></div>
        <div class="form-group"><label>الحالة</label><select id="uatFeedbackStatus">${statuses}</select></div>
        <div class="form-group" style="grid-column:1/-1"><label>التفاصيل</label><textarea id="uatFeedbackDetails" rows="3" maxlength="4000" placeholder="اشرح ما حدث وما الذي كنت تتوقعه..."></textarea></div>
      </div>
      <div class="table-actions" style="padding:0 12px 12px;justify-content:flex-start">
        <button type="button" class="btn btn-outline btn-sm" onclick="addTemporaryUATFeedback()">إضافة ملاحظة مؤقتة</button>
        <span style="font-size:.75rem;color:var(--text2)">تختفي جميع الملاحظات عند إعادة تحميل الصفحة.</span>
      </div>
      <div id="uatFeedbackMessage" style="padding:0 12px 12px"></div>
    </div>`;
  }

  function actionBar(view) {
    return `<div class="table-actions">
      <button type="button" class="btn btn-outline btn-sm" onclick="copyUATFeedbackSummary('${view}')">نسخ ملخص الملاحظات</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="exportUATFeedbackPreview('${view}')">تصدير معاينة JSON</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="printUATFeedbackPreview('${view}')">معاينة الطباعة</button>
    </div>`;
  }

  function filtersFor(view) {
    return VIEW_FILTERS[view] || {};
  }

  function renderCards(view) {
    const report = engine.report(filtersFor(view));
    const statuses = ns.UATFeedbackValidator.STATUSES;
    const cards = report.items.length ? report.items.map(item => {
      const category = ns.FeedbackCategoryRegistry.byId(item.category);
      const options = statuses.map(status => `<option value="${status}"${status === item.status ? ' selected' : ''}>${status}</option>`).join('');
      return `<div class="report-card uat-feedback-card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">
          <strong>${esc(item.title)}</strong><span class="badge">${esc(item.severity)}</span>
        </div>
        <div style="font-size:.76rem;color:var(--text2);margin:6px 0">${esc(category ? category.labelAr : item.category)} · ${esc(item.id)} · مؤقت</div>
        <div style="font-size:.82rem;line-height:1.7;white-space:pre-wrap">${esc(item.details)}</div>
        <div class="form-group" style="margin-top:9px"><label>حالة المناقشة</label><select onchange="changeUATFeedbackStatus('${esc(item.id)}',this.value)">${options}</select></div>
      </div>`;
    }).join('') : '<div class="alert alert-info">لا توجد ملاحظات مؤقتة في هذا القسم بعد. أضف الملاحظة من صفحة «ملاحظات العميل».</div>';
    return `<div class="stats-grid" style="margin-bottom:12px">
      <div class="stat-card blue"><div class="stat-value">${report.total}</div><div class="stat-label">إجمالي الملاحظات</div></div>
      <div class="stat-card red"><div class="stat-value">${report.openCritical}</div><div class="stat-label">Critical مفتوحة</div></div>
      <div class="stat-card yellow"><div class="stat-value">${report.openHigh}</div><div class="stat-label">High مفتوحة</div></div>
    </div><div class="uat-feedback-grid">${cards}</div>`;
  }

  function renderUATFeedbackPage(view) {
    const target = document.getElementById(`uat-feedback-${view}`);
    if (!target) return;
    target.innerHTML = `${view === 'customer-feedback' ? feedbackForm() : ''}<div class="table-container" style="margin-bottom:12px"><div class="table-header"><div class="table-title">معاينة الملاحظات</div>${actionBar(view)}</div></div>${renderCards(view)}`;
  }

  function renderAll() {
    Object.keys(VIEW_FILTERS).forEach(renderUATFeedbackPage);
  }

  function addTemporaryUATFeedback() {
    const message = document.getElementById('uatFeedbackMessage');
    try {
      engine.addFeedback({
        title: document.getElementById('uatFeedbackTitle').value,
        details: document.getElementById('uatFeedbackDetails').value,
        category: document.getElementById('uatFeedbackCategory').value,
        severity: document.getElementById('uatFeedbackSeverity').value,
        status: document.getElementById('uatFeedbackStatus').value
      });
      renderAll();
      const nextMessage = document.getElementById('uatFeedbackMessage');
      if (nextMessage) nextMessage.innerHTML = '<div class="alert alert-info">تمت إضافة الملاحظة إلى ذاكرة الجلسة فقط، ولم يتم حفظ أي بيانات.</div>';
    } catch (error) {
      if (message) message.innerHTML = `<div class="alert alert-danger">${esc(error.message)}</div>`;
    }
  }

  function changeUATFeedbackStatus(id, status) {
    engine.updateStatus(id, status);
    renderAll();
  }

  async function copyUATFeedbackSummary(view) {
    const summary = engine.report(filtersFor(view)).summaryText;
    const target = document.getElementById(`uat-feedback-${view}`);
    let copied = false;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(summary);
        copied = true;
      }
    } catch (error) { copied = false; }
    if (target) target.insertAdjacentHTML('afterbegin', copied
      ? '<div class="alert alert-info">تم نسخ الملخص. لم يتم حفظه داخل النظام.</div>'
      : `<div class="alert alert-warning">تعذر النسخ التلقائي؛ انسخ النص التالي يدويًا.</div><textarea rows="6" readonly>${esc(summary)}</textarea>`);
  }

  function exportUATFeedbackPreview(view) {
    const report = engine.report(filtersFor(view));
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnistore-${view}-preview.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function printUATFeedbackPreview(view) {
    renderUATFeedbackPage(view);
    root.print();
  }

  root.renderUATFeedbackPage = renderUATFeedbackPage;
  root.addTemporaryUATFeedback = addTemporaryUATFeedback;
  root.changeUATFeedbackStatus = changeUATFeedbackStatus;
  root.copyUATFeedbackSummary = copyUATFeedbackSummary;
  root.exportUATFeedbackPreview = exportUATFeedbackPreview;
  root.printUATFeedbackPreview = printUATFeedbackPreview;
  root.OmniUATFeedbackUi = Object.freeze({ version: '1.0.0', engine, renderUATFeedbackPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
