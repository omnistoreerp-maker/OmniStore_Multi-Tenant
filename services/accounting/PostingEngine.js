(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const clone = value => ns.AccountingValidator ? ns.AccountingValidator.clone(value) : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];

  function preview(voucher, state = {}, options = {}) {
    const validation = ns.AccountingValidator.validateVoucher(voucher, state, { ...options, action: 'preview' });
    return Object.freeze({
      voucher,
      validation,
      affectedAccounts: ns.AccountBalanceEngine.previewBalances(voucher, state, options.filters || {}),
      trialBalanceBefore: ns.TrialBalanceEngine.beforePosting(voucher, state, options.filters || {}),
      trialBalanceAfter: ns.TrialBalanceEngine.afterPosting(voucher, state, options.filters || {})
    });
  }

  function post(voucher, state = {}, options = {}) {
    const validation = ns.AccountingValidator.validateVoucher(voucher, state, { ...options, action: 'post' });
    if (!validation.valid) return Object.freeze({ state: clone(state), voucher, validation, posted: false });
    let next = clone(state);
    const postedVoucher = ns.JournalEngine.cloneWithStatus(voucher, 'posted', { postedAt: new Date().toISOString(), postedBy: options.user || 'system' });
    const found = list(next.vouchers).some(item => item.voucherNumber === postedVoucher.voucherNumber);
    next.vouchers = found
      ? list(next.vouchers).map(item => item.voucherNumber === postedVoucher.voucherNumber ? postedVoucher : item)
      : [...list(next.vouchers), postedVoucher];
    next = ns.VoucherEngine.audit(next, 'post', { voucherNumber: postedVoucher.voucherNumber }, options.user || 'system');
    return Object.freeze({ state: next, voucher: postedVoucher, validation, posted: true });
  }

  function unPost(voucherNumber, state = {}, options = {}) {
    let next = clone(state);
    let voucher = null;
    next.vouchers = list(next.vouchers).map(item => {
      if (item.voucherNumber !== voucherNumber) return item;
      voucher = ns.JournalEngine.cloneWithStatus(item, 'draft');
      return voucher;
    });
    next = ns.VoucherEngine.audit(next, 'unpost', { voucherNumber }, options.user || 'system');
    return Object.freeze({ state: next, voucher, unposted: !!voucher });
  }

  function reverse(voucherNumber, state = {}, options = {}) {
    const original = list(state.vouchers).find(item => item.voucherNumber === voucherNumber);
    if (!original) return Object.freeze({ state: clone(state), reversed: false, validation: { valid: false, errors: [{ code: 'VOUCHER_NOT_FOUND' }] } });
    const reversal = ns.JournalEngine.createVoucher({
      voucherType: `${original.voucherType}-REV`,
      voucherNumber: options.voucherNumber || ns.VoucherEngine.nextVoucherNumber(state, `${original.voucherType}R`, options.postingDate || original.postingDate),
      postingDate: options.postingDate || original.postingDate,
      reference: `Reverse ${original.voucherNumber}`,
      description: options.description || `Reversal for ${original.voucherNumber}`,
      businessProfile: original.businessProfile,
      reversedFrom: original.voucherNumber,
      lines: list(original.lines).map(line => ({ ...line, debit: line.credit, credit: line.debit, baseDebit: line.baseCredit, baseCredit: line.baseDebit }))
    });
    const posted = post(reversal, state, options);
    let next = clone(posted.state);
    next.vouchers = list(next.vouchers).map(item => item.voucherNumber === original.voucherNumber ? { ...item, status: 'reversed', reversalVoucherNumber: reversal.voucherNumber } : item);
    next = ns.VoucherEngine.audit(next, 'reverse', { voucherNumber, reversalVoucherNumber: reversal.voucherNumber }, options.user || 'system');
    return Object.freeze({ state: next, voucher: reversal, reversed: posted.posted, validation: posted.validation });
  }

  ns.PostingEngine = Object.freeze({
    version: '1.0.0',
    preview,
    simulation: preview,
    post,
    unPost,
    reverse
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
