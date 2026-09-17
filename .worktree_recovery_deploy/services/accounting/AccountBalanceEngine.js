(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const money = value => ns.AccountingValidator ? ns.AccountingValidator.money(value) : Math.round((Number(value) || 0) * 100) / 100;
  const list = value => Array.isArray(value) ? value : [];

  function openingFor(accountId, state = {}) {
    return money(list(state.openingBalances).filter(item => item.account === accountId).reduce((sum, item) => sum + Number(item.amount || 0), 0));
  }

  function accountTotals(accountId, state = {}, filters = {}) {
    const totals = { debit: 0, credit: 0 };
    list(state.vouchers).forEach(voucher => {
      if (filters.postedOnly !== false && voucher.status !== 'posted') return;
      if (filters.businessProfile && voucher.businessProfile !== filters.businessProfile) return;
      if (filters.dateFrom && voucher.postingDate < filters.dateFrom) return;
      if (filters.dateTo && voucher.postingDate > filters.dateTo) return;
      list(voucher.lines).forEach(line => {
        if (line.account !== accountId) return;
        if (filters.branch && line.branch !== filters.branch) return;
        if (filters.costCenter && line.costCenter !== filters.costCenter) return;
        totals.debit = money(totals.debit + Number(line.baseDebit || 0));
        totals.credit = money(totals.credit + Number(line.baseCredit || 0));
      });
    });
    return totals;
  }

  function balanceOf(accountId, state = {}, filters = {}) {
    const openingBalance = openingFor(accountId, state);
    const totals = accountTotals(accountId, state, filters);
    return Object.freeze({
      account: accountId,
      openingBalance,
      debitTotal: totals.debit,
      creditTotal: totals.credit,
      closingBalance: money(openingBalance + totals.debit - totals.credit)
    });
  }

  function balances(state = {}, filters = {}) {
    return Object.freeze(list(state.chartOfAccounts).map(account => balanceOf(account.id, state, filters)));
  }

  function previewBalances(voucher, state = {}, filters = {}) {
    const affected = [...new Set(list(voucher && voucher.lines).map(line => line.account))];
    return Object.freeze(affected.map(account => {
      const before = balanceOf(account, state, filters);
      const stateAfter = { ...state, vouchers: [...list(state.vouchers), { ...voucher, status: 'posted' }] };
      const after = balanceOf(account, stateAfter, filters);
      return Object.freeze({ account, before, after });
    }));
  }

  ns.AccountBalanceEngine = Object.freeze({
    version: '1.0.0',
    openingFor,
    accountTotals,
    balanceOf,
    balances,
    previewBalances
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
