(function (root) {
  'use strict';

  const impact = (inventory, cash, tax, profit) => ({
    inventoryImpact: inventory,
    cashImpact: cash,
    taxImpact: tax,
    profitImpact: profit
  });
  const rule = config => Object.freeze({
    ruleName: '',
    ruleId: '',
    description: '',
    enabled: true,
    requiredAccounts: [],
    affectedModules: [],
    validationRules: [],
    journalPreview: [],
    ...impact('none', 'none', 'none', 'none'),
    ...config
  });
  const line = (account, side, amount, options = {}) => ({ account, side, amount, ...options });

  const templates = {
    sale: rule({
      ruleName: 'Sales', ruleId: 'sale', description: 'بيع نقدي أو آجل مع التكلفة والضريبة والخصم.',
      requiredAccounts: ['cash', 'accounts_receivable', 'sales_revenue', 'sales_discount', 'tax_payable', 'cost_of_goods_sold', 'inventory_asset'],
      affectedModules: ['sales', 'inventory', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'cost_required', 'stock_available', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('cash_or_receivable', 'debit', 'net_amount'),
        line('sales_discount', 'debit', 'discount'),
        line('sales_revenue', 'credit', 'amount'),
        line('tax_payable', 'credit', 'tax'),
        line('cost_of_goods_sold', 'debit', 'inventory_cost'),
        line('inventory_asset', 'credit', 'inventory_cost')
      ],
      ...impact('decrease by quantity', 'increase by net amount for cash sale', 'output tax increases', 'amount - discount - inventory cost')
    }),
    purchase: rule({
      ruleName: 'Purchase', ruleId: 'purchase', description: 'شراء مخزون نقدي أو آجل.',
      requiredAccounts: ['cash', 'accounts_payable', 'inventory_asset', 'tax_receivable'],
      affectedModules: ['purchases', 'inventory', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('inventory_asset', 'debit', 'purchase_inventory'),
        line('tax_receivable', 'debit', 'tax'),
        line('cash_or_payable', 'credit', 'net_amount')
      ],
      ...impact('increase by quantity', 'decrease for cash purchase', 'input tax increases', 'none until sale')
    }),
    purchase_return: rule({
      ruleName: 'Purchase Return', ruleId: 'purchase_return', description: 'عكس أثر شراء مرتجع.',
      requiredAccounts: ['cash', 'accounts_payable', 'inventory_asset', 'tax_receivable'],
      affectedModules: ['purchases', 'inventory', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'stock_available', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('cash_or_payable', 'debit', 'net_amount'),
        line('inventory_asset', 'credit', 'purchase_inventory'),
        line('tax_receivable', 'credit', 'tax')
      ],
      ...impact('decrease by returned quantity', 'increase or supplier debt decreases', 'input tax reverses', 'none')
    }),
    sales_return: rule({
      ruleName: 'Sales Return', ruleId: 'sales_return', description: 'عكس الإيراد والتكلفة لفاتورة بيع مرتجعة.',
      requiredAccounts: ['cash', 'accounts_receivable', 'sales_returns', 'sales_discount', 'tax_payable', 'cost_of_goods_sold', 'inventory_asset'],
      affectedModules: ['sales', 'inventory', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'cost_required', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('sales_returns', 'debit', 'amount'),
        line('tax_payable', 'debit', 'tax'),
        line('cash_or_receivable', 'credit', 'net_amount'),
        line('sales_discount', 'credit', 'discount'),
        line('inventory_asset', 'debit', 'inventory_cost'),
        line('cost_of_goods_sold', 'credit', 'inventory_cost')
      ],
      ...impact('increase by returned quantity', 'decrease or customer debt decreases', 'output tax reverses', 'original profit reverses')
    }),
    expense: rule({
      ruleName: 'Expense', ruleId: 'expense', description: 'مصروف تشغيلي مدفوع أو مستحق.',
      requiredAccounts: ['cash', 'accounts_payable', 'operating_expense', 'tax_receivable'],
      affectedModules: ['treasury', 'reports'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('operating_expense', 'debit', 'discounted_amount'),
        line('tax_receivable', 'debit', 'tax'),
        line('cash_or_payable', 'credit', 'net_amount')
      ],
      ...impact('none', 'decrease for paid expense', 'input tax may increase', 'decreases profit')
    }),
    income: rule({
      ruleName: 'Income', ruleId: 'income', description: 'إيراد آخر نقدي أو مستحق.',
      requiredAccounts: ['cash', 'accounts_receivable', 'other_income', 'sales_discount', 'tax_payable'],
      affectedModules: ['treasury', 'reports'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid', 'tax_valid', 'discount_valid'],
      journalPreview: [
        line('cash_or_receivable', 'debit', 'net_amount'),
        line('sales_discount', 'debit', 'discount'),
        line('other_income', 'credit', 'amount'),
        line('tax_payable', 'credit', 'tax')
      ],
      ...impact('none', 'increase for received income', 'output tax may increase', 'increases profit')
    }),
    inventory_adjustment: rule({
      ruleName: 'Inventory Adjustment', ruleId: 'inventory_adjustment', description: 'تسوية زيادة أو نقص المخزون.',
      requiredAccounts: ['inventory_asset', 'inventory_adjustment'],
      affectedModules: ['inventory', 'reports'],
      validationRules: ['accounts_exist', 'balanced', 'cost_required', 'stock_available'],
      journalPreview: [
        line('inventory_asset', 'debit', 'inventory_cost', { when: 'inventory_in' }),
        line('inventory_adjustment', 'credit', 'inventory_cost', { when: 'inventory_in' }),
        line('inventory_adjustment', 'debit', 'inventory_cost', { when: 'inventory_out' }),
        line('inventory_asset', 'credit', 'inventory_cost', { when: 'inventory_out' })
      ],
      ...impact('increase or decrease', 'none', 'none', 'adjustment gain or loss')
    }),
    opening_balance: rule({
      ruleName: 'Opening Balance', ruleId: 'opening_balance', description: 'معاينة أرصدة افتتاحية من سطور يحددها المستخدم.',
      requiredAccounts: ['opening_balance_equity'],
      affectedModules: ['reports'],
      validationRules: ['accounts_exist', 'balanced', 'manual_lines_required'],
      journalPreview: [{ source: 'manual_entries' }],
      ...impact('depends on lines', 'depends on lines', 'none', 'opening only')
    }),
    closing_balance: rule({
      ruleName: 'Closing Balance', ruleId: 'closing_balance', description: 'معاينة قيد إقفال دون ترحيل.',
      requiredAccounts: ['retained_earnings'],
      affectedModules: ['reports'],
      validationRules: ['accounts_exist', 'balanced', 'manual_lines_required'],
      journalPreview: [{ source: 'manual_entries' }],
      ...impact('none', 'none', 'none', 'closes temporary accounts')
    }),
    treasury_deposit: rule({
      ruleName: 'Treasury Deposit', ruleId: 'treasury_deposit', description: 'إيداع بالخزنة من حساب وسيط.',
      requiredAccounts: ['cash', 'transfer_clearing'],
      affectedModules: ['treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid'],
      journalPreview: [line('cash', 'debit', 'amount'), line('transfer_clearing', 'credit', 'amount')],
      ...impact('none', 'increase', 'none', 'none')
    }),
    treasury_withdraw: rule({
      ruleName: 'Treasury Withdraw', ruleId: 'treasury_withdraw', description: 'سحب من الخزنة إلى حساب وسيط.',
      requiredAccounts: ['cash', 'transfer_clearing'],
      affectedModules: ['treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid'],
      journalPreview: [line('transfer_clearing', 'debit', 'amount'), line('cash', 'credit', 'amount')],
      ...impact('none', 'decrease', 'none', 'none')
    }),
    customer_payment: rule({
      ruleName: 'Customer Payment', ruleId: 'customer_payment', description: 'تحصيل مديونية عميل.',
      requiredAccounts: ['cash', 'accounts_receivable'],
      affectedModules: ['customers', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid'],
      journalPreview: [line('cash', 'debit', 'amount'), line('accounts_receivable', 'credit', 'amount')],
      ...impact('none', 'increase', 'none', 'none')
    }),
    supplier_payment: rule({
      ruleName: 'Supplier Payment', ruleId: 'supplier_payment', description: 'سداد مديونية مورد.',
      requiredAccounts: ['cash', 'accounts_payable'],
      affectedModules: ['suppliers', 'treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid'],
      journalPreview: [line('accounts_payable', 'debit', 'amount'), line('cash', 'credit', 'amount')],
      ...impact('none', 'decrease', 'none', 'none')
    }),
    internal_transfer: rule({
      ruleName: 'Internal Transfer', ruleId: 'internal_transfer', description: 'تحويل داخلي بين حسابين.',
      requiredAccounts: ['cash', 'transfer_clearing'],
      affectedModules: ['treasury'],
      validationRules: ['accounts_exist', 'balanced', 'currency_valid', 'distinct_transfer_accounts'],
      journalPreview: [line('destination_account', 'debit', 'amount'), line('source_account', 'credit', 'amount')],
      ...impact('none', 'moves without changing total cash', 'none', 'none')
    }),
    manual_journal: rule({
      ruleName: 'Manual Journal', ruleId: 'manual_journal', description: 'معاينة قيد يدوي متوازن.',
      requiredAccounts: [],
      affectedModules: ['reports'],
      validationRules: ['accounts_exist', 'balanced', 'manual_lines_required'],
      journalPreview: [{ source: 'manual_entries' }],
      ...impact('depends on lines', 'depends on lines', 'depends on lines', 'depends on lines')
    })
  };

  root.OmniAccountingRuleTemplates = Object.freeze({
    version: '1.0.0',
    operationIds: Object.freeze(Object.keys(templates)),
    templates: Object.freeze(templates),
    get(id) {
      return templates[id] || null;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
