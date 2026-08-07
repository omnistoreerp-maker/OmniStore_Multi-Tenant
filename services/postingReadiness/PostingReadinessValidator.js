(function (root) {
  'use strict';

  const ns = root.OmniPostingReadiness = root.OmniPostingReadiness || {};
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();
  const number = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const money = value => Math.round((number(value) + Number.EPSILON) * 100) / 100;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function issue(severity, code, message, source, reference, fix) {
    return Object.freeze({ severity, code, message, source: source || 'readiness', reference: reference || '', requiredFix: fix || '' });
  }

  function safe(code, message, source) {
    return Object.freeze({ code, message, source: source || 'readiness' });
  }

  function summarize(checks = []) {
    const all = list(checks).flatMap(check => list(check.issues));
    const critical = all.filter(row => row.severity === 'critical');
    const warnings = all.filter(row => row.severity === 'warning');
    const safeItems = list(checks).flatMap(check => list(check.safeItems));
    const score = Math.max(0, Math.min(100, 100 - critical.length * 18 - warnings.length * 5));
    return Object.freeze({ issues: Object.freeze(all), critical: Object.freeze(critical), warnings: Object.freeze(warnings), safeItems: Object.freeze(safeItems), score });
  }

  ns.PostingReadinessValidator = Object.freeze({ version: '1.0.0', list, text, number, money, clone, issue, safe, summarize });
})(typeof globalThis !== 'undefined' ? globalThis : window);
