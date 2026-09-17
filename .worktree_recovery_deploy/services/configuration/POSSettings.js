(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.POSSettings = ns.registerSettings('pos', 'POS Configuration', [
    { key: 'barcodeSearch', label: 'البحث بالباركود', type: 'checkbox', required: true, default: true },
    { key: 'quickProductSearch', label: 'البحث السريع عن المنتج', type: 'checkbox', required: true, default: true },
    { key: 'allowDiscountPreview', label: 'السماح بمعاينة الخصم', type: 'checkbox', required: true, default: true },
    { key: 'maxDiscountPercent', label: 'أقصى خصم %', type: 'number', required: true, default: 20, min: 0, max: 100 },
    { key: 'defaultPaymentMethod', label: 'طريقة الدفع الافتراضية', type: 'select', required: true, default: 'cash', options: ['cash','card','credit','mixed'] },
    { key: 'showStockDuringSale', label: 'إظهار المخزون أثناء البيع', type: 'checkbox', required: true, default: true },
    { key: 'warnLowStock', label: 'تحذير المخزون المنخفض', type: 'checkbox', required: true, default: true },
    { key: 'receiptAfterSale', label: 'فتح معاينة الإيصال بعد البيع', type: 'checkbox', required: true, default: true }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
