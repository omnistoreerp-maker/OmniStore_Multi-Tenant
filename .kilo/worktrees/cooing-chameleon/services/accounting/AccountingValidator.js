(function (root) {
  'use strict';

  const ns = root.OmniEnterpriseAccounting = root.OmniEnterpriseAccounting || {};
  const EPSILON = 0.01;
  const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
  const list = value => Array.isArray(value) ? value : [];
  const money = value => Math.round((Number(value) || 0) * 100) / 100;
  const dateOnly = value => String(value || '').slice(0, 10);

  const ROLE_PERMISSIONS = Object.freeze({
    Owner: ['create', 'edit', 'remove', 'post', 'unpost', 'reverse', 'preview', 'ledger', 'trialBalance', 'closePeriod', 'reopenPeriod', 'closeYear', 'reopenYear'],
    Admin: ['create', 'edit', 'remove', 'post', 'unpost', 'reverse', 'preview', 'ledger', 'trialBalance', 'closePeriod', 'reopenPeriod'],
    Accountant: ['create', 'edit', 'post', 'unpost', 'reverse', 'preview', 'ledger', 'trialBalance', 'closePeriod'],
    Auditor: ['preview', 'ledger', 'trialBalance'],
    Manager: ['preview', 'ledger', 'trialBalance'],
    Cashier: ['create', 'preview']
  });

  function accountIndex(chartOfAccounts) {
    const index = new Map();
    list(chartOfAccounts).forEach(account => {
      if (account && account.id) index.set(account.id, account);
    });
    return index;
  }

  function can(role, action) {
    const normalizedRole = role || 'Owner';
    return list(ROLE_PERMISSIONS[normalizedRole]).includes(action);
  }

  function fiscalClosureForDate(state, postingDate) {
    const target = dateOnly(postingDate);
    const year = list(state && state.fiscalYears).find(item => target >= item.startDate && target <= item.endDate);
    if (!year) return { closed: false, reason: null, fiscalYear: null, period: null };
    if (year.status === 'closed') return { closed: true, reason: 'FISCAL_YEAR_CLOSED', fiscalYear: year, period: null };
    const period = list(year.periods).find(item => target >= item.startDate && target <= item.endDate);
    if (period && period.status === 'closed') return { closed: true, reason: 'FISCAL_PERIOD_CLOSED', fiscalYear: year, period };
    return { closed: false, reason: null, fiscalYear: year, period };
  }

  function validateVoucher(voucher, state = {}, options = {}) {
    const errors = [];
    const warnings = [];
    const action = options.action || 'preview';
    const role = options.role || 'Owner';
    const chartIndex = accountIndex(state.chartOfAccounts || []);

    if (!can(role, action)) errors.push({ code: 'PERMISSION_DENIED', message: `${role} cannot ${action} accounting vouchers.` });
    if (!voucher) errors.push({ code: 'VOUCHER_REQUIRED', message: 'Voucher is required.' });
    if (!voucher) return { valid: false, errors, warnings, totals: { debit: 0, credit: 0, difference: 0 } };

    if (!voucher.voucherNumber) errors.push({ code: 'VOUCHER_NUMBER_REQUIRED', message: 'Voucher Number is required.' });
    if (!voucher.voucherType) errors.push({ code: 'VOUCHER_TYPE_REQUIRED', message: 'Voucher Type is required.' });
    if (!voucher.postingDate) errors.push({ code: 'POSTING_DATE_REQUIRED', message: 'Posting Date is required.' });
    if (!list(voucher.lines).length) errors.push({ code: 'LINES_REQUIRED', message: 'Journal Lines are required.' });

    const closure = fiscalClosureForDate(state, voucher.postingDate);
    if (closure.closed && ['post', 'create', 'edit'].includes(action)) {
      errors.push({ code: closure.reason, message: 'Posting date is inside a closed fiscal year or period.' });
    }

    let debit = 0;
    let credit = 0;
    list(voucher.lines).forEach((line, index) => {
      const account = chartIndex.get(line.account);
      const lineDebit = money(line.baseDebit != null ? line.baseDebit : line.debit * (line.exchangeRate || 1));
      const lineCredit = money(line.baseCredit != null ? line.baseCredit : line.credit * (line.exchangeRate || 1));
      debit = money(debit + lineDebit);
      credit = money(credit + lineCredit);

      if (!line.account) errors.push({ code: 'ACCOUNT_REQUIRED', line: index + 1, message: 'Line account is required.' });
      if (lineDebit < 0 || lineCredit < 0) errors.push({ code: 'NEGATIVE_LINE_AMOUNT', line: index + 1, message: 'Debit/Credit cannot be negative.' });
      if (lineDebit > 0 && lineCredit > 0) errors.push({ code: 'DOUBLE_SIDED_LINE', line: index + 1, message: 'Line cannot have both debit and credit.' });
      if (lineDebit === 0 && lineCredit === 0) warnings.push({ code: 'ZERO_AMOUNT_LINE', line: index + 1, message: 'Line has zero amount.' });
      if (!account) errors.push({ code: 'ACCOUNT_NOT_FOUND', line: index + 1, account: line.account, message: 'Account does not exist.' });
      if (account && account.active === false) errors.push({ code: 'ACCOUNT_INACTIVE', line: index + 1, account: line.account, message: 'Account is inactive.' });
      if (account && account.readOnly === true && ['post', 'create', 'edit'].includes(action)) {
        errors.push({ code: 'ACCOUNT_READ_ONLY', line: index + 1, account: line.account, message: 'Account is read-only.' });
      }
      if (!line.currency) errors.push({ code: 'CURRENCY_REQUIRED', line: index + 1, message: 'Currency is required.' });
      if (!(Number(line.exchangeRate) > 0)) errors.push({ code: 'EXCHANGE_RATE_REQUIRED', line: index + 1, message: 'Exchange Rate must be greater than zero.' });
    });

    const difference = money(debit - credit);
    if (Math.abs(difference) > EPSILON) errors.push({ code: 'UNBALANCED_VOUCHER', message: 'Debit must equal Credit.', difference });

    return Object.freeze({
      valid: errors.length === 0,
      errors: Object.freeze(errors),
      warnings: Object.freeze(warnings),
      totals: Object.freeze({ debit, credit, difference })
    });
  }

  ns.AccountingValidator = Object.freeze({
    version: '1.0.0',
    ROLE_PERMISSIONS,
    can,
    clone,
    money,
    fiscalClosureForDate,
    validateVoucher
  });
})(typeof globalThis !== 'undefined' ? globalThis : window);
