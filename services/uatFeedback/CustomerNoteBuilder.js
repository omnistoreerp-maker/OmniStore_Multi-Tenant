(function (root) {
  'use strict';
  const ns = root.OmniUATFeedback = root.OmniUATFeedback || {};
  let sequence = 0;
  const clean = value => String(value == null ? '' : value).trim().slice(0, 4000);
  function build(input = {}, options = {}) {
    const normalized = {
      title: clean(input.title),
      details: clean(input.details),
      category: input.category,
      severity: ns.IssueSeverityClassifier.classify(input),
      status: input.status || 'New',
      page: clean(input.page || 'customer-feedback'),
      customer: clean(input.customer || ''),
      createdBy: clean(input.createdBy || 'Customer Demo')
    };
    const validation = ns.UATFeedbackValidator.validate(normalized);
    if (!validation.valid) {
      const error = new Error(validation.errors.map(item => item.message).join(' '));
      error.code = 'INVALID_FEEDBACK';
      error.validation = validation;
      throw error;
    }
    sequence += 1;
    return Object.freeze({
      id: options.id || `UAT-${String(sequence).padStart(4, '0')}`,
      ...normalized,
      createdAt: options.createdAt || new Date().toISOString(),
      temporary: true,
      persisted: false
    });
  }
  ns.CustomerNoteBuilder = Object.freeze({ version: '1.0.0', build });
})(typeof globalThis !== 'undefined' ? globalThis : window);
