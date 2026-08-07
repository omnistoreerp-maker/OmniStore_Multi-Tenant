(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  function createEngine() {
    const tracker = ns.UATIssueTracker.createTracker();
    return Object.freeze({
      addFeedback: (input, options) => tracker.add(input, options),
      updateStatus: (id, status) => tracker.updateStatus(id, status),
      list: filters => tracker.list(filters || {}),
      report: filters => ns.UATFeedbackReportBuilder.build(tracker.list(filters || {})),
      count: tracker.count,
      storage: 'memory-only',
      readOnlySafe: true,
      persisted: false
    });
  }
  ns.UATFeedbackEngine = Object.freeze({ version: '1.0.0', createEngine });
})(typeof globalThis !== 'undefined' ? globalThis : window);
