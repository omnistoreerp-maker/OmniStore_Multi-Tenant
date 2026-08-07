(function (root) {
  'use strict';

  const ns = root.OmniRuntimeValidation = root.OmniRuntimeValidation || {};
  const list = value => Array.isArray(value) ? value : [];
  const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const issue = (code, message, options = {}) => Object.freeze({
    code,
    message,
    severity: options.severity || 'warning',
    blocking: options.blocking === true,
    source: options.source || 'business',
    reference: options.reference || null,
    checklistItem: options.checklistItem || code
  });
  const result = (id, title, issues, checks = []) => Object.freeze({
    id,
    title,
    ready: !issues.some(item => item.blocking),
    issues: Object.freeze(issues),
    checks: Object.freeze(checks)
  });
  const accountId = account => String(account && (account.id || account.accountId || account.code) || '');
  const documentRef = document => String(document && (document.reference || document.invoiceNo || document.number || document.id) || '');

  ns.RuntimeValidationUtils = Object.freeze({ list, number, issue, result, accountId, documentRef });

  function validate(context = {}) {
    const issues = [];
    const profile = context.businessProfile || context.companySettings || {};
    const type = profile.type || profile.businessType || context.businessType;
    if (!type) issues.push(issue('BUSINESS_PROFILE_MISSING', 'Business profile/type is required.', { severity: 'critical', blocking: true }));
    if (!profile.companyName && !profile.company_name && !context.companyName) {
      issues.push(issue('COMPANY_NAME_MISSING', 'Company name is not configured.', { checklistItem: 'business_identity' }));
    }
    const accounting = profile.accounting || context.accountingConfiguration || {};
    if (!Object.keys(accounting).length) {
      issues.push(issue('BUSINESS_ACCOUNTING_CONFIG_INCOMPLETE', 'Business accounting configuration is incomplete.', { severity: 'critical', blocking: true }));
    }
    return result('business', 'Business Readiness', issues, [
      { id: 'business_profile', passed: Boolean(type) },
      { id: 'business_accounting_configuration', passed: Object.keys(accounting).length > 0 }
    ]);
  }

  ns.BusinessRuleValidator = Object.freeze({ version: '1.0.0', validate });
})(typeof globalThis !== 'undefined' ? globalThis : window);
