(function (root) {
  'use strict';

  const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const accountSettingMap = {
    cash: 'cash',
    accounts_receivable: 'receivable',
    inventory_asset: 'inventory',
    tax_receivable: 'taxReceivable',
    accounts_payable: 'payable',
    tax_payable: 'taxPayable',
    retained_earnings: 'retainedEarnings',
    opening_balance_equity: 'openingEquity',
    sales_revenue: 'revenue',
    other_income: 'otherIncome',
    sales_returns: 'salesReturns',
    cost_of_goods_sold: 'cogs',
    operating_expense: 'expense',
    inventory_adjustment: 'adjustment',
    sales_discount: 'discount',
    transfer_clearing: 'transferClearing'
  };

  function values(context, settings = {}) {
    const amount = money(Math.max(0, Number(context.amount || 0)));
    const discount = money(Math.max(0, Number(context.discount || 0)));
    const tax = money(Math.max(0, Number(context.tax || 0)));
    const quantity = Math.max(0, Number(context.quantity || 0));
    const profitMethod = settings.profitCalculationMethod || 'invoice_cost';
    const costByMethod = {
      serial_cost: context.serialCost,
      batch_cost: context.batchCost,
      recipe_cost: context.recipeCost,
      invoice_cost: context.cost
    };
    const unitCost = money(Math.max(0, Number(costByMethod[profitMethod] ?? context.cost ?? 0)));
    return {
      amount,
      discount,
      tax,
      quantity,
      unitCost,
      net_amount: money(amount - discount + tax),
      discounted_amount: money(amount - discount),
      purchase_inventory: money(amount - discount),
      inventory_cost: money(unitCost * quantity)
    };
  }

  function resolveAccount(token, context, settings) {
    const defaults = settings.defaultAccounts || {};
    if (token === 'cash_or_receivable') return ['credit', 'ajel', 'installment'].includes(String(context.paymentType || '').toLowerCase())
      ? defaults.receivable || 'accounts_receivable'
      : defaults.cash || 'cash';
    if (token === 'cash_or_payable') return ['credit', 'ajel', 'deferred'].includes(String(context.paymentType || '').toLowerCase())
      ? defaults.payable || 'accounts_payable'
      : defaults.cash || 'cash';
    if (token === 'source_account') return context.sourceAccount || defaults.cash || 'cash';
    if (token === 'destination_account') return context.destinationAccount || defaults.transferClearing || 'transfer_clearing';
    const settingName = accountSettingMap[token];
    return settingName && defaults[settingName] || token;
  }

  function conditionMatches(condition, context) {
    if (!condition) return true;
    if (condition === 'inventory_in') return String(context.inventoryDirection || 'in').toLowerCase() === 'in';
    if (condition === 'inventory_out') return String(context.inventoryDirection || '').toLowerCase() === 'out';
    return true;
  }

  function buildLine(accountKey, side, amount, memo) {
    const account = root.OmniChartOfAccounts && root.OmniChartOfAccounts.get(accountKey);
    const safeAmount = money(amount);
    return {
      accountKey,
      accountCode: account ? account.code : '',
      accountName: account ? account.name : accountKey,
      accountNameAr: account ? account.nameAr : accountKey,
      debit: side === 'debit' ? safeAmount : 0,
      credit: side === 'credit' ? safeAmount : 0,
      memo: memo || ''
    };
  }

  function buildLines(rule, context, settings, computed) {
    const lines = [];
    (rule.journalPreview || []).forEach(definition => {
      if (definition.source === 'manual_entries') {
        (context.entries || []).forEach(entry => {
          const accountKey = resolveAccount(entry.accountKey || entry.account, context, settings);
          lines.push(buildLine(accountKey, Number(entry.debit) > 0 ? 'debit' : 'credit', Number(entry.debit) > 0 ? entry.debit : entry.credit, entry.memo));
        });
        return;
      }
      if (!conditionMatches(definition.when, context)) return;
      const accountKey = resolveAccount(definition.account, context, settings);
      lines.push(buildLine(accountKey, definition.side, computed[definition.amount] ?? Number(definition.amount || 0), `${rule.ruleName} preview`));
    });
    return lines;
  }

  function calculateEffects(rule, context, computed) {
    const cashOperation = !['credit', 'ajel', 'installment', 'deferred'].includes(String(context.paymentType || '').toLowerCase());
    const direction = String(context.inventoryDirection || 'in').toLowerCase();
    let inventoryDelta = 0;
    let cashDelta = 0;
    let profitDelta = 0;
    let inputTaxDelta = 0;
    let outputTaxDelta = 0;
    const quantity = computed.quantity;

    if (rule.templateId === 'sale') { inventoryDelta = -quantity; cashDelta = cashOperation ? computed.net_amount : 0; profitDelta = money(computed.amount - computed.discount - computed.inventory_cost); outputTaxDelta = computed.tax; }
    if (rule.templateId === 'purchase') { inventoryDelta = quantity; cashDelta = cashOperation ? -computed.net_amount : 0; inputTaxDelta = computed.tax; }
    if (rule.templateId === 'purchase_return') { inventoryDelta = -quantity; cashDelta = cashOperation ? computed.net_amount : 0; inputTaxDelta = -computed.tax; }
    if (rule.templateId === 'sales_return') { inventoryDelta = quantity; cashDelta = cashOperation ? -computed.net_amount : 0; profitDelta = -money(computed.amount - computed.discount - computed.inventory_cost); outputTaxDelta = -computed.tax; }
    if (rule.templateId === 'expense') { cashDelta = cashOperation ? -computed.net_amount : 0; profitDelta = -computed.discounted_amount; inputTaxDelta = computed.tax; }
    if (rule.templateId === 'income') { cashDelta = cashOperation ? computed.net_amount : 0; profitDelta = computed.discounted_amount; outputTaxDelta = computed.tax; }
    if (rule.templateId === 'inventory_adjustment') inventoryDelta = direction === 'out' ? -quantity : quantity;
    if (['treasury_deposit', 'customer_payment'].includes(rule.templateId)) cashDelta = computed.amount;
    if (['treasury_withdraw', 'supplier_payment'].includes(rule.templateId)) cashDelta = -computed.amount;

    return {
      inventory: { description: rule.inventoryImpact, quantityDelta: inventoryDelta, valueDelta: money(inventoryDelta * computed.unitCost) },
      cash: { description: rule.cashImpact, amountDelta: money(cashDelta) },
      tax: { description: rule.taxImpact, inputTaxDelta: money(inputTaxDelta), outputTaxDelta: money(outputTaxDelta) },
      profit: { description: rule.profitImpact, amountDelta: money(profitDelta) }
    };
  }

  function execute(rule, context = {}, settings = {}) {
    if (!rule || !rule.enabled) {
      return { preview: true, readOnly: true, valid: false, lines: [], validation: { valid: false, errors: [{ code: 'RULE_DISABLED', severity: 'error', message: 'Rule is disabled' }], warnings: [] } };
    }
    const computed = values(context, settings);
    const lines = buildLines(rule, context, settings, computed);
    const validation = root.OmniAccountingRuleValidator.validateExecution(rule, context, settings, lines);
    return Object.freeze({
      id: `rule-preview:${rule.ruleId}:${Date.now()}`,
      preview: true,
      readOnly: true,
      persisted: false,
      ruleId: rule.ruleId,
      ruleName: rule.ruleName,
      businessType: rule.businessType,
      operation: rule.templateId,
      context: Object.freeze({ ...context }),
      computed: Object.freeze(computed),
      methods: Object.freeze({
        inventoryMethod: settings.inventoryMethod || 'weighted_average',
        profitCalculationMethod: settings.profitCalculationMethod || 'invoice_cost'
      }),
      lines: Object.freeze(lines),
      totals: Object.freeze({ debit: validation.debit, credit: validation.credit, difference: validation.difference }),
      balanced: validation.balanced,
      valid: validation.valid,
      validation: Object.freeze(validation),
      effects: Object.freeze(calculateEffects(rule, context, computed))
    });
  }

  root.OmniAccountingRuleExecutor = Object.freeze({
    version: '1.0.0',
    mode: 'preview-only',
    values,
    resolveAccount,
    buildLines,
    calculateEffects,
    execute
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
