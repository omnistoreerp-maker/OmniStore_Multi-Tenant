(function (root) {
  'use strict';
  const ns = root.OmniDemoPolish = root.OmniDemoPolish || {};
  const REQUIRED_LABELS = Object.freeze([
    'نسخة تجريبية',
    'Preview Only — No Posting',
    'لا يتم حفظ قيود محاسبية',
    'لا يتم ترحيل مخزون فعلي'
  ]);
  function validate(snapshot = {}) {
    const text = String(snapshot.customerFacingText || '');
    const actions = Array.isArray(snapshot.demoActions) ? snapshot.demoActions : [];
    const missingLabels = REQUIRED_LABELS.filter(label => !text.includes(label));
    const unsafeActions = actions.filter(action => /(^|\\b)(save|post|repair|execute|migrate|حفظ|ترحيل|إصلاح)(\\b|$)/i.test(String(action)));
    const issues = [];
    missingLabels.forEach(label => issues.push(Object.freeze({ code: 'DEMO_LABEL_MISSING', severity: 'warning', blocking: false, message: `Missing demo safety label: ${label}` })));
    unsafeActions.forEach(action => issues.push(Object.freeze({ code: 'UNSAFE_DEMO_ACTION', severity: 'critical', blocking: true, message: `Unsafe demo action detected: ${action}` })));
    if (snapshot.localStorageWrite === true) issues.push(Object.freeze({ code: 'DEMO_STORAGE_WRITE', severity: 'critical', blocking: true, message: 'Demo layer must not write localStorage.' }));
    if (snapshot.databaseWrite === true) issues.push(Object.freeze({ code: 'DEMO_DATABASE_WRITE', severity: 'critical', blocking: true, message: 'Demo layer must not write database data.' }));
    return Object.freeze({ valid: !issues.some(issue => issue.blocking), issues: Object.freeze(issues), missingLabels: Object.freeze(missingLabels), unsafeActions: Object.freeze(unsafeActions) });
  }
  ns.DemoSafetyValidator = Object.freeze({ version: '1.0.0', REQUIRED_LABELS, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
