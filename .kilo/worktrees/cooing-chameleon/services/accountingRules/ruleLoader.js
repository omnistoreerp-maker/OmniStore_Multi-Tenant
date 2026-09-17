(function (root) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const requiredRuleFields = [
    'ruleName', 'ruleId', 'description', 'enabled', 'requiredAccounts',
    'affectedModules', 'validationRules', 'journalPreview', 'inventoryImpact',
    'cashImpact', 'taxImpact', 'profitImpact'
  ];

  function parse(input) {
    if (typeof input === 'string') return JSON.parse(input);
    return clone(input);
  }

  function validateJsonProfile(input) {
    const profile = parse(input);
    const errors = [];
    if (!profile || typeof profile !== 'object') errors.push('Profile must be an object');
    if (!profile.id) errors.push('Profile id is required');
    if (!profile.name) errors.push('Profile name is required');
    if (!Array.isArray(profile.rules) && !Array.isArray(profile.templates)) errors.push('Profile rules or templates are required');
    (profile.rules || []).forEach((rule, index) => {
      requiredRuleFields.forEach(field => {
        if (!(field in rule)) errors.push(`rules[${index}].${field} is required`);
      });
    });
    return { valid: errors.length === 0, errors, profile };
  }

  function materialize(input) {
    const parsed = parse(input);
    if (Array.isArray(parsed.rules)) {
      const defaults = root.OmniBusinessAccountingProfiles.accountDefaults;
      return {
        ...parsed,
        aliases: parsed.aliases || [],
        settings: {
          defaultTaxRate: 0,
          inventoryMethod: 'weighted_average',
          profitCalculationMethod: 'invoice_cost',
          allowNegativeStock: false,
          autoJournalPreview: true,
          enableAccountingValidation: true,
          currency: 'EGP',
          ...(parsed.settings || {}),
          defaultAccounts: { ...defaults, ...(parsed.settings && parsed.settings.defaultAccounts || {}) }
        },
        rules: parsed.rules.map(rule => ({
          ...rule,
          businessType: rule.businessType || parsed.id,
          templateId: rule.templateId || String(rule.ruleId || '').split('.').pop()
        }))
      };
    }
    const templates = root.OmniAccountingRuleTemplates;
    const definition = {
      id: parsed.id,
      name: parsed.name,
      nameAr: parsed.nameAr || parsed.name,
      aliases: parsed.aliases || [],
      defaultTaxRate: Number(parsed.settings && parsed.settings.defaultTaxRate) || 0,
      inventoryMethod: parsed.settings && parsed.settings.inventoryMethod || 'weighted_average',
      profitMethod: parsed.settings && parsed.settings.profitCalculationMethod || 'invoice_cost'
    };
    const profile = root.OmniBusinessAccountingProfiles.compileProfile(definition);
    const requested = parsed.templates || templates.operationIds;
    return {
      ...profile,
      settings: Object.freeze({ ...profile.settings, ...(parsed.settings || {}), defaultAccounts: { ...profile.settings.defaultAccounts, ...(parsed.settings && parsed.settings.defaultAccounts || {}) } }),
      rules: Object.freeze(profile.rules.filter(rule => requested.includes(rule.templateId)))
    };
  }

  function load(input, options = {}) {
    const profile = materialize(input);
    const checked = validateJsonProfile(profile);
    if (!checked.valid) throw new Error(`Invalid accounting profile: ${checked.errors.join('; ')}`);
    return root.OmniAccountingRuleRegistry.registerProfile(profile, { replace: !!options.replace });
  }

  function loadMany(inputs, options = {}) {
    return inputs.map(input => load(input, options));
  }

  root.OmniAccountingRuleLoader = Object.freeze({
    version: '1.0.0',
    requiredRuleFields: Object.freeze(requiredRuleFields),
    parse,
    validateJsonProfile,
    materialize,
    load,
    loadMany
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
