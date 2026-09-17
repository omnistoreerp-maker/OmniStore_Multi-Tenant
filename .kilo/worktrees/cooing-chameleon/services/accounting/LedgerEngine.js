(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const money = value => ns.AccountingValidator ? ns.AccountingValidator.money(value) : Math.round((Number(value) || 0) * 100) / 100;
  const list = value => Array.isArray(value) ? value : [];

  function ledgerForAccount(accountId, state = {}, filters = {}) {
    const openingBalance = ns.AccountBalanceEngine.openingFor(accountId, state);
    let runningBalance = openingBalance;
    let debitTotal = 0;
    let creditTotal = 0;
    const entries = [];

    list(state.vouchers)
      .filter(voucher => filters.postedOnly === false || voucher.status === 'posted')
      .filter(voucher => !filters.businessProfile || voucher.businessProfile === filters.businessProfile)
      .filter(voucher => !filters.dateFrom || voucher.postingDate >= filters.dateFrom)
      .filter(voucher => !filters.dateTo || voucher.postingDate <= filters.dateTo)
      .sort((a, b) => `${a.postingDate}|${a.voucherNumber}`.localeCompare(`${b.postingDate}|${b.voucherNumber}`))
      .forEach(voucher => {
        list(voucher.lines).forEach(line => {
          if (line.account !== accountId) return;
          if (filters.branch && line.branch !== filters.branch) return;
          if (filters.costCenter && line.costCenter !== filters.costCenter) return;
          debitTotal = money(debitTotal + line.baseDebit);
          creditTotal = money(creditTotal + line.baseCredit);
          runningBalance = money(runningBalance + line.baseDebit - line.baseCredit);
          entries.push(Object.freeze({
            voucherNumber: voucher.voucherNumber,
            voucherType: voucher.voucherType,
            postingDate: voucher.postingDate,
            reference: voucher.reference,
            description: voucher.description,
            debit: line.baseDebit,
            credit: line.baseCredit,
            runningBalance,
            branch: line.branch,
            costCenter: line.costCenter,
            project: line.project,
            notes: line.notes
          }));
        });
      });

    return Object.freeze({
      account: accountId,
      openingBalance,
      debitTotal,
      creditTotal,
      runningBalance,
      closingBalance: runningBalance,
      entries: Object.freeze(entries)
    });
  }

  function ledgers(state = {}, filters = {}) {
    return Object.freeze(list(state.chartOfAccounts).map(account => ledgerForAccount(account.id, state, filters)));
  }

  ns.LedgerEngine = Object.freeze({
    version: '1.0.0',
    ledgerForAccount,
    ledgers
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
