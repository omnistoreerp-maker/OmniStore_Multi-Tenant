(function (root) {
  'use strict';
  const ns = root.OmniDemoPolish = root.OmniDemoPolish || {};
  function build(safety, snapshot = {}) {
    const pageChecks = Array.isArray(snapshot.pageChecks) ? snapshot.pageChecks : [];
    const passedPages = pageChecks.filter(item => item.present && item.clearLabel !== false).length;
    const pageScore = pageChecks.length ? Math.round((passedPages / pageChecks.length) * 100) : 0;
    const safetyPenalty = safety.issues.reduce((sum, issue) => sum + (issue.blocking ? 25 : 5), 0);
    const demoReadinessScore = Math.max(0, Math.round((pageScore * 0.7) + (Math.max(0, 100 - safetyPenalty) * 0.3)));
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnly: true,
      demoReadinessScore,
      status: safety.valid && demoReadinessScore >= 85 ? 'ready_for_customer_demo' : 'review_required',
      reviewedPages: pageChecks.length,
      passedPages,
      safety,
      checklist: ns.CustomerDemoChecklist.STEPS,
      whatToTest: ns.CustomerDemoChecklist.WHAT_TO_TEST,
      feedbackTemplate: ns.CustomerFeedbackTemplate.create(),
      knownLimitations: Object.freeze([
        'المعاينات المحاسبية لا تحفظ قيودًا فعلية.',
        'معاينات المخزون لا ترحّل حركات فعلية.',
        'ملاحظات العميل في هذه الشاشة مؤقتة ولا يتم حفظها.',
        'التشغيل الفعلي يحتاج اعتماد العميل واختبار بيئة الإنتاج.'
      ])
    });
  }
  ns.DemoReadinessReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
