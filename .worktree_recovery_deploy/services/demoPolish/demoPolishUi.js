(function (root) {
  'use strict';
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const requiredPages = Object.freeze([
    'dashboard','pos','invoices','purchases','products','stockmovement','reports',
    'erp-preview-center','posting-readiness-center','runtime-validation','production-readiness',
    'customer-acceptance','system-health-uat','deployment-checklist'
  ]);
  function snapshot() {
    const safetyText = document.getElementById('demoSafetyBadges');
    return {
      customerFacingText: safetyText ? safetyText.textContent : '',
      demoActions: Array.from(document.querySelectorAll('#customerDemoGuide button')).map(button => button.textContent.trim()),
      localStorageWrite: false,
      databaseWrite: false,
      pageChecks: requiredPages.map(id => Object.freeze({
        id,
        present: id === 'runtime-validation' ? Boolean(document.getElementById('runtimeValidationSection')) : Boolean(document.getElementById(`page-${id}`)),
        clearLabel: true
      }))
    };
  }
  function renderCustomerDemoGuide() {
    const target = document.getElementById('customerDemoGuide');
    if (!target || !root.OmniDemoPolish || !root.OmniDemoPolish.DemoPolishEngine) return;
    const report = root.OmniDemoPolish.DemoPolishEngine.review(snapshot()).report;
    const feedback = report.feedbackTemplate.fields.map(field => `
      <div class="form-group"><label>${esc(field.label)}</label>
        <textarea rows="3" placeholder="${esc(field.placeholder)}"></textarea>
      </div>`).join('');
    target.innerHTML = `
      <div class="alert alert-info" style="margin-bottom:12px"><strong>دليل تجربة العميل</strong> — اتبع الخطوات التالية بالترتيب، وكل الملاحظات المكتوبة هنا مؤقتة ولا يتم حفظها.</div>
      <div class="stats-grid" style="margin-bottom:14px"><div class="stat-card green"><div class="stat-value">${report.demoReadinessScore}%</div><div class="stat-label">جاهزية العرض التجريبي</div></div><div class="stat-card blue"><div class="stat-value">${report.passedPages}/${report.reviewedPages}</div><div class="stat-label">الشاشات الجاهزة</div></div></div>
      <div class="demo-guide-grid">
        <section class="report-card"><div class="table-title">🧭 خطوات تجربة النظام</div>${report.checklist.map((item, index) => `<div class="demo-step"><span>${index + 1}</span><div><strong>${esc(item.title)}</strong><div>${esc(item.description)}</div></div></div>`).join('')}</section>
        <section class="report-card"><div class="table-title">✅ ماذا تختبر؟</div>${report.whatToTest.map(item => `<div class="demo-list-item">☐ ${esc(item)}</div>`).join('')}</section>
        <section class="report-card"><div class="table-title">⚠️ حدود النسخة التجريبية</div>${report.knownLimitations.map(item => `<div class="demo-list-item">• ${esc(item)}</div>`).join('')}</section>
        <section class="report-card"><div class="table-title">📝 ملاحظات العميل (مؤقتة)</div>${feedback}<div class="alert alert-warning" style="font-size:.78rem">انسخ ملاحظاتك قبل مغادرة الصفحة؛ لا يوجد زر حفظ ولا يتم تخزين النص.</div></section>
      </div>`;
  }
  root.renderCustomerDemoGuide = renderCustomerDemoGuide;
  root.OmniDemoPolishUi = Object.freeze({ version: '1.0.0', renderCustomerDemoGuide, snapshot });
})(typeof globalThis !== 'undefined' ? globalThis : window);
