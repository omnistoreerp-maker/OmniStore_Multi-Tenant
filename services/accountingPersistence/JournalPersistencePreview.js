(function (root) {
  'use strict';

  const ns = root.OmniAccountingPersistence = root.OmniAccountingPersistence || {};
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));

  function preview(voucher = {}) {
    const mapped = ns.PostingPersistenceMapper.mapPostingPreview(voucher);
    return Object.freeze({
      mode: 'preview-only',
      sqlExecutionPlanned: false,
      willConnectToDatabase: false,
      willPersistAccountingEntry: false,
      mappedRows: mapped,
      warnings: Object.freeze([
        'Draft mapping only. Do not execute without manual DBA review.',
        'RLS and role policies must be reviewed before production execution.'
      ])
    });
  }

  function previewBatch(vouchers = []) {
    return Object.freeze(vouchers.map(voucher => preview(clone(voucher))));
  }

  ns.JournalPersistencePreview = Object.freeze({ version: '1.0.0', preview, previewBatch });
})(typeof globalThis !== 'undefined' ? globalThis : window);
