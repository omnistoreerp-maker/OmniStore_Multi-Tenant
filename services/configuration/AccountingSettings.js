(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.AccountingSettings = ns.registerSettings('accounting', 'Accounting Configuration', [
    { key: 'validationEnabled', label: 'تفعيل التحقق المحاسبي', type: 'checkbox', required: true, default: true },
    { key: 'autoPreview', label: 'إظهار معاينة القيد تلقائيًا', type: 'checkbox', required: true, default: true },
    { key: 'postingEnabled', label: 'الترحيل المحاسبي الفعلي', type: 'checkbox', required: true, default: false, locked: true },
    { key: 'inventoryMethod', label: 'طريقة تقييم المخزون', type: 'select', required: true, default: 'average', options: ['average','fifo'] },
    { key: 'profitMethod', label: 'طريقة حساب الربح', type: 'select', required: true, default: 'gross_margin', options: ['gross_margin','net_margin'] },
    { key: 'defaultCashAccount', label: 'حساب النقدية الافتراضي', type: 'text', required: true, default: 'cash_on_hand' },
    { key: 'defaultRevenueAccount', label: 'حساب الإيراد الافتراضي', type: 'text', required: true, default: 'sales_revenue' },
    { key: 'defaultCOGSAccount', label: 'حساب تكلفة المبيعات', type: 'text', required: true, default: 'cost_of_sales' },
    { key: 'defaultInventoryAccount', label: 'حساب المخزون', type: 'text', required: true, default: 'inventory_asset' },
    { key: 'defaultTaxRate', label: 'نسبة الضريبة الافتراضية', type: 'number', required: true, default: 0, min: 0, max: 100 }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
