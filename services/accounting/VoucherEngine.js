(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const clone = value => ns.AccountingValidator ? ns.AccountingValidator.clone(value) : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const typePrefix = type => String(type || 'JV').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'JV';

  function nextVoucherNumber(state = {}, voucherType = 'JV', date = new Date().toISOString().slice(0, 10)) {
    const prefix = `${typePrefix(voucherType)}-${date.replace(/-/g, '')}`;
    const count = list(state.vouchers).filter(voucher => String(voucher.voucherNumber || '').startsWith(prefix)).length + 1;
    return `${prefix}-${String(count).padStart(4, '0')}`;
  }

  function audit(state, action, payload = {}, user = 'system') {
    const next = clone(state || {});
    next.auditLog = list(next.auditLog);
    next.auditLog.push({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action,
      voucherNumber: payload.voucherNumber || '',
      user,
      at: new Date().toISOString(),
      payload
    });
    return next;
  }

  function create(state = {}, payload = {}, options = {}) {
    const postingDate = payload.postingDate || new Date().toISOString().slice(0, 10);
    const voucher = ns.JournalEngine.createVoucher({
      ...payload,
      voucherNumber: payload.voucherNumber || nextVoucherNumber(state, payload.voucherType, postingDate),
      postingDate
    }, options);
    let next = clone(state);
    next.vouchers = [...list(next.vouchers), voucher];
    next = audit(next, 'create', { voucherNumber: voucher.voucherNumber }, options.user || 'system');
    return Object.freeze({ state: next, voucher });
  }

  function edit(state = {}, voucherNumber, patch = {}, options = {}) {
    let updated = null;
    let next = clone(state);
    next.vouchers = list(next.vouchers).map(voucher => {
      if (voucher.voucherNumber !== voucherNumber) return voucher;
      updated = ns.JournalEngine.createVoucher({ ...voucher, ...patch, lines: patch.lines || voucher.lines });
      return updated;
    });
    next = audit(next, 'edit', { voucherNumber }, options.user || 'system');
    return Object.freeze({ state: next, voucher: updated });
  }

  function remove(state = {}, voucherNumber, options = {}) {
    let next = clone(state);
    next.vouchers = list(next.vouchers).map(voucher => voucher.voucherNumber === voucherNumber ? { ...voucher, status: 'removed' } : voucher);
    next = audit(next, 'delete', { voucherNumber, soft: true }, options.user || 'system');
    return Object.freeze({ state: next });
  }

  ns.VoucherEngine = Object.freeze({
    version: '1.0.0',
    nextVoucherNumber,
    audit,
    create,
    edit,
    remove
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
