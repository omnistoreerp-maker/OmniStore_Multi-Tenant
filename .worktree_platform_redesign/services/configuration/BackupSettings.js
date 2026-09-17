(function (root) {
  'use strict';
  const ns = root.OmniConfiguration = root.OmniConfiguration || {};
  ns.BackupSettings = ns.registerSettings('backup', 'Backup Configuration', [
    { key: 'exportFormat', label: 'صيغة التصدير', type: 'select', required: true, default: 'json', options: ['json','zip'] },
    { key: 'includeConfiguration', label: 'تضمين الإعدادات', type: 'checkbox', required: true, default: true },
    { key: 'includeAttachments', label: 'تضمين المرفقات', type: 'checkbox', required: true, default: false },
    { key: 'encryptionPreview', label: 'معاينة التشفير', type: 'checkbox', required: true, default: false },
    { key: 'automaticBackupEnabled', label: 'النسخ التلقائي الفعلي', type: 'checkbox', required: true, default: false, locked: true },
    { key: 'retentionCopies', label: 'عدد النسخ المقترح الاحتفاظ بها', type: 'number', required: true, default: 7, min: 1 }
  ]);
})(typeof globalThis !== 'undefined' ? globalThis : window);
