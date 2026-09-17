(function (root) {
  'use strict';

  const clone = value => JSON.parse(JSON.stringify(value));
  const definitions = [
    { id: 'computer_shop', name: 'Computer Shop', nameAr: 'محل كمبيوتر', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: ['computer-store'] },
    { id: 'mobile_shop', name: 'Mobile Shop', nameAr: 'محل موبايلات', defaultTaxRate: 0, inventoryMethod: 'specific_identification', profitMethod: 'serial_cost', aliases: [] },
    { id: 'car_parts', name: 'Car Parts', nameAr: 'قطع غيار سيارات', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: ['auto_parts'] },
    { id: 'electronics', name: 'Electronics', nameAr: 'إلكترونيات', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: [] },
    { id: 'restaurant', name: 'Restaurant', nameAr: 'مطعم', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'recipe_cost', aliases: [] },
    { id: 'pharmacy', name: 'Pharmacy', nameAr: 'صيدلية', defaultTaxRate: 0, inventoryMethod: 'fifo', profitMethod: 'batch_cost', aliases: [] },
    { id: 'clothes', name: 'Clothes', nameAr: 'ملابس', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: ['fashion'] },
    { id: 'supermarket', name: 'Supermarket', nameAr: 'سوبر ماركت', defaultTaxRate: 0, inventoryMethod: 'fifo', profitMethod: 'invoice_cost', aliases: ['grocery'] },
    { id: 'hardware', name: 'Hardware', nameAr: 'أدوات ومستلزمات', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: [] },
    { id: 'furniture', name: 'Furniture', nameAr: 'أثاث', defaultTaxRate: 0, inventoryMethod: 'specific_identification', profitMethod: 'invoice_cost', aliases: [] },
    { id: 'beauty', name: 'Beauty', nameAr: 'تجميل وعناية', defaultTaxRate: 0, inventoryMethod: 'fifo', profitMethod: 'invoice_cost', aliases: [] },
    { id: 'general_store', name: 'General Store', nameAr: 'متجر عام', defaultTaxRate: 0, inventoryMethod: 'weighted_average', profitMethod: 'invoice_cost', aliases: ['generic_store'] }
  ];

  const accountDefaults = Object.freeze({
    cash: 'cash',
    receivable: 'accounts_receivable',
    inventory: 'inventory_asset',
    taxReceivable: 'tax_receivable',
    payable: 'accounts_payable',
    taxPayable: 'tax_payable',
    revenue: 'sales_revenue',
    otherIncome: 'other_income',
    salesReturns: 'sales_returns',
    cogs: 'cost_of_goods_sold',
    expense: 'operating_expense',
    adjustment: 'inventory_adjustment',
    discount: 'sales_discount',
    transferClearing: 'transfer_clearing',
    openingEquity: 'opening_balance_equity',
    retainedEarnings: 'retained_earnings'
  });

  function compileRule(profileId, template) {
    const result = clone(template);
    result.templateId = template.ruleId;
    result.ruleId = `${profileId}.${template.ruleId}`;
    result.businessType = profileId;
    return Object.freeze(result);
  }

  function compileProfile(definition) {
    const templates = root.OmniAccountingRuleTemplates;
    if (!templates) throw new Error('Accounting rule templates must load before business profiles');
    const rules = templates.operationIds.map(operation => compileRule(definition.id, templates.get(operation)));
    return Object.freeze({
      id: definition.id,
      name: definition.name,
      nameAr: definition.nameAr,
      version: '1.0.0',
      enabled: true,
      aliases: Object.freeze(definition.aliases || []),
      settings: Object.freeze({
        defaultTaxRate: definition.defaultTaxRate,
        inventoryMethod: definition.inventoryMethod,
        profitCalculationMethod: definition.profitMethod,
        allowNegativeStock: false,
        autoJournalPreview: true,
        enableAccountingValidation: true,
        currency: 'EGP',
        defaultAccounts: accountDefaults
      }),
      rules: Object.freeze(rules)
    });
  }

  const profiles = definitions.map(compileProfile);
  const byId = profiles.reduce((map, profile) => {
    map[profile.id] = profile;
    profile.aliases.forEach(alias => { map[alias] = profile; });
    return map;
  }, {});

  root.OmniBusinessAccountingProfiles = Object.freeze({
    version: '1.0.0',
    definitions: Object.freeze(definitions.map(item => Object.freeze(clone(item)))),
    profiles: Object.freeze(profiles),
    accountDefaults,
    get(id) {
      return byId[String(id || '').trim()] || byId.computer_shop;
    },
    compileProfile
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
