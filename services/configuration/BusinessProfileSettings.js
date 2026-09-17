(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  const sections = ns.sections = ns.sections || {};
  function register(id, title, fields) {
    sections[id] = Object.freeze({ id, title, fields: Object.freeze(fields.map(field => Object.freeze(field))) });
    return sections[id];
  }
  ns.registerSettings = register;
  ns.BusinessProfileSettings = register('businessProfile', 'Business Profile', [
    { key: 'companyName', label: 'اسم الشركة', type: 'text', required: true, default: 'OmniStore ERP' },
    { key: 'companyPhone', label: 'هاتف الشركة', type: 'text', required: false, default: '' },
    { key: 'companyAddress', label: 'عنوان الشركة', type: 'textarea', required: false, default: '' },
    { key: 'taxNumber', label: 'الرقم الضريبي', type: 'text', required: false, default: '' },
    { key: 'businessType', label: 'نوع النشاط', type: 'select', required: true, default: 'computer_shop', options: ['computer_shop','auto_parts','restaurant','supermarket','pharmacy','mobile_shop','clothes','jewelry','hardware','bookstore','agriculture','generic_store'] },
    { key: 'currency', label: 'العملة', type: 'select', required: true, default: 'EGP', options: ['EGP','USD','EUR','SAR','AED'] },
    { key: 'currencySymbol', label: 'رمز العملة', type: 'text', required: true, default: 'ج.م' },
    { key: 'language', label: 'اللغة الافتراضية', type: 'select', required: true, default: 'ar', options: ['ar','en'] },
    { key: 'timezone', label: 'المنطقة الزمنية', type: 'text', required: true, default: 'Africa/Cairo' },
    { key: 'dateFormat', label: 'تنسيق التاريخ', type: 'select', required: true, default: 'DD/MM/YYYY', options: ['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD'] }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
