(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.ThemeSettings = ns.registerSettings('theme', 'Theme Configuration', [
    { key: 'mode', label: 'المظهر', type: 'select', required: true, default: 'light', options: ['light','dark','system'] },
    { key: 'primaryColor', label: 'اللون الأساسي', type: 'color', required: true, default: '#2563eb' },
    { key: 'accentColor', label: 'لون التمييز', type: 'color', required: true, default: '#0ea5e9' },
    { key: 'fontSize', label: 'حجم الخط', type: 'select', required: true, default: 'medium', options: ['small','medium','large'] },
    { key: 'direction', label: 'اتجاه الواجهة', type: 'select', required: true, default: 'rtl', options: ['rtl','ltr'] },
    { key: 'compactSidebar', label: 'قائمة جانبية مدمجة', type: 'checkbox', required: true, default: true },
    { key: 'reducedMotion', label: 'تقليل الحركة', type: 'checkbox', required: true, default: false }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
