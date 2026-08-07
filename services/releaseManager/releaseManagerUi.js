(function (root) {
  'use strict';
  const release = root.OmniReleaseManager.ReleaseSnapshotEngine.build();
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const row = (icon, text) => `<div class="release-row">${icon} <span>${esc(text)}</span></div>`;

  function snapshotView(data) {
    const s = data.snapshot;
    return `<div class="stats-grid" style="margin-bottom:14px">
      <div class="stat-card green"><div class="stat-value">${data.masterReleaseReadinessScore}%</div><div class="stat-label">جاهزية Master Release</div></div>
      <div class="stat-card green"><div class="stat-value">${data.customerCopyReadinessScore}%</div><div class="stat-label">جاهزية قوالب العميل</div></div>
      <div class="stat-card blue"><div class="stat-value">${esc(s.masterVersion)}</div><div class="stat-label">Master Version</div></div>
      <div class="stat-card blue"><div class="stat-value">${s.testTotals.passed}</div><div class="stat-label">إجمالي الاختبارات</div></div>
    </div>
    <div class="release-grid">
      <section class="report-card"><div class="table-title">المراحل المكتملة</div>${row('✅', `Phase ${s.completedPhases[0]} إلى Phase ${s.completedPhases[s.completedPhases.length - 1]}`)}${row('✅', `${s.testTotals.previous} اختبار سابق`)}${row('✅', `${s.testTotals.phase20} اختبار Phase 20`)}</section>
      <section class="report-card"><div class="table-title">هوية الإصدار</div>${row('🏷️', s.projectName)}${row('🧭', 'نوع المشروع: Master Development Version')}${row('📦', s.cacheVersion)}${row('🔒', 'Snapshot للقراءة فقط')}</section>
      <section class="report-card"><div class="table-title">قواعد الأمان</div>${row('✅', 'لا SQL أو Supabase')}${row('✅', 'لا Database أو localStorage writes')}${row('✅', 'لا Accounting أو Inventory posting')}${row('✅', 'شارات UAT/Demo محفوظة')}</section>
      <section class="report-card"><div class="table-title">Rollback</div>${s.rollbackPlan.steps.map(step => row('↩️', step)).join('')}</section>
    </div>`;
  }
  function checklistView(data) {
    return `<div class="report-card"><div class="alert alert-warning">هذه قائمة تخطيط فقط. لا تنشئ أو تعدّل أي نسخة عميل.</div>${data.snapshot.customerCopyChecklist.map(item => row('☐', `${item.order}. ${item.label}`)).join('')}</div>`;
  }
  function setupView(data) {
    const plan = data.snapshot.customerCopyPlan;
    return `<div class="release-grid">
      <section class="report-card"><div class="table-title">خطوات إنشاء نسخة عميل جديدة</div>${plan.steps.map(step => row('➡️', step)).join('')}</section>
      <section class="report-card"><div class="table-title">ممنوع تغييره في Master</div>${plan.masterProtections.map(step => row('⛔', step)).join('')}</section>
      <section class="report-card"><div class="table-title">مكان النسخة الجديدة</div>${row('📁', plan.targetPlaceholder)}${row('ℹ️', 'يتم اختيار مسار جديد بعد موافقة صريحة، خارج هذه الشاشة.')}${row('🔒', 'هذه الصفحة لا تنفذ نسخ ملفات.')}</section>
      <section class="report-card"><div class="table-title">قالب الهوية</div>${row('🏢', data.snapshot.brandingTemplate.companyName)}${row('🎨', data.snapshot.brandingTemplate.primaryColor)}${row('💱', data.snapshot.brandingTemplate.currency)}${row('🧩', data.snapshot.brandingTemplate.businessType)}</section>
    </div>`;
  }
  function healthView(data) {
    return `<div class="stats-grid" style="margin-bottom:14px"><div class="stat-card ${data.health.ready ? 'green' : 'red'}"><div class="stat-value">${data.health.score}%</div><div class="stat-label">Release Health</div></div><div class="stat-card blue"><div class="stat-value">${data.health.checks.filter(item => item.passed).length}/${data.health.checks.length}</div><div class="stat-label">الفحوص الناجحة</div></div></div>
      <div class="release-grid">${data.health.checks.map(item => `<div class="report-card">${row(item.passed ? '✅' : '⛔', item.label)}</div>`).join('')}</div>`;
  }
  function renderReleaseManagerPage(view) {
    const target = document.getElementById(`release-manager-${view}`);
    if (!target) return;
    const content = view === 'customer-copy-checklist' ? checklistView(release) : view === 'new-customer-setup-guide' ? setupView(release) : view === 'release-health' ? healthView(release) : snapshotView(release);
    target.innerHTML = `<div class="alert alert-info"><strong>Master Safe Mode:</strong> عرض تخطيطي فقط. لا نسخ ملفات، لا حفظ، لا SQL، لا Supabase، ولا ترحيل فعلي.</div>${content}`;
  }
  root.renderReleaseManagerPage = renderReleaseManagerPage;
  root.OmniReleaseManagerUi = Object.freeze({ version: '1.0.0', release, renderReleaseManagerPage });
})(typeof globalThis !== 'undefined' ? globalThis : window);
