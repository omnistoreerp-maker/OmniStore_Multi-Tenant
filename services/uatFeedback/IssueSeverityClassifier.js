(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  const SEVERITIES = Object.freeze(['Low', 'Medium', 'High', 'Critical']);
  function classify(input = {}) {
    if (SEVERITIES.includes(input.severity)) return input.severity;
    const text = `${input.title || ''} ${input.details || ''}`.toLowerCase();
    if (/data loss|cannot sell|security|crash|فقد بيانات|توقف البيع|أمان/.test(text)) return 'Critical';
    if (/blocked|wrong total|incorrect stock|لا يعمل|إجمالي خطأ|مخزون خطأ/.test(text)) return 'High';
    if (/confusing|slow|unclear|بطيء|غير واضح/.test(text)) return 'Medium';
    return 'Low';
  }
  ns.IssueSeverityClassifier = Object.freeze({ version: '1.0.0', SEVERITIES, classify });
})(typeof globalThis !== 'undefined' ? globalThis : window);
