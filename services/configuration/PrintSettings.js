(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.PrintSettings = ns.registerSettings('print', 'Print Configuration', [
    { key: 'invoiceTemplate', label: 'قالب الفاتورة', type: 'select', required: true, default: 'standard', options: ['standard','compact','detailed'] },
    { key: 'receiptSize', label: 'حجم الورق', type: 'select', required: true, default: 'A4', options: ['A4','80mm','58mm'] },
    { key: 'showLogo', label: 'إظهار الشعار', type: 'checkbox', required: true, default: true },
    { key: 'showTax', label: 'إظهار الضريبة', type: 'checkbox', required: true, default: true },
    { key: 'footerText', label: 'نص أسفل الفاتورة', type: 'textarea', required: false, default: 'شكرًا لتعاملكم معنا' },
    { key: 'copies', label: 'عدد النسخ', type: 'number', required: true, default: 1, min: 1, max: 5 },
    { key: 'printPreviewFirst', label: 'فتح المعاينة قبل الطباعة', type: 'checkbox', required: true, default: true }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
