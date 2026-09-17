(function (root) {
  'use strict';

  function preview(businessType, operation, context = {}, settingsOverrides = {}) {
    const registry = root.OmniAccountingRuleRegistry;
    if (!registry.isBooted()) registry.boot();
    const profile = registry.getProfile(businessType);
    if (!profile) throw new Error(`Accounting profile not found: ${businessType}`);
    const rule = registry.getRule(profile.id, operation);
    if (!rule) throw new Error(`Accounting rule not found: ${profile.id}.${operation}`);
    const ruleValidation = root.OmniAccountingRuleValidator.validateRule(rule);
    if (!ruleValidation.valid) {
      return { preview: true, readOnly: true, persisted: false, valid: false, lines: [], validation: { valid: false, errors: ruleValidation.errors, warnings: [] } };
    }
    const settings = {
      ...profile.settings,
      ...settingsOverrides,
      defaultAccounts: { ...profile.settings.defaultAccounts, ...(settingsOverrides.defaultAccounts || {}) }
    };
    return root.OmniAccountingRuleExecutor.execute(rule, context, settings);
  }

  root.OmniAccountingRulePreview = Object.freeze({
    version: '1.0.0',
    preview,
    sale: (businessType, context, settings) => preview(businessType, 'sale', context, settings),
    purchase: (businessType, context, settings) => preview(businessType, 'purchase', context, settings)
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
