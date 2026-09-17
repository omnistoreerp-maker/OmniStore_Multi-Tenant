(function (root) {
  'use strict';
  const ns = root.OmniReleaseManager = root.OmniReleaseManager || {};
  function check(snapshot = {}) {
    const checks = [
      { id: 'master_identity', passed: snapshot.projectKind === 'master', label: 'المشروع معرّف كنسخة Master' },
      { id: 'version', passed: Boolean(snapshot.masterVersion), label: 'رقم إصدار Master موجود' },
      { id: 'phases', passed: Array.isArray(snapshot.completedPhases) && snapshot.completedPhases.includes(20), label: 'Phase 20 مسجلة' },
      { id: 'tests', passed: snapshot.testTotals && snapshot.testTotals.failed === 0 && snapshot.testTotals.passed > 0, label: 'جميع الاختبارات ناجحة' },
      { id: 'templates', passed: Number(snapshot.templateCount) >= 7, label: 'قوالب العميل مكتملة' },
      { id: 'rollback', passed: snapshot.rollbackPlan && snapshot.rollbackPlan.steps.length > 0, label: 'خطة الرجوع متاحة' },
      { id: 'sql_safe', passed: snapshot.safety && snapshot.safety.sqlExecuted === false, label: 'لم يتم تنفيذ SQL' },
      { id: 'supabase_safe', passed: snapshot.safety && snapshot.safety.supabaseConnected === false, label: 'لا يوجد اتصال Supabase' },
      { id: 'storage_safe', passed: snapshot.safety && snapshot.safety.localStorageWritten === false, label: 'لا توجد كتابة localStorage' },
      { id: 'posting_safe', passed: snapshot.safety && snapshot.safety.accountingPosted === false && snapshot.safety.inventoryPosted === false, label: 'لا يوجد ترحيل محاسبي أو مخزني' }
    ].map(item => Object.freeze(item));
    const score = Math.round((checks.filter(item => item.passed).length / checks.length) * 100);
    return Object.freeze({ checks: Object.freeze(checks), score, ready: score === 100, failures: Object.freeze(checks.filter(item => !item.passed)) });
  }
  ns.ReleaseHealthChecker = Object.freeze({ version: '1.0.0', check });
})(typeof globalThis !== 'undefined' ? globalThis : window);
