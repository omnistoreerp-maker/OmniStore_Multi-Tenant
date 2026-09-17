(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.InventorySettings = ns.registerSettings('inventory', 'Inventory Configuration', [
    { key: 'costMethod', label: 'طريقة التكلفة', type: 'select', required: true, default: 'average', options: ['average','fifo'] },
    { key: 'multiWarehouse', label: 'تعدد المخازن', type: 'checkbox', required: true, default: true },
    { key: 'allowNegativeStock', label: 'السماح بالمخزون السالب', type: 'checkbox', required: true, default: false },
    { key: 'reservationEnabled', label: 'حجز الكميات', type: 'checkbox', required: true, default: true },
    { key: 'serialTracking', label: 'تتبع السيريال', type: 'checkbox', required: true, default: true },
    { key: 'batchTracking', label: 'تتبع التشغيلة/الدفعة', type: 'checkbox', required: true, default: false },
    { key: 'expiryTracking', label: 'تتبع الصلاحية', type: 'checkbox', required: true, default: false },
    { key: 'reorderEnabled', label: 'تنبيه إعادة الطلب', type: 'checkbox', required: true, default: true },
    { key: 'defaultReorderLevel', label: 'حد إعادة الطلب الافتراضي', type: 'number', required: true, default: 5, min: 0 }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
