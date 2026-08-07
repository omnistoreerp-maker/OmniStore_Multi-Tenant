(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  function counts(items, field, values) {
    return Object.freeze(Object.fromEntries(values.map(value => [value, items.filter(item => item[field] === value).length])));
  }
  function build(items = []) {
    const safeItems = items.map(item => Object.freeze({ ...item }));
    const critical = safeItems.filter(item => item.severity === 'Critical');
    const high = safeItems.filter(item => item.severity === 'High');
    const summaryText = [
      `UAT Feedback Summary — ${safeItems.length} item(s)`,
      ...safeItems.map(item => `[${item.severity}] ${item.title} — ${item.category} — ${item.status}`)
    ].join('\n');
    return Object.freeze({
      generatedAt: new Date().toISOString(),
      readOnlyPreview: true,
      total: safeItems.length,
      byCategory: counts(safeItems, 'category', ns.FeedbackCategoryRegistry.CATEGORIES.map(item => item.id)),
      bySeverity: counts(safeItems, 'severity', ns.IssueSeverityClassifier.SEVERITIES),
      byStatus: counts(safeItems, 'status', ns.UATFeedbackValidator.STATUSES),
      openCritical: critical.filter(item => !['Rejected', 'Deferred'].includes(item.status)).length,
      openHigh: high.filter(item => !['Rejected', 'Deferred'].includes(item.status)).length,
      items: Object.freeze(safeItems),
      summaryText
    });
  }
  ns.UATFeedbackReportBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
