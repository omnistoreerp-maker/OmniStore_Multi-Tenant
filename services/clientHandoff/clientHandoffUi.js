(function (root) {
  'use strict';
  const ns = root.OmniClientHandoff;
  const handoff = ns.ClientHandoffEngine.build();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function actions(view) {
    return `<div class="table-actions">
      <button type="button" class="btn btn-outline btn-sm" onclick="exportClientHandoffPreview('${view}')">تصدير حزمة JSON للمعاينة</button>
      <button type="button" class="btn btn-outline btn-sm" onclick="printClientHandoffPreview('${view}')">معاينة الطباعة</button>
    </div>`;
  }
  function packageOverview(data) {
    return `<div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card green"><div class="stat-value">${data.handoffReadinessScore}%</div><div class="stat-label">جاهزية تسليم العرض</div></div>
      <div class="stat-card blue"><div class="stat-value">${data.package.scenarios.length}</div><div class="stat-label">سيناريوهات العرض</div></div>
      <div class="stat-card blue"><div class="stat-value">${data.package.sessionPlan.totalMinutes}</div><div class="stat-label">مدة الجلسة بالدقائق</div></div>
    </div>
    <div class="handoff-grid">
      <section class="report-card"><div class="table-title">عن النسخة</div><div class="alert alert-warning">هذه نسخة UAT/Beta للتجربة وقبول العميل. مراكز المعاينة محاكاة فقط، ولا يوجد ترحيل محاسبي أو مخزني فعلي.</div></section>
      <section class="report-card"><div class="table-title">خطة الجلسة</div>${data.package.sessionPlan.agenda.map(item => `<div class="handoff-row"><strong>${item.minutes} دقيقة</strong><span>${esc(item.title)}</span></div>`).join('')}</section>
      <section class="report-card"><div class="table-title">أسئلة العميل</div>${data.package.customerQuestions.map(item => `<div class="handoff-row">☐ <span>${esc(item)}</span></div>`).join('')}</section>
      <section class="report-card"><div class="table-title">ما المطلوب اختباره؟</div><div class="handoff-row">☐ الشاشات وسهولة القراءة</div><div class="handoff-row">☐ مسارات العمل اليومية</div><div class="handoff-row">☐ التقارير والطباعة والتصدير</div><div class="handoff-row">☐ القوائم والتنقل وسهولة الاستخدام</div><div class="handoff-row">☐ جمع ملاحظات العميل بعد العرض</div></section>
    </div>`;
  }
  function training(data) {
    return `<div class="handoff-grid">${data.package.trainingChecklist.map(item => `<div class="report-card"><div class="handoff-row"><strong>${item.order}</strong><span>${esc(item.title)}</span></div><div style="font-size:.72rem;color:var(--text2)">مراجعة مع العميل</div></div>`).join('')}</div>`;
  }
  function scenarios(data) {
    return `<div class="handoff-grid">${data.package.scenarios.map(item => `<article class="report-card"><div class="table-title">${item.order}. ${esc(item.title)}</div>${item.steps.map(step => `<div class="handoff-row">☐ <span>${esc(step)}</span></div>`).join('')}<div class="badge" style="margin-top:8px">Guided Read Only</div></article>`).join('')}</div>`;
  }
  function signoff(data) {
    return `<div class="report-card"><div class="alert alert-info">نموذج مراجعة فقط. التوقيع الرسمي يتم خارج النظام ولا يُحفظ في هذه الشاشة.</div>${data.package.signoff.items.map(item => `<div class="handoff-row">☐ <span>${esc(item.label)}</span></div>`).join('')}<hr style="border:0;border-top:1px solid var(--border);margin:18px 0"><div class="form-grid"><div>اسم العميل: ____________________</div><div>ممثل العميل: ____________________</div><div>التاريخ: ____________________</div><div>التوقيع: ____________________</div></div></div>`;
  }
  function limitations(data) {
    return `<div class="report-card"><div class="alert alert-warning">يجب شرح هذه النقاط للعميل قبل بدء التجربة.</div>${data.package.limitations.map(item => `<div class="handoff-row">⚠️ <span>${esc(item)}</span></div>`).join('')}</div>`;
  }
  function content(view, data) {
    if (view === 'training-checklist') return training(data);
    if (view === 'demo-scenarios') return scenarios(data);
    if (view === 'client-signoff') return signoff(data);
    if (view === 'known-limitations') return limitations(data);
    return packageOverview(data);
  }
  function renderClientHandoffPage(view) {
    const target = document.getElementById(`client-handoff-${view}`);
    if (!target) return;
    target.innerHTML = `<div class="table-container" style="margin-bottom:12px"><div class="table-header"><div><div class="table-title">حزمة تسليم العميل — UAT/Beta</div><div style="font-size:.72rem;color:var(--text2)">عرض وتصدير فقط، دون حفظ أو تنفيذ</div></div>${actions(view)}</div></div>${content(view, handoff)}`;
  }
  function exportClientHandoffPreview(view) {
    const blob = new Blob([JSON.stringify({ view, ...handoff }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `omnistore-${view}-handoff-preview.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  function printClientHandoffPreview(view) {
    renderClientHandoffPage(view);
    root.print();
  }
  root.renderClientHandoffPage = renderClientHandoffPage;
  root.exportClientHandoffPreview = exportClientHandoffPreview;
  root.printClientHandoffPreview = printClientHandoffPreview;
  root.OmniClientHandoffUi = Object.freeze({ version: '1.0.0', handoff, renderClientHandoffPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
