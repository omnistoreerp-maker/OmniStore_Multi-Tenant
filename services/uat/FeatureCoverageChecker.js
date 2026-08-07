(function (root) {
  'use strict';
  const ns = root.OmniUAT = root.OmniUAT || {};
  const list = value => Array.isArray(value) ? value : [];
  const issue = (code, message, options = {}) => Object.freeze({
    code, message,
    severity: options.severity || 'warning',
    blocking: options.blocking === true,
    area: options.area || 'uat',
    reference: options.reference || null
  });
  const check = (id, label, passed, details = '') => Object.freeze({ id, label, passed: passed === true, details });
  const group = (id, title, checks, issues = []) => Object.freeze({
    id, title,
    ready: checks.every(item => item.passed) && !issues.some(item => item.blocking),
    checks: Object.freeze(checks),
    issues: Object.freeze(issues)
  });
  ns.UATUtils = Object.freeze({ list, issue, check, group });

  const REQUIRED_FEATURES = Object.freeze([
    'pos', 'sales', 'purchases', 'inventory', 'accounting', 'reports',
    'manufacturing', 'businessProfiles', 'permissions', 'search', 'filters',
    'printPreview', 'exportPreview', 'keyboardShortcuts', 'responsiveUi'
  ]);

  function validate(context = {}) {
    const { check, group, issue } = ns.UATUtils;
    const features = context.features || {};
    const checks = REQUIRED_FEATURES.map(id => check(id, id, features[id] === true, features[id] === true ? 'Available' : 'Not detected'));
    const issues = checks.filter(item => !item.passed).map(item => issue('FEATURE_NOT_COVERED', `${item.label} was not detected in the UAT capability snapshot.`, { area: 'feature', reference: item.id }));
    return group('features', 'Feature Coverage', checks, issues);
  }
  ns.FeatureCoverageChecker = Object.freeze({ version: '1.0.0', REQUIRED_FEATURES, validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
