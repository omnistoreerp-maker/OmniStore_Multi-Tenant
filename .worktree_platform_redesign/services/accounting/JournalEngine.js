(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const money = value => (ns.AccountingValidator ? ns.AccountingValidator.money(value) : Math.round((Number(value) || 0) * 100) / 100);
  const list = value => Array.isArray(value) ? value : [];
  const text = value => String(value == null ? '' : value).trim();

  function createLine(input = {}, defaults = {}) {
    const exchangeRate = Number(input.exchangeRate || defaults.exchangeRate || 1);
    const debit = money(input.debit);
    const credit = money(input.credit);
    return Object.freeze({
      id: input.id || `line-${Math.random().toString(36).slice(2, 10)}`,
      account: text(input.account),
      debit,
      credit,
      currency: text(input.currency || defaults.currency || 'EGP'),
      exchangeRate,
      baseDebit: money(input.baseDebit != null ? input.baseDebit : debit * exchangeRate),
      baseCredit: money(input.baseCredit != null ? input.baseCredit : credit * exchangeRate),
      costCenter: text(input.costCenter || defaults.costCenter),
      branch: text(input.branch || defaults.branch),
      project: text(input.project || defaults.project),
      notes: text(input.notes)
    });
  }

  function createVoucher(payload = {}, options = {}) {
    const defaults = {
      currency: payload.currency || options.currency || 'EGP',
      exchangeRate: payload.exchangeRate || options.exchangeRate || 1,
      branch: payload.branch || options.branch || '',
      costCenter: payload.costCenter || options.costCenter || '',
      project: payload.project || options.project || ''
    };
    const lines = list(payload.lines).map(line => createLine(line, defaults));
    const totals = lines.reduce((sum, line) => ({
      debit: money(sum.debit + line.baseDebit),
      credit: money(sum.credit + line.baseCredit)
    }), { debit: 0, credit: 0 });

    return Object.freeze({
      id: payload.id || `voucher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      voucherNumber: text(payload.voucherNumber || options.voucherNumber),
      voucherType: text(payload.voucherType || options.voucherType || 'JV'),
      postingDate: text(payload.postingDate || new Date().toISOString().slice(0, 10)),
      reference: text(payload.reference),
      description: text(payload.description),
      businessProfile: text(payload.businessProfile || options.businessProfile || 'computer_shop'),
      status: text(payload.status || 'draft'),
      createdBy: text(payload.createdBy || options.user || 'system'),
      createdAt: payload.createdAt || new Date().toISOString(),
      reversedFrom: payload.reversedFrom || null,
      reversalVoucherNumber: payload.reversalVoucherNumber || null,
      lines: Object.freeze(lines),
      totals: Object.freeze({ ...totals, difference: money(totals.debit - totals.credit) })
    });
  }

  function cloneWithStatus(voucher, status, patch = {}) {
    return createVoucher({ ...voucher, ...patch, status, lines: list(voucher.lines) });
  }

  ns.JournalEngine = Object.freeze({
    version: '1.0.0',
    createLine,
    createVoucher,
    cloneWithStatus
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
