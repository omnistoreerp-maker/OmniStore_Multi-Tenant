(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const money = value => ns.AccountingValidator ? ns.AccountingValidator.money(value) : Math.round((Number(value) || 0) * 100) / 100;
  const list = value => Array.isArray(value) ? value : [];

  const DEFAULT_OFFSET = 'opening_balance_equity';
  const OPENING_ACCOUNT_BY_TYPE = Object.freeze({
    opening_inventory: 'inventory_asset',
    opening_cash: 'cash_on_hand',
    opening_bank: 'bank_main',
    opening_customer: 'accounts_receivable',
    opening_supplier: 'accounts_payable'
  });

  function createOpeningVoucher(type, balances = [], options = {}) {
    const voucherType = type || 'opening_balance';
    const lines = [];
    list(balances).forEach(item => {
      const account = item.account || OPENING_ACCOUNT_BY_TYPE[voucherType];
      const amount = money(item.amount);
      if (amount >= 0) lines.push({ account, debit: amount, credit: 0, notes: item.notes || voucherType });
      if (amount < 0) lines.push({ account, debit: 0, credit: Math.abs(amount), notes: item.notes || voucherType });
    });
    const totals = lines.reduce((sum, line) => ({ debit: money(sum.debit + line.debit), credit: money(sum.credit + line.credit) }), { debit: 0, credit: 0 });
    const difference = money(totals.debit - totals.credit);
    if (difference > 0) lines.push({ account: options.offsetAccount || DEFAULT_OFFSET, debit: 0, credit: difference, notes: 'Opening balance offset' });
    if (difference < 0) lines.push({ account: options.offsetAccount || DEFAULT_OFFSET, debit: Math.abs(difference), credit: 0, notes: 'Opening balance offset' });
    return ns.JournalEngine.createVoucher({
      voucherType,
      voucherNumber: options.voucherNumber || `${String(voucherType).toUpperCase()}-${(options.postingDate || new Date().toISOString().slice(0, 10)).replace(/-/g, '')}`,
      postingDate: options.postingDate || new Date().toISOString().slice(0, 10),
      reference: options.reference || 'Opening Balance',
      description: options.description || 'Generated opening balance voucher',
      businessProfile: options.businessProfile || 'computer_shop',
      lines
    }, options);
  }

  ns.OpeningBalanceEngine = Object.freeze({
    version: '1.0.0',
    OPENING_ACCOUNT_BY_TYPE,
    createOpeningVoucher
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
