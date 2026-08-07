(function (root) {
  'use strict';

  const STORAGE_KEY = 'omnistore_accounting_rules_settings_v1';
  const defaults = Object.freeze({
    defaultTaxRate: 0,
    inventoryMethod: 'weighted_average',
    profitCalculationMethod: 'invoice_cost',
    allowNegativeStock: false,
    autoJournalPreview: true,
    enableAccountingValidation: true,
    currency: 'EGP',
    defaultAccounts: Object.freeze({ ...root.OmniBusinessAccountingProfiles.accountDefaults })
  });

  function normalize(input = {}) {
    const tax = Number(input.defaultTaxRate);
    return {
      ...defaults,
      ...input,
      defaultTaxRate: Number.isFinite(tax) ? Math.min(100, Math.max(0, tax)) : 0,
      allowNegativeStock: input.allowNegativeStock === true,
      autoJournalPreview: input.autoJournalPreview !== false,
      enableAccountingValidation: input.enableAccountingValidation !== false,
      currency: String(input.currency || 'EGP').toUpperCase(),
      defaultAccounts: { ...defaults.defaultAccounts, ...(input.defaultAccounts || {}) }
    };
  }

  function load() {
    try {
      const value = root.localStorage && root.localStorage.getItem(STORAGE_KEY);
      return normalize(value ? JSON.parse(value) : {});
    } catch (_) {
      return normalize({});
    }
  }

  function save(input) {
    const value = normalize(input);
    if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    return value;
  }

  function reset() {
    if (root.localStorage) root.localStorage.removeItem(STORAGE_KEY);
    return normalize({});
  }

  root.OmniAccountingRulesSettings = Object.freeze({
    version: '1.0.0',
    storageKey: STORAGE_KEY,
    defaults,
    normalize,
    load,
    save,
    reset
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
