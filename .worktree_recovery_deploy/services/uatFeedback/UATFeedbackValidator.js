(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  const STATUSES = Object.freeze(['New', 'Discussed', 'Approved', 'Rejected', 'Deferred']);
  function validate(input = {}) {
    const errors = [];
    if (!String(input.title || '').trim()) errors.push({ code: 'TITLE_REQUIRED', message: 'Feedback title is required.' });
    if (!String(input.details || '').trim()) errors.push({ code: 'DETAILS_REQUIRED', message: 'Feedback details are required.' });
    if (!ns.FeedbackCategoryRegistry.has(input.category)) errors.push({ code: 'CATEGORY_INVALID', message: 'Feedback category is invalid.' });
    if (input.severity && !ns.IssueSeverityClassifier.SEVERITIES.includes(input.severity)) errors.push({ code: 'SEVERITY_INVALID', message: 'Feedback severity is invalid.' });
    if (input.status && !STATUSES.includes(input.status)) errors.push({ code: 'STATUS_INVALID', message: 'Feedback status is invalid.' });
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
  }
  ns.UATFeedbackValidator = Object.freeze({ version: '1.0.0', STATUSES, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
