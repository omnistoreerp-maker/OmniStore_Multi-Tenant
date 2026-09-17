(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const clone = value => ns.AccountingValidator ? ns.AccountingValidator.clone(value) : JSON.parse(JSON.stringify(value));

  const CHART_OF_ACCOUNTS = Object.freeze([
    { id: 'cash_on_hand', code: '1110', name: 'Cash On Hand', type: 'Assets', group: 'Current Assets', category: 'Cash Accounts', normalSide: 'debit', active: true },
    { id: 'bank_main', code: '1120', name: 'Main Bank', type: 'Assets', group: 'Current Assets', category: 'Bank Accounts', normalSide: 'debit', active: true },
    { id: 'accounts_receivable', code: '1130', name: 'Accounts Receivable', type: 'Assets', group: 'Current Assets', category: 'Customer Accounts', normalSide: 'debit', active: true },
    { id: 'inventory_asset', code: '1140', name: 'Inventory Asset', type: 'Assets', group: 'Current Assets', category: 'Inventory Accounts', normalSide: 'debit', active: true },
    { id: 'tax_receivable', code: '1150', name: 'Tax Receivable', type: 'Assets', group: 'Current Assets', category: 'Tax Accounts', normalSide: 'debit', active: true },
    { id: 'fixed_assets', code: '1210', name: 'Fixed Assets', type: 'Assets', group: 'Fixed Assets', category: 'Fixed Assets', normalSide: 'debit', active: true },
    { id: 'accounts_payable', code: '2110', name: 'Accounts Payable', type: 'Liabilities', group: 'Current Liabilities', category: 'Supplier Accounts', normalSide: 'credit', active: true },
    { id: 'tax_payable', code: '2120', name: 'Tax Payable', type: 'Liabilities', group: 'Current Liabilities', category: 'Tax Accounts', normalSide: 'credit', active: true },
    { id: 'long_term_loans', code: '2210', name: 'Long Term Loans', type: 'Liabilities', group: 'Long Term Liabilities', category: 'Long Term Liabilities', normalSide: 'credit', active: true },
    { id: 'owner_equity', code: '3100', name: 'Owner Equity', type: 'Equity', group: 'Equity', category: 'Equity', normalSide: 'credit', active: true },
    { id: 'retained_earnings', code: '3200', name: 'Retained Earnings', type: 'Equity', group: 'Equity', category: 'Equity', normalSide: 'credit', active: true, readOnly: true },
    { id: 'opening_balance_equity', code: '3300', name: 'Opening Balance Equity', type: 'Equity', group: 'Equity', category: 'Equity', normalSide: 'credit', active: true },
    { id: 'sales_revenue', code: '4100', name: 'Sales Revenue', type: 'Revenue', group: 'Revenue', category: 'Revenue', normalSide: 'credit', active: true },
    { id: 'other_income', code: '4200', name: 'Other Income', type: 'Other Income', group: 'Other Income', category: 'Other Income', normalSide: 'credit', active: true },
    { id: 'cost_of_sales', code: '5100', name: 'Cost Of Sales', type: 'Cost Of Sales', group: 'Cost Of Sales', category: 'Cost Of Sales', normalSide: 'debit', active: true },
    { id: 'purchase_expense', code: '5200', name: 'Purchase Expense', type: 'Expenses', group: 'Expenses', category: 'Expenses', normalSide: 'debit', active: true },
    { id: 'operating_expense', code: '6100', name: 'Operating Expense', type: 'Expenses', group: 'Expenses', category: 'Expenses', normalSide: 'debit', active: true },
    { id: 'other_expense', code: '6200', name: 'Other Expense', type: 'Other Expense', group: 'Other Expense', category: 'Other Expense', normalSide: 'debit', active: true },
    { id: 'sales_discount', code: '7100', name: 'Sales Discount', type: 'Expenses', group: 'Discount Accounts', category: 'Discount Accounts', normalSide: 'debit', active: true },
    { id: 'purchase_discount', code: '7200', name: 'Purchase Discount', type: 'Revenue', group: 'Discount Accounts', category: 'Discount Accounts', normalSide: 'credit', active: true }
  ]);

  function createState(input = {}) {
    return Object.freeze({
      chartOfAccounts: clone(input.chartOfAccounts || CHART_OF_ACCOUNTS),
      vouchers: clone(input.vouchers || []),
      fiscalYears: clone(input.fiscalYears || [ns.FiscalYearEngine.createFiscalYear({ id: 'FY-2026', startDate: '2026-01-01', endDate: '2026-12-31' })]),
      openingBalances: clone(input.openingBalances || []),
      auditLog: clone(input.auditLog || []),
      settings: Object.freeze({
        baseCurrency: 'EGP',
        businessProfile: 'computer_shop',
        previewOnly: true,
        ...clone(input.settings || {})
      })
    });
  }

  function createEngine(initialState = {}) {
    let state = createState(initialState);
    const useState = next => { state = createState(next); return state; };
    return Object.freeze({
      getState: () => clone(state),
      setState: next => useState(next),
      chartOfAccounts: () => clone(state.chartOfAccounts),
      createVoucher: payload => ns.JournalEngine.createVoucher(payload, state.settings),
      validate: (voucher, options = {}) => ns.AccountingValidator.validateVoucher(voucher, state, options),
      preview: (voucher, options = {}) => ns.PostingEngine.preview(voucher, state, options),
      simulation: (voucher, options = {}) => ns.PostingEngine.simulation(voucher, state, options),
      post: (voucher, options = {}) => {
        const result = ns.PostingEngine.post(voucher, state, options);
        state = createState(result.state);
        return result;
      },
      unPost: (voucherNumber, options = {}) => {
        const result = ns.PostingEngine.unPost(voucherNumber, state, options);
        state = createState(result.state);
        return result;
      },
      reverse: (voucherNumber, options = {}) => {
        const result = ns.PostingEngine.reverse(voucherNumber, state, options);
        state = createState(result.state);
        return result;
      },
      ledger: (account, filters = {}) => ns.LedgerEngine.ledgerForAccount(account, state, filters),
      ledgers: filters => ns.LedgerEngine.ledgers(state, filters || {}),
      trialBalance: filters => ns.TrialBalanceEngine.build(state, filters || {}),
      createOpeningVoucher: (type, balances, options = {}) => ns.OpeningBalanceEngine.createOpeningVoucher(type, balances, { ...state.settings, ...options }),
      fiscal: ns.FiscalYearEngine,
      roles: ns.AccountingValidator.ROLE_PERMISSIONS
    });
  }

  ns.AccountingEngine = Object.freeze({
    version: '1.0.0',
    CHART_OF_ACCOUNTS,
    createState,
    createEngine
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
