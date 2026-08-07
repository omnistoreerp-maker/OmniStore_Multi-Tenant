(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const money = value => ns.AccountingValidator ? ns.AccountingValidator.money(value) : Math.round((Number(value) || 0) * 100) / 100;
  const list = value => Array.isArray(value) ? value : [];

  function build(state = {}, filters = {}) {
    const rows = list(state.chartOfAccounts).map(account => {
      const balance = ns.AccountBalanceEngine.balanceOf(account.id, state, filters);
      return Object.freeze({
        account: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        group: account.group,
        openingBalance: balance.openingBalance,
        debitTotal: balance.debitTotal,
        creditTotal: balance.creditTotal,
        closingBalance: balance.closingBalance
      });
    });
    const totals = rows.reduce((sum, row) => ({
      debit: money(sum.debit + row.debitTotal),
      credit: money(sum.credit + row.creditTotal),
      closing: money(sum.closing + row.closingBalance)
    }), { debit: 0, credit: 0, closing: 0 });
    return Object.freeze({ rows: Object.freeze(rows), totals: Object.freeze({ ...totals, difference: money(totals.debit - totals.credit) }) });
  }

  function beforePosting(voucher, state = {}, filters = {}) {
    return build(state, filters);
  }

  function afterPosting(voucher, state = {}, filters = {}) {
    const stateAfter = { ...state, vouchers: [...list(state.vouchers), { ...voucher, status: 'posted' }] };
    return build(stateAfter, filters);
  }

  ns.TrialBalanceEngine = Object.freeze({
    version: '1.0.0',
    build,
    beforePosting,
    afterPosting
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
