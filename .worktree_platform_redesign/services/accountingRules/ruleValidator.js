(function (root) {
  'use strict';

  const money = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
  const requiredFields = root.OmniAccountingRuleLoader
    ? root.OmniAccountingRuleLoader.requiredRuleFields
    : ['ruleName', 'ruleId', 'description', 'enabled', 'requiredAccounts', 'affectedModules', 'validationRules', 'journalPreview', 'inventoryImpact', 'cashImpact', 'taxImpact', 'profitImpact'];

  function issue(code, severity, message, details = {}) {
    return { code, severity, message, ...details };
  }

  function validateRule(rule) {
    const errors = [];
    if (!rule || typeof rule !== 'object') return { valid: false, errors: [issue('RULE_INVALID', 'error', 'Rule must be an object')] };
    requiredFields.forEach(field => {
      if (!(field in rule)) errors.push(issue('RULE_FIELD_MISSING', 'error', `Missing rule field: ${field}`, { field }));
    });
    if (rule.enabled !== true && rule.enabled !== false) errors.push(issue('RULE_ENABLED_INVALID', 'error', 'enabled must be boolean'));
    ['requiredAccounts', 'affectedModules', 'validationRules', 'journalPreview'].forEach(field => {
      if (!Array.isArray(rule[field])) errors.push(issue('RULE_ARRAY_INVALID', 'error', `${field} must be an array`, { field }));
    });
    return { valid: errors.length === 0, errors };
  }

  function validateExecution(rule, context, settings, lines) {
    const errors = [];
    const warnings = [];
    const configuredChecks = rule.validationRules || [];
    const checks = new Set(settings.enableAccountingValidation === false
      ? configuredChecks.filter(check => ['accounts_exist', 'balanced'].includes(check))
      : configuredChecks);
    const add = item => (item.severity === 'warning' ? warnings : errors).push(item);
    const amount = Number(context.amount || 0);
    const profitMethod = settings.profitCalculationMethod || 'invoice_cost';
    const methodCost = {
      serial_cost: context.serialCost,
      batch_cost: context.batchCost,
      recipe_cost: context.recipeCost,
      invoice_cost: context.cost
    };
    const cost = Number(methodCost[profitMethod] ?? context.cost ?? 0);
    const quantity = Number(context.quantity || 0);
    const tax = Number(context.tax || 0);
    const discount = Number(context.discount || 0);

    if (!Number.isFinite(amount) || amount < 0) add(issue('AMOUNT_INVALID', 'error', 'Amount must be a non-negative number'));
    if (!Number.isFinite(quantity) || quantity < 0) add(issue('QUANTITY_INVALID', 'error', 'Quantity must be a non-negative number'));

    if (checks.has('accounts_exist')) {
      (rule.requiredAccounts || []).forEach(accountToken => {
        const accountKey = root.OmniAccountingRuleExecutor
          ? root.OmniAccountingRuleExecutor.resolveAccount(accountToken, context, settings)
          : accountToken;
        if (!root.OmniChartOfAccounts || !root.OmniChartOfAccounts.get(accountKey)) {
          add(issue('REQUIRED_ACCOUNT_MISSING', 'error', `Required account is missing: ${accountToken}`, { accountToken, accountKey }));
        }
      });
      (lines || []).forEach((line, index) => {
        if (!line.accountKey || !root.OmniChartOfAccounts || !root.OmniChartOfAccounts.get(line.accountKey)) {
          add(issue('ACCOUNT_MISSING', 'error', `Missing account at journal line ${index + 1}`, { line: index + 1, accountKey: line.accountKey || '' }));
        }
      });
    }

    const debit = money((lines || []).reduce((sum, line) => sum + Number(line.debit || 0), 0));
    const credit = money((lines || []).reduce((sum, line) => sum + Number(line.credit || 0), 0));
    if (checks.has('balanced') && Math.abs(debit - credit) > 0.01) {
      add(issue('JOURNAL_UNBALANCED', 'error', 'Debit must equal Credit', { debit, credit, difference: money(debit - credit) }));
    }

    if (checks.has('cost_required') && (!(cost > 0) || !(quantity > 0))) {
      add(issue('COST_REQUIRED', 'error', 'A positive unit cost and quantity are required'));
    }

    if (checks.has('stock_available') && !settings.allowNegativeStock) {
      const direction = String(context.inventoryDirection || '').toLowerCase();
      const reducesStock = ['sale', 'purchase_return'].includes(rule.templateId) || (rule.templateId === 'inventory_adjustment' && direction === 'out');
      const available = Number(context.availableStock);
      if (reducesStock && Number.isFinite(available) && quantity > available) {
        add(issue('INSUFFICIENT_STOCK', 'error', 'Available stock is less than required quantity', { availableStock: available, requiredQuantity: quantity }));
      }
    }

    if (checks.has('currency_valid')) {
      const expected = String(settings.currency || 'EGP').toUpperCase();
      const actual = String(context.currency || expected).toUpperCase();
      if (actual !== expected) add(issue('CURRENCY_MISMATCH', 'error', `Currency must be ${expected}`, { expected, actual }));
    }

    if (checks.has('tax_valid')) {
      if (!Number.isFinite(tax) || tax < 0 || tax > Math.max(0, amount)) add(issue('TAX_INVALID', 'error', 'Tax must be between zero and the operation amount'));
      if (context.taxRate != null) {
        const rate = Number(context.taxRate);
        const expectedTax = money(Math.max(0, amount - discount) * rate / 100);
        if (!Number.isFinite(rate) || rate < 0 || rate > 100 || Math.abs(expectedTax - tax) > 0.01) {
          add(issue('TAX_CALCULATION_MISMATCH', 'error', 'Tax does not match the supplied tax rate', { expectedTax, actualTax: money(tax), taxRate: rate }));
        }
      }
    }

    if (checks.has('discount_valid') && (!Number.isFinite(discount) || discount < 0 || discount > Math.max(0, amount))) {
      add(issue('DISCOUNT_INVALID', 'error', 'Discount must be between zero and the operation amount'));
    }

    if (checks.has('manual_lines_required') && (!Array.isArray(context.entries) || !context.entries.length)) {
      add(issue('MANUAL_LINES_REQUIRED', 'error', 'At least one manual journal line is required'));
    }

    if (checks.has('distinct_transfer_accounts')) {
      const source = String(context.sourceAccount || settings.defaultAccounts.cash || '');
      const destination = String(context.destinationAccount || settings.defaultAccounts.transferClearing || '');
      if (source === destination) add(issue('TRANSFER_ACCOUNTS_SAME', 'error', 'Source and destination accounts must be different'));
    }

    return {
      valid: errors.length === 0,
      balanced: Math.abs(debit - credit) <= 0.01,
      debit,
      credit,
      difference: money(debit - credit),
      errors,
      warnings
    };
  }

  root.OmniAccountingRuleValidator = Object.freeze({
    version: '1.0.0',
    validateRule,
    validateExecution
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
