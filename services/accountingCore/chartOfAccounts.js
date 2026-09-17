(function (root) {
  'use strict';

  const accounts = [
    { code: '1000', key: 'cash', name: 'Cash / Treasury', nameAr: 'النقدية والخزنة', type: 'asset', normalSide: 'debit' },
    { code: '1010', key: 'transfer_clearing', name: 'Internal Transfer Clearing', nameAr: 'حساب وسيط للتحويلات', type: 'asset', normalSide: 'debit' },
    { code: '1100', key: 'accounts_receivable', name: 'Accounts Receivable', nameAr: 'العملاء (مدينون)', type: 'asset', normalSide: 'debit' },
    { code: '1200', key: 'inventory_asset', name: 'Inventory Asset', nameAr: 'أصل المخزون', type: 'asset', normalSide: 'debit' },
    { code: '1300', key: 'tax_receivable', name: 'Tax Receivable', nameAr: 'ضريبة مدخلات قابلة للاسترداد', type: 'asset', normalSide: 'debit' },
    { code: '2000', key: 'accounts_payable', name: 'Accounts Payable', nameAr: 'الموردون (دائنون)', type: 'liability', normalSide: 'credit' },
    { code: '2100', key: 'tax_payable', name: 'Tax Payable', nameAr: 'ضريبة مخرجات مستحقة', type: 'liability', normalSide: 'credit' },
    { code: '3000', key: 'retained_earnings', name: 'Retained Earnings', nameAr: 'الأرباح المحتجزة', type: 'equity', normalSide: 'credit' },
    { code: '3100', key: 'opening_balance_equity', name: 'Opening Balance Equity', nameAr: 'حقوق أرصدة افتتاحية', type: 'equity', normalSide: 'credit' },
    { code: '4000', key: 'sales_revenue', name: 'Sales Revenue', nameAr: 'إيراد المبيعات', type: 'revenue', normalSide: 'credit' },
    { code: '4100', key: 'other_income', name: 'Other Income', nameAr: 'إيرادات أخرى', type: 'revenue', normalSide: 'credit' },
    { code: '4200', key: 'sales_returns', name: 'Sales Returns', nameAr: 'مردودات المبيعات', type: 'contra_revenue', normalSide: 'debit' },
    { code: '5000', key: 'cost_of_goods_sold', name: 'Cost of Goods Sold', nameAr: 'تكلفة البضاعة المباعة', type: 'expense', normalSide: 'debit' },
    { code: '5100', key: 'purchase_expense', name: 'Purchase Expense', nameAr: 'مصروف المشتريات المباشر', type: 'expense', normalSide: 'debit' },
    { code: '5200', key: 'operating_expense', name: 'Operating Expense', nameAr: 'المصروفات التشغيلية', type: 'expense', normalSide: 'debit' },
    { code: '5300', key: 'inventory_adjustment', name: 'Inventory Adjustment', nameAr: 'فروق تسوية المخزون', type: 'expense', normalSide: 'debit' },
    { code: '5400', key: 'sales_discount', name: 'Sales Discount', nameAr: 'خصم مسموح به', type: 'contra_revenue', normalSide: 'debit' }
  ].map(Object.freeze);

  const byKey = Object.freeze(accounts.reduce((result, account) => {
    result[account.key] = account;
    return result;
  }, {}));

  root.OmniChartOfAccounts = Object.freeze({
    version: '1.0.0-preview',
    accounts: Object.freeze(accounts),
    byKey,
    get(key) {
      return byKey[key] || null;
    }
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
